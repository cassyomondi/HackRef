import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../../src/db/connection";
import { auditEvents, awards, awardApprovals, organizerUsers, payouts } from "../../src/db/schema";
import { allocateAward, approveAward } from "../../src/lib/awards";
import { saveEvent } from "../../src/lib/event-service";
import { AppError } from "../../src/lib/errors";
import { reconcileSandboxPayout, sendSandboxPayout } from "../../src/lib/payouts";
import { allocationFor, approvalFor, finalizedAwardProject } from "../helpers/awards";
import { isolatedDatabase } from "../helpers/database";
import { paypalFixture, sandboxEnv } from "../helpers/paypal";

const eventData = { name: "Payout fixture", slug: "payout-fixture", status: "judging", deadlineAt: "2026-11-12T20:59:59Z", budgetCents: 100000 };
const rejects = (status: number) => (e: unknown) => e instanceof AppError && e.status === status;
test("Stage B permanent sandbox dispatch, exact authorization and item reconciliation", { timeout: 120000 }, async t => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { assert.fail("No real provider calls allowed"); };
  let number = 0;
  try {
    const [owner, other] = await db.insert(organizerUsers).values([{ email: "payouts@example.test", displayName: "Payout organizer" }, { email: "other-payouts@example.test", displayName: "Other organizer" }]).returning();
    const event = await saveEvent(db, owner.id, eventData);
    await saveEvent(db, other.id, { ...eventData, slug: "foreign-payouts" });
    async function awardFixture(approve = true) {
      const project = await finalizedAwardProject(db, owner.id, `payout-${++number}`);
      const award = await allocateAward(db, owner.id, allocationFor(project, `Prize ${number}`, 10));
      const approval = approve ? (await approveAward(db, owner.id, award.id, approvalFor(award))).approval : undefined;
      return { award, input: { ...approvalFor(award), approvalId: approval?.id ?? randomUUID(), environment: "sandbox", confirmSandboxRecipient: true, confirmSandboxPayout: true } };
    }
    await t.test("approval alone and finalized assessment never dispatch; confirmation, exact terms, approval and event scope are required", async () => {
      const f = paypalFixture(), a = await awardFixture(false), options = { env: sandboxEnv, fetcher: f.fetcher };
      assert.equal((await db.select().from(payouts)).length, 0);
      await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, a.input, options), rejects(409));
      const approval = (await approveAward(db, owner.id, a.award.id, approvalFor(a.award))).approval;
      const input = { ...a.input, approvalId: approval.id };
      for (const patch of [{ amountCents: 11 }, { recipientEmail: "other@example.test" }, { revision: 2 }, { title: "Wrong" }, { assessmentId: randomUUID() }, { submissionId: randomUUID() }, { approvalId: randomUUID() }])
        await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, { ...input, ...patch }, options), rejects(409));
      for (const patch of [{ environment: "live" }, { currency: "EUR" }, { confirmSandboxRecipient: false }, { confirmSandboxPayout: false }, { confirm: false }, { amountCents: 0.1 }])
        await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, { ...input, ...patch }, options));
      await assert.rejects(sendSandboxPayout(db, other.id, a.award.id, input, options), rejects(404));
      await assert.rejects(reconcileSandboxPayout(db, other.id, a.award.id, {}, options), rejects(404));
      await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, input, { env: { ...sandboxEnv, PAYPAL_SANDBOX_RECIPIENT_EMAILS: "different@example.test" }, fetcher: f.fetcher }), rejects(409));
      assert.equal(f.requests.length, 0); assert.equal((await db.select().from(payouts)).length, 0);
    });
    const main = await awardFixture(); const api = paypalFixture(); const options = { env: sandboxEnv, fetcher: api.fetcher };
    await t.test("simultaneous sends across independent pools, double-clicks and replays submit once using committed intent and claim", async () => {
      const second = connectDatabase(fixture.connectionString);
      try {
        const checkedFetch: typeof fetch = async (url, init) => {
          if (new URL(String(url)).pathname === "/v1/payments/payouts") {
            const [row] = await second.db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
            assert.equal(row.dispatchState, "started"); assert.ok(row.dispatchClaim); assert.ok(row.dispatchStartedAt);
            assert.equal(row.status, "unknown");
            const audits = await second.db.select().from(auditEvents).where(eq(auditEvents.entityId, row.id));
            assert.ok(audits.some(a => a.action === "payout.authorized")); assert.ok(audits.some(a => a.action === "payout.dispatch_started"));
          }
          return api.fetcher(url, init);
        };
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => sendSandboxPayout(i % 2 ? db : second.db, owner.id, main.award.id, main.input, { ...options, fetcher: checkedFetch })));
        assert.equal(results.filter(r => r.created).length, 1); assert.equal(new Set(results.map(r => r.payout.id)).size, 1); assert.equal(api.dispatches, 1);
        const replay = await sendSandboxPayout(second.db, owner.id, main.award.id, main.input, options);
        assert.equal(replay.created, false); assert.equal(replay.payout.status, "pending"); assert.equal(replay.payout.itemStatus, null);
        assert.equal(api.dispatches, 1);
        const body = JSON.parse(api.requests.find(r => r.path === "/v1/payments/payouts")!.body!);
        assert.equal(body.items[0].amount.value, "0.10"); assert.equal(body.items[0].amount.currency, "USD");
      } finally { await second.pool.end(); }
    });
    await pool.query("CREATE TABLE mock_provider_dispatches (award_id uuid NOT NULL)");
    function processSend(a: Awaited<ReturnType<typeof awardFixture>>, mode = "normal") {
      return new Promise<{ code: number | null; body: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/helpers/payout-process.ts"], {
          env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"],
        });
        let body = ""; child.stdout.on("data", chunk => { body += chunk; }); child.stderr.resume();
        child.on("error", reject); child.on("close", code => resolve({ code, body }));
        child.stdin.end(JSON.stringify({ connectionString: fixture.connectionString, organizerId: owner.id, awardId: a.award.id, terms: a.input, mode }));
      });
    }
    await t.test("independent processes share a permanent one-dispatch barrier", async () => {
      const a = await awardFixture();
      const results = await Promise.all(Array.from({ length: 4 }, () => processSend(a)));
      assert.ok(results.every(r => r.code === 0));
      assert.equal(new Set(results.map(r => JSON.parse(r.body).payoutId)).size, 1);
      assert.equal(results.filter(r => JSON.parse(r.body).created).length, 1);
      assert.equal((await pool.query("SELECT count(*) FROM mock_provider_dispatches WHERE award_id=$1", [a.award.id])).rows[0].count, "1");
    });
    await t.test("abrupt process exits preserve prepared versus started/uncertain and block all restarted sends", async () => {
      for (const [mode, code, state, calls] of [["crash-prepared", 81, "prepared", "0"], ["crash-started", 82, "started", "1"]] as const) {
        const a = await awardFixture();
        assert.equal((await processSend(a, mode)).code, code);
        const [record] = await db.select().from(payouts).where(eq(payouts.awardId, a.award.id));
        assert.equal(record.dispatchState, state); assert.equal(record.status, state === "prepared" ? "intent" : "unknown");
        assert.equal((await processSend(a)).code, 0);
        assert.equal((await pool.query("SELECT count(*) FROM mock_provider_dispatches WHERE award_id=$1", [a.award.id])).rows[0].count, calls);
      }
    });
    await t.test("batch SUCCESS and all non-SUCCESS item statuses never mark a recipient paid", async () => {
      for (const [status, expected] of [["PENDING", "pending"], ["UNCLAIMED", "unclaimed"], ["FAILED", "failed"], ["RETURNED", "returned"], ["ONHOLD", "unknown"], ["BLOCKED", "unknown"], ["REFUNDED", "returned"], ["REVERSED", "returned"], ["NEW_STATUS", "unknown"]]) {
        api.setStatus(status);
        const result = await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options);
        assert.equal(result.status, expected); assert.equal(result.itemStatus, status === "NEW_STATUS" ? "UNKNOWN" : status);
        assert.ok(result.reconciledAt); assert.notEqual(result.status, "succeeded");
      }
      api.setStatus("SUCCESS"); api.setDirectPatch({ transaction_status: "PENDING" });
      assert.equal((await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options)).status, "pending", "Batch item SUCCESS cannot override a pending direct item observation");
      api.setDirectPatch({});
      const result = await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options);
      assert.equal(result.status, "succeeded"); assert.equal(result.paypalItemId, "provider-item"); assert.equal(result.evidence?.recipientMatched, true);
      assert.equal(result.evidence?.itemStatus, "SUCCESS");
      api.setStatus("REVERSED"); assert.equal((await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options)).status, "returned");
      api.setStatus("SUCCESS"); await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options);
      assert.equal(api.dispatches, 1);
    });
    await t.test("batch/item IDs, sender IDs, recipient, currency and amount must correlate; prior evidence remains intact", async () => {
      const [before] = await db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
      for (const patch of [{ payout_batch_id: "wrong" }, { sender_batch_id: "wrong" }, { payout_item_id: "wrong" },
        { payout_item: { recipient_type: "EMAIL", receiver: "wrong@example.test" } },
        { payout_item: { recipient_type: "EMAIL", receiver: main.award.recipientEmail, sender_item_id: before.senderItemId, amount: { value: "0.11", currency: "USD" } } },
        { payout_item: { recipient_type: "EMAIL", receiver: main.award.recipientEmail, sender_item_id: before.senderItemId, amount: { value: "0.10", currency: "EUR" } } }]) {
        api.setDirectPatch(patch);
        const result = await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options);
        assert.equal(result.lastOutcome, "CORRELATION_MISMATCH"); assert.deepEqual(result.evidence, before.evidence); assert.equal(result.reconciledAt?.getTime(), before.reconciledAt?.getTime());
      }
      api.setDirectPatch({});
      api.setPatch({ payout_item_id: "wrong" });
      assert.equal((await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options)).lastOutcome, "CORRELATION_MISMATCH"); api.setPatch({});
      await assert.rejects(reconcileSandboxPayout(db, owner.id, main.award.id, { batchId: "wrong" }, options), rejects(409));
      await assert.rejects(reconcileSandboxPayout(db, other.id, main.award.id, {}, options), rejects(404));
    });
    await t.test("concurrent reconciliation fences stale observations, including a stale SUCCESS after a newer reversal", async () => {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
      const fetcher: typeof fetch = async (url, init) => {
        const response = await api.fetcher(url, init);
        if (String(url).includes("payouts-item")) { entered(); await gate; }
        return response;
      };
      api.setStatus("SUCCESS"); const stale = reconcileSandboxPayout(db, owner.id, main.award.id, {}, { ...options, fetcher });
      await started;
      api.setStatus("REVERSED"); const latest = await reconcileSandboxPayout(db, owner.id, main.award.id, {}, options);
      release(); const saved = await stale;
      assert.equal(saved.status, "returned"); assert.equal(saved.stateVersion, latest.stateVersion); assert.equal(saved.itemStatus, "REVERSED");
      api.setStatus("SUCCESS");
    });
    await t.test("failed read-only lookup retains the last correlated item evidence and never submits", async () => {
      const [before] = await db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
      const unavailable: typeof fetch = async (url, init) => {
        if (init?.method === "GET") throw new Error("Sensitive transport detail");
        return api.fetcher(url, init);
      };
      const result = await reconcileSandboxPayout(db, owner.id, main.award.id, {}, { ...options, fetcher: unavailable });
      assert.equal(result.lastOutcome, "RECONCILIATION_UNAVAILABLE"); assert.equal(result.status, before.status);
      assert.deepEqual(result.evidence, before.evidence); assert.equal(result.reconciledAt?.getTime(), before.reconciledAt?.getTime()); assert.equal(api.dispatches, 1);
    });
    await t.test("invalid OAuth credentials leave a prepared-never-sent intent; repeated requests cannot restart it", async () => {
      const a = await awardFixture(), f = paypalFixture(); f.setAuthResponse(Response.json({ error: "invalid_client", secret: "fixture-secret" }, { status: 401 }));
      const opts = { env: sandboxEnv, fetcher: f.fetcher };
      const { payout } = await sendSandboxPayout(db, owner.id, a.award.id, a.input, opts);
      assert.equal(payout.dispatchState, "prepared"); assert.equal(payout.dispatchStartedAt, null); assert.equal(payout.lastOutcome, "PREFLIGHT_REJECTED"); assert.equal(f.dispatches, 0);
      await sendSandboxPayout(db, owner.id, a.award.id, a.input, opts); assert.equal(f.requests.length, 1);
      await assert.rejects(reconcileSandboxPayout(db, owner.id, a.award.id, { batchId: "provider-batch" }, opts), rejects(409));
    });
    await t.test("timeouts, malformed delivery, provider rejection and duplicates keep permanent claims across restart/replay", async () => {
      for (const [response, outcome] of [
        [new Error("private transport payload"), "UNKNOWN"], [Response.json({ private: "do not expose" }, { status: 422 }), "REJECTED"],
        [Response.json({ name: "DUPLICATE_BATCH_ID", links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/provider-batch" }] }, { status: 400 }), "DUPLICATE"],
      ] as const) {
        const a = await awardFixture(), f = paypalFixture(); f.setSubmitResponse(response);
        const opts = { env: sandboxEnv, fetcher: f.fetcher };
        const result = await sendSandboxPayout(db, owner.id, a.award.id, a.input, opts);
        assert.equal(result.payout.lastOutcome, outcome); assert.equal(result.payout.dispatchState, "started");
        assert.equal(result.payout.status, outcome === "REJECTED" ? "failed" : "unknown");
        const restarted = connectDatabase(fixture.connectionString);
        try { await sendSandboxPayout(restarted.db, owner.id, a.award.id, a.input, opts); } finally { await restarted.pool.end(); }
        assert.equal(f.dispatches, 1);
        if (outcome === "UNKNOWN") {
          await assert.rejects(reconcileSandboxPayout(db, owner.id, a.award.id, {}, opts), rejects(409));
          f.setItemId("recovered-unknown-item");
          // Fully correlated lookup recovers the original batch without a second dispatch.
          const recovered = await reconcileSandboxPayout(db, owner.id, a.award.id, { batchId: "provider-batch" }, opts);
          assert.equal(recovered.status, "succeeded"); assert.equal(f.dispatches, 1);
        }
        if (outcome === "DUPLICATE") {
          f.setPatch({ sender_batch_id: "unrelated-batch" });
          assert.equal((await reconcileSandboxPayout(db, owner.id, a.award.id, {}, opts)).lastOutcome, "CORRELATION_MISMATCH");
          assert.equal(f.dispatches, 1);
          f.setPatch({}); f.setItemId("recovered-duplicate-item");
          const original = await reconcileSandboxPayout(db, owner.id, a.award.id, {}, opts);
          assert.equal(original.status, "succeeded"); assert.equal(f.dispatches, 1);
        }
      }
    });
    // Use a table-backed trigger configuration so every pooled connection sees it.
    await pool.query("CREATE TABLE audit_failure_action (action text)");
    await pool.query("CREATE FUNCTION reject_payout_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM audit_failure_action WHERE action = NEW.action) THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER reject_payout_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_payout_audit()");
    async function failAudit(action: string) { await pool.query("DELETE FROM audit_failure_action"); await pool.query("INSERT INTO audit_failure_action VALUES ($1)", [action]); }
    async function clearAuditFailure() { await pool.query("DELETE FROM audit_failure_action"); }
    await t.test("audit failures roll back authorization and claim before any payout POST", async () => {
      for (const action of ["payout.authorized", "payout.dispatch_started"]) {
        const a = await awardFixture(), f = paypalFixture(), opts = { env: sandboxEnv, fetcher: f.fetcher };
        await failAudit(action);
        await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, a.input, opts));
        await clearAuditFailure(); assert.equal(f.dispatches, 0);
        const rows = await db.select().from(payouts).where(eq(payouts.awardId, a.award.id));
        if (action === "payout.authorized") assert.equal(rows.length, 0);
        else { assert.equal(rows[0].dispatchState, "prepared"); await sendSandboxPayout(db, owner.id, a.award.id, a.input, opts); assert.equal(f.dispatches, 0); }
      }
    });
    await t.test("a crash/failure after external dispatch leaves started/unknown and cannot resend, even if result audit fails", async () => {
      const a = await awardFixture(), f = paypalFixture(), opts = { env: sandboxEnv, fetcher: f.fetcher };
      await failAudit("payout.dispatch_result"); await assert.rejects(sendSandboxPayout(db, owner.id, a.award.id, a.input, opts)); await clearAuditFailure();
      const replay = await sendSandboxPayout(db, owner.id, a.award.id, a.input, opts);
      assert.equal(replay.payout.dispatchState, "started"); assert.equal(replay.payout.status, "unknown"); assert.equal(replay.payout.paypalBatchId, null); assert.equal(f.dispatches, 1);
      const before = await db.select().from(payouts).where(eq(payouts.awardId, a.award.id));
      await assert.rejects(pool.query("UPDATE payouts SET dispatch_state='prepared', dispatch_claim=NULL, dispatch_started_at=NULL, state_version=state_version+1 WHERE award_id=$1", [a.award.id]));
      await assert.rejects(pool.query("DELETE FROM payouts WHERE award_id=$1", [a.award.id]));
      await assert.rejects(pool.query("UPDATE payouts SET sender_batch_id='replacement', state_version=state_version+1 WHERE award_id=$1", [a.award.id]));
      assert.deepEqual(await db.select().from(payouts).where(eq(payouts.awardId, a.award.id)), before);
    });
    await t.test("reconciliation audit failure cannot commit new item evidence/status", async () => {
      const [before] = await db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
      api.setStatus("SUCCESS"); await failAudit("payout.reconciled");
      await assert.rejects(reconcileSandboxPayout(db, owner.id, main.award.id, {}, options)); await clearAuditFailure();
      const [after] = await db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
      assert.equal(after.status, before.status); assert.deepEqual(after.evidence, before.evidence); assert.equal(after.reconciledAt?.getTime(), before.reconciledAt?.getTime());
      assert.equal(after.stateVersion, before.stateVersion + 1); // Only the audited read request committed.
    });
    await t.test("financial identities, approvals and award terms stay immutable; audit metadata is sanitized", async () => {
      const [payout] = await db.select().from(payouts).where(eq(payouts.awardId, main.award.id));
      for (const statement of ["sender_item_id='replacement'", "paypal_item_id='replacement'", "paypal_batch_id='replacement'", "dispatch_claim=NULL", "authorized_by='" + other.id + "'"])
        await assert.rejects(pool.query(`UPDATE payouts SET ${statement}, state_version=state_version+1 WHERE id=$1`, [payout.id]));
      await assert.rejects(pool.query("UPDATE payouts SET status='succeeded', item_status=NULL, evidence=jsonb_set(evidence, '{itemStatus}', 'null'::jsonb), state_version=state_version+1 WHERE id=$1", [payout.id]));
      await assert.rejects(pool.query("UPDATE awards SET amount_cents=11 WHERE id=$1", [main.award.id]));
      await assert.rejects(pool.query("UPDATE award_approvals SET recipient_email='wrong@example.test' WHERE id=$1", [main.input.approvalId]));
      const audit = await db.select().from(auditEvents).where(eq(auditEvents.eventId, event.id));
      assert.ok(!JSON.stringify(audit).includes(main.award.recipientEmail)); assert.ok(!JSON.stringify(audit).includes("fixture-secret"));
      assert.ok(!JSON.stringify(audit).includes("private transport payload"));
      assert.ok((await db.select().from(awards)).length > 0); assert.ok((await db.select().from(awardApprovals)).length > 0);
    });
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});


test("additive Stage B migration preserves Stage A awards, approvals, assessments, audits and historical payouts", async () => {
  const fixture = await isolatedDatabase("0004_awards_stage_a");
  try {
    const [owner] = await fixture.db.insert(organizerUsers).values({ email: "migration@example.test", displayName: "Migration fixture" }).returning();
    await saveEvent(fixture.db, owner.id, { ...eventData, slug: "migration-fixture" });
    const project = await finalizedAwardProject(fixture.db, owner.id, "migration");
    const award = await allocateAward(fixture.db, owner.id, allocationFor(project, "Historical prize", 10));
    const approval = (await approveAward(fixture.db, owner.id, award.id, approvalFor(award))).approval;
    await fixture.pool.query("INSERT INTO payouts (award_id, approval_id, sender_batch_id, sender_item_id, paypal_batch_id, paypal_item_id, status, reconciled_at) VALUES ($1, $2, 'historical-batch', 'historical-item', 'old-provider-batch', 'old-provider-item', 'succeeded', now())", [award.id, approval.id]);
    const tables = ["awards", "award_approvals", "assessments", "audit_events"];
    const before = await Promise.all(tables.map(table => fixture.pool.query(`SELECT * FROM ${table} ORDER BY id`)));
    const oldPayout = (await fixture.pool.query("SELECT * FROM payouts")).rows[0];
    const client = await fixture.pool.connect();
    try {
      await client.query("BEGIN");
      const migration = await readFile("drizzle/0005_awards_stage_b.sql", "utf8");
      await client.query(migration.replaceAll('"public".', `"${fixture.schemaName}".`));
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    for (const [index, table] of tables.entries()) assert.deepEqual((await fixture.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows, before[index].rows);
    const migrated = (await fixture.pool.query("SELECT * FROM payouts")).rows[0];
    for (const key of Object.keys(oldPayout)) assert.deepEqual(migrated[key], oldPayout[key]);
    assert.equal(migrated.dispatch_state, "legacy"); assert.equal(migrated.dispatch_claim, null);
    const f = paypalFixture();
    const replay = await sendSandboxPayout(fixture.db, owner.id, award.id, { ...approvalFor(award), approvalId: approval.id, environment: "sandbox", confirmSandboxRecipient: true, confirmSandboxPayout: true }, { env: sandboxEnv, fetcher: f.fetcher });
    assert.equal(replay.created, false); assert.equal(f.requests.length, 0);
  } finally { await fixture.close(); }
});
