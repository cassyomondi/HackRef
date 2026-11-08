import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { assessments, auditEvents, awardApprovals, awards, organizerUsers, payouts, rubricVersions } from "../../src/db/schema";
import { allocateAward, approveAward, awardPreview, awardsWorkspace, eligibleAssessments } from "../../src/lib/awards";
import { ownedEvent, saveEvent } from "../../src/lib/event-service";
import { AppError } from "../../src/lib/errors";
import { allocationFor, approvalFor, finalizedAwardProject } from "../helpers/awards";
import { isolatedDatabase } from "../helpers/database";

test("Stage A financial allocation, exact approval, concurrent budget and immutable history", async (t) => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async () => { externalRequests++; throw new Error("External requests forbidden in Stage A"); };
  try {
    const [owner, other, fresh] = await db.insert(organizerUsers).values([{ email: "awards@example.test", displayName: "Awards organizer" }, { email: "other-awards@example.test", displayName: "Other organizer" }, { email: "no-event@example.test", displayName: "No event" }]).returning();
    const eventInput = { name: "Awards fixture", slug: "awards-fixture", status: "judging", deadlineAt: "2026-11-12T20:59:59Z" };
    const event = await saveEvent(db, owner.id, eventInput);
    await saveEvent(db, other.id, { ...eventInput, slug: "other-awards", budgetCents: 100000 });
    assert.equal(await awardsWorkspace(db, fresh.id), null);
    const alpha = await finalizedAwardProject(db, owner.id, "alpha");
    const beta = await finalizedAwardProject(db, owner.id, "beta");
    const gamma = await finalizedAwardProject(db, owner.id, "gamma");
    const delta = await finalizedAwardProject(db, owner.id, "delta");
    const foreign = await finalizedAwardProject(db, other.id, "foreign");
    const rejects = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;
    const alphaInput = allocationFor(alpha, "First prize");

    await t.test("zero budget, ownership, assessment scope and draft decisions cannot allocate", async () => {
      await assert.rejects(allocateAward(db, owner.id, alphaInput), rejects(409));
      await assert.rejects(allocateAward(db, fresh.id, alphaInput), rejects(404));
      await saveEvent(db, owner.id, { ...eventInput, budgetCents: 100000 });
      for (const input of [allocationFor(foreign, "Foreign"), { ...alphaInput, assessmentId: randomUUID() }, { ...alphaInput, submissionId: beta.submission.id }]) await assert.rejects(allocateAward(db, owner.id, input), rejects(404));
      await assert.rejects(allocateAward(db, other.id, alphaInput), rejects(404));
      await assert.rejects(allocateAward(db, owner.id, { ...alphaInput, assessmentId: alpha.draft.id }), rejects(409));
      assert.deepEqual(await eligibleAssessments(db, other.id, event.id), []);
      assert.equal((await db.select().from(awards)).length, 0);
    });
    await t.test("invalid amounts, recipients and unconfirmed recipients have no partial writes", async () => {
      for (const patch of [{ amountCents: 0 }, { amountCents: -100 }, { amountCents: 0.1 }, { amountCents: 2147483648 }, { amountCents: "12551" }, { recipientEmail: "bad" }, { confirmRecipient: false }, { title: "x".repeat(121) }]) await assert.rejects(allocateAward(db, owner.id, { ...alphaInput, ...patch }));
      assert.equal((await db.select().from(awards)).length, 0);
      assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.action, "award.allocated"))).length, 0);
    });
    const rubricBefore = await db.select().from(rubricVersions);
    const finalBefore = await db.select().from(assessments);
    const award = await allocateAward(db, owner.id, alphaInput);
    const terms = approvalFor(award);
    await t.test("allocation stores exact cents and supplied recipient, remains unapproved and masks list views", async () => {
      assert.equal(award.amountCents, 12551); assert.equal(award.recipientEmail, alphaInput.recipientEmail); assert.equal(award.revision, 1);
      assert.equal((await db.select().from(awardApprovals)).length, 0);
      const workspace = await awardsWorkspace(db, owner.id); assert.ok(workspace);
      assert.equal(workspace.reservedCents, 12551); assert.equal(workspace.approvedCents, 0);
      assert.ok(!JSON.stringify(workspace.register).includes(alphaInput.recipientEmail));
      assert.equal((await awardPreview(db, owner.id, award.id)).award.recipientEmail, alphaInput.recipientEmail);
      await assert.rejects(awardPreview(db, other.id, award.id), rejects(404));
      for (const input of [{ ...alphaInput, title: "Different title" }, allocationFor(beta, "FIRST PRIZE")]) await assert.rejects(allocateAward(db, owner.id, input), rejects(409));
    });
    await t.test("approval is separate, scoped and rejects every changed confirmation term", async () => {
      await assert.rejects(approveAward(db, other.id, award.id, terms), rejects(404));
      await assert.rejects(approveAward(db, owner.id, randomUUID(), terms), rejects(404));
      await assert.rejects(approveAward(db, owner.id, award.id, { ...terms, confirm: false }));
      for (const patch of [{ amountCents: 12552 }, { recipientEmail: "different@example.test" }, { revision: 2 }, { title: "Changed prize" }, { submissionId: beta.submission.id }, { assessmentId: beta.final.id }]) await assert.rejects(approveAward(db, owner.id, award.id, { ...terms, ...patch }), rejects(409));
      assert.equal((await db.select().from(awardApprovals)).length, 0);
    });
    await t.test("identical concurrent approvals and replay return one exact snapshot and sanitized audit", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => approveAward(db, owner.id, award.id, terms)));
      assert.equal(results.filter((result) => result.created).length, 1);
      assert.equal(new Set(results.map((result) => result.approval.id)).size, 1);
      const approval = results[0].approval;
      assert.equal(approval.amountCents, terms.amountCents); assert.equal(approval.recipientEmail, terms.recipientEmail);
      assert.equal(approval.assessmentId, terms.assessmentId); assert.equal(approval.awardRevision, terms.revision);
      assert.equal(approval.currency, "USD"); assert.equal(approval.approvedBy, owner.id); assert.ok(approval.approvedAt);
      assert.equal((await approveAward(db, owner.id, award.id, terms)).created, false);
      await assert.rejects(approveAward(db, owner.id, award.id, { ...terms, recipientEmail: "changed@example.test" }), rejects(409));
      const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "award.approved"));
      assert.equal(audit.length, 1); assert.equal(audit[0].actorId, owner.id);
      assert.equal(audit[0].metadata.amountCents, 12551);
      assert.ok(!JSON.stringify(audit).includes(terms.recipientEmail));
    });
    await t.test("event updates preserve existing budget when omitted and reject reducing reserved or approved funds", async () => {
      const saved = await saveEvent(db, owner.id, { ...eventInput, name: "Renamed awards event" });
      assert.equal(saved.id, event.id); assert.equal(saved.budgetCents, 100000);
      await assert.rejects(saveEvent(db, owner.id, { ...eventInput, budgetCents: 12550 }), rejects(409));
      await saveEvent(db, owner.id, { ...eventInput, budgetCents: 12551 });
      assert.equal((await approveAward(db, owner.id, award.id, terms)).created, false);
      await assert.rejects(allocateAward(db, owner.id, allocationFor(beta, "Second", 1)), rejects(409));
    });
    await t.test("concurrent allocations cannot overspend the remaining cents", async () => {
      await saveEvent(db, owner.id, { ...eventInput, budgetCents: 22551 });
      const results = await Promise.allSettled([allocateAward(db, owner.id, allocationFor(beta, "Second", 10000)), allocateAward(db, owner.id, allocationFor(gamma, "Third", 10000))]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.ok(results.some((result) => result.status === "rejected" && rejects(409)(result.reason)));
      assert.equal((await awardsWorkspace(db, owner.id))!.reservedCents, 22551);
      const allocated = results.find((result) => result.status === "fulfilled"); assert.ok(allocated?.status === "fulfilled");
      const simultaneous = await Promise.allSettled([approveAward(db, owner.id, allocated.value.id, approvalFor(allocated.value)), saveEvent(db, owner.id, { ...eventInput, budgetCents: 22550 })]);
      assert.equal(simultaneous[0].status, "fulfilled"); assert.equal(simultaneous[1].status, "rejected");
    });
    await t.test("allocation and approval audit failures roll back all financial writes", async () => {
      await saveEvent(db, owner.id, { ...eventInput, budgetCents: 100000 });
      await pool.query("CREATE FUNCTION reject_award_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'award.%' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$");
      await pool.query("CREATE TRIGGER reject_award_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_award_audit()");
      try { await assert.rejects(allocateAward(db, owner.id, allocationFor(delta, "Fourth"))); }
      finally { await pool.query("DROP TRIGGER reject_award_audit ON audit_events"); }
      assert.equal((await db.select().from(awards).where(eq(awards.submissionId, delta.submission.id))).length, 0);
      const fourth = await allocateAward(db, owner.id, allocationFor(delta, "Fourth"));
      await pool.query("CREATE TRIGGER reject_award_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_award_audit()");
      try { await assert.rejects(approveAward(db, owner.id, fourth.id, approvalFor(fourth))); }
      finally { await pool.query("DROP TRIGGER reject_award_audit ON audit_events"); }
      assert.equal((await db.select().from(awardApprovals).where(eq(awardApprovals.awardId, fourth.id))).length, 0);
      const competing = await Promise.allSettled([approveAward(db, owner.id, fourth.id, approvalFor(fourth)), approveAward(db, owner.id, fourth.id, { ...approvalFor(fourth), amountCents: 1 })]);
      assert.equal(competing[0].status, "fulfilled"); assert.equal(competing[1].status, "rejected");
    });
    await t.test("database guards prevent financial history edits, foreign approval and direct budget bypass", async () => {
      const sqlRejects = async (query: string, values: unknown[], code = "23514") => assert.rejects(pool.query(query, values), (error: unknown) => (error as { code: string }).code === code);
      for (const update of ["amount_cents = amount_cents + 1", "recipient_email = 'changed@example.test'", "revision = revision + 1", "title = 'Changed title'", "assessment_id = '00000000-0000-4000-8000-000000000000'"]) await sqlRejects(`UPDATE awards SET ${update} WHERE id = $1`, [award.id]);
      await sqlRejects("DELETE FROM awards WHERE id = $1", [award.id]);
      await sqlRejects("UPDATE award_approvals SET approved_at = now() WHERE award_id = $1", [award.id]);
      await sqlRejects("DELETE FROM award_approvals WHERE award_id = $1", [award.id]);
      await sqlRejects("UPDATE hackathon_events SET budget_cents = 0 WHERE id = $1", [event.id]);
      await sqlRejects("INSERT INTO award_approvals (award_id, award_revision, assessment_id, amount_cents, currency, recipient_email, approved_by) VALUES ($1,1,$2,$3,'USD',$4,$5)", [award.id, award.assessmentId, award.amountCents, award.recipientEmail, other.id]);
      const unused = (await db.select().from(awards)).some((row) => row.submissionId === beta.submission.id) ? gamma : beta;
      await sqlRejects("INSERT INTO awards (event_id, submission_id, assessment_id, title, amount_cents, recipient_email) VALUES ($1,$2,$3,'Draft',1,'r@example.test')", [event.id, unused.submission.id, unused.draft.id]);
      assert.deepEqual(await db.select().from(rubricVersions), rubricBefore);
      assert.deepEqual(await db.select().from(assessments), finalBefore);
    });
    assert.equal((await db.select().from(payouts)).length, 0, "Stage A must not create even a payout intent");
    assert.equal(externalRequests, 0, "Stage A must never contact an external provider");
    assert.equal((await ownedEvent(db, owner.id)).id, event.id);
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});

test("database budget guards serialize direct SQL allocations and concurrent duplicate titles", async () => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  try {
    const [owner] = await db.insert(organizerUsers).values({ email: "sql-awards@example.test", displayName: "SQL organizer" }).returning();
    const eventInput = { name: "SQL concurrency", slug: "sql-concurrency", status: "judging", deadlineAt: "2026-11-12T20:59:59Z", budgetCents: 5001 };
    const event = await saveEvent(db, owner.id, eventInput);
    const first = await finalizedAwardProject(db, owner.id, "sql-first");
    const second = await finalizedAwardProject(db, owner.id, "sql-second");
    const insert = "INSERT INTO awards (event_id, submission_id, assessment_id, title, amount_cents, recipient_email) VALUES ($1,$2,$3,$4,$5,'r@example.test') RETURNING id";
    const one = await pool.connect(); const two = await pool.connect();
    try {
      const { rows: [{ pid }] } = await two.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await one.query("BEGIN"); await two.query("BEGIN");
      await one.query(insert, [event.id, first.submission.id, first.final.id, "SQL first", 3501]);
      const waiting = two.query(insert, [event.id, second.submission.id, second.final.id, "SQL second", 1501]);
      // Check the PostgreSQL lock wait rather than relying on timing alone.
      const rejected = assert.rejects(waiting, (error: unknown) => (error as { code: string }).code === "23514");
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const locks = await pool.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted", [pid]);
        if (locks.rowCount) { blocked = true; break; }
        await delay(10);
      }
      assert.ok(blocked, "The competing allocation must wait on the event lock");
      await one.query("COMMIT"); await rejected; await two.query("ROLLBACK");
      assert.equal((await awardsWorkspace(db, owner.id))!.reservedCents, 3501);
      await assert.rejects(pool.query("UPDATE hackathon_events SET budget_cents = 3500 WHERE id = $1", [event.id]));
      await pool.query(insert, [event.id, second.submission.id, second.final.id, "SQL second", 1500]);
      assert.equal((await awardsWorkspace(db, owner.id))!.reservedCents, 5001);
    } finally { await one.query("ROLLBACK"); await two.query("ROLLBACK"); one.release(); two.release(); }

    await saveEvent(db, owner.id, { ...eventInput, budgetCents: 10000 });
    const third = await finalizedAwardProject(db, owner.id, "sql-third");
    const fourth = await finalizedAwardProject(db, owner.id, "sql-fourth");
    const duplicates = await Promise.allSettled([
      pool.query(insert, [event.id, third.submission.id, third.final.id, "Shared title", 1]),
      pool.query(insert, [event.id, fourth.submission.id, fourth.final.id, "SHARED TITLE", 1]),
    ]);
    assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(duplicates.some((result) => result.status === "rejected" && result.reason.code === "23505"));

    // An event edit locks the organizer before waiting for the event. Its lock
    // must remain compatible with the actor FK checks of the current approver.
    const approver = await pool.connect();
    try {
      const { rows: [{ pid }] } = await approver.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await approver.query("BEGIN");
      await approver.query("SELECT id FROM hackathon_events WHERE id = $1 FOR UPDATE", [event.id]);
      const editing = saveEvent(db, owner.id, { ...eventInput, budgetCents: 10000 });
      void editing.catch(() => {});
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waits = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid]);
        if (waits.rowCount) { blocked = true; break; }
        await delay(10);
      }
      assert.ok(blocked, "Event edit should wait while approval owns the event lock");
      const [firstAward] = await db.select().from(awards).where(eq(awards.submissionId, first.submission.id));
      await approver.query("INSERT INTO award_approvals (award_id,award_revision,assessment_id,amount_cents,currency,recipient_email,approved_by) SELECT id,revision,assessment_id,amount_cents,currency,recipient_email,$1 FROM awards WHERE id=$2", [owner.id, firstAward.id]);
      await approver.query("INSERT INTO audit_events (event_id,actor_id,action,entity_type,entity_id) VALUES ($1,$2,'award.approved','award',$3)", [event.id, owner.id, firstAward.id]);
      await approver.query("COMMIT");
      assert.equal((await editing).budgetCents, 10000);
    } finally { await approver.query("ROLLBACK"); approver.release(); }
  } finally { await fixture.close(); }
});
