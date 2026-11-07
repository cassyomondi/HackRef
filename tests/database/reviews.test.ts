import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { assessments, auditEvents, evaluationRuns, organizerUsers } from "../../src/db/schema";
import { addRubric, registerSubmission, saveEvent } from "../../src/lib/event-service";
import { AppError } from "../../src/lib/errors";
import { finalizeReview } from "../../src/lib/evaluation/finalize";
import { listComparison } from "../../src/lib/evaluation/comparison";
import { listReviews } from "../../src/lib/evaluation/reviews";
import { AI_PIPELINE_VERSION } from "../../src/lib/evaluation/versions";
import { claimJob, processJob, queueEvaluation } from "../../src/lib/jobs";
import { isolatedDatabase } from "../helpers/database";
import { githubFixture, submissionFixture } from "../helpers/github";
import { modelDraft, modelOptions } from "../helpers/model";
import { sourceFixture } from "../helpers/source";

test("human review preserves drafts and enforces transactional, scoped, immutable decisions", async (t) => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  try {
    const [owner, other] = await db.insert(organizerUsers).values([{ email: "review@example.test", displayName: "Reviewer" }, { email: "review-other@example.test", displayName: "Other" }]).returning();
    for (const [i, user] of [owner, other].entries()) await saveEvent(db, user.id, { name: `Review ${i}`, slug: `review-${i}`, status: "judging", deadlineAt: "2026-11-12T20:59:59Z" });
    const submission = await registerSubmission(db, owner.id, submissionFixture, githubFixture);
    async function draft(unscored = false) {
      const rubric = await addRubric(db, owner.id, { title: "Immutable judging rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }, { key: "clarity", label: "Clarity", maxScore: 5 }] });
      await queueEvaluation(db, owner.id, { submissionId: submission.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION);
      const job = await claimJob(db); assert.ok(job);
      assert.equal(await processJob(db, job, sourceFixture(), unscored ? { model: "mock", transport: async (request) => {
        const result = modelDraft(request); result.criteria[1] = { ...result.criteria[1], status: "NOT_EVALUATED", suggestedScore: null, citations: [], findings: [] };
        return { text: JSON.stringify(result), modelVersion: "mock-unscored", finishReason: "STOP" };
      } } : modelOptions), true);
      return (await listReviews(db, owner.id)).find((r) => r.jobId === job.id)!;
    }
    const input = { criteria: [{ key: "quality", action: "accept", score: 4, reason: "" }, { key: "clarity", action: "override", score: 3, reason: "I inspected the cited documentation and considered its limitations." }], rationale: "Reviewed all citations and the static-only limitations before deciding.", confirm: true };
    const rejects = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;

    await t.test("ownership is checked before read or finalization; missing and foreign drafts are hidden", async () => {
      const review = await draft();
      await assert.rejects(finalizeReview(db, other.id, review.id, input), rejects(404));
      await assert.rejects(finalizeReview(db, owner.id, randomUUID(), input), rejects(404));
      assert.deepEqual(await listReviews(db, other.id, undefined, review.id), []);
      assert.deepEqual(await listComparison(db, other.id), []);
    });
    await t.test("every immutable rubric key, bound and explicit unscored decision is enforced", async () => {
      const review = await draft(true);
      for (const criteria of [input.criteria.slice(0, 1), [...input.criteria, { ...input.criteria[0], key: "invented" }], [input.criteria[0], input.criteria[0]], [{ ...input.criteria[0], score: 11 }, input.criteria[1]], [input.criteria[0], { ...input.criteria[1], action: "accept", score: 0 }], [input.criteria[0], { ...input.criteria[1], reason: "" }]])
        await assert.rejects(finalizeReview(db, owner.id, review.id, { ...input, criteria }), rejects(422));
      assert.equal((await db.select().from(assessments).where(eq(assessments.sourceDraftId, review.id))).length, 0);
      const final = await finalizeReview(db, owner.id, review.id, input);
      assert.deepEqual(final.assessment.scores, { quality: 4, clarity: 3 });
      const row = (await listComparison(db, owner.id)).find((r) => r.assessmentId === review.id)!;
      assert.equal(row.aiTotal, null); assert.equal(row.aiScores.clarity, undefined); assert.equal(row.finalTotal, 7); assert.equal(row.coveragePercent, 50);
    });
    await t.test("identical concurrent approvals create one decision and audit event; conflicts return 409", async () => {
      const review = await draft();
      const before = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, review.jobId));
      const identical = await Promise.all(Array.from({ length: 5 }, () => finalizeReview(db, owner.id, review.id, input)));
      assert.equal(identical.filter((r) => r.created).length, 1);
      assert.equal(new Set(identical.map((r) => r.assessment.id)).size, 1);
      const final = identical[0].assessment;
      assert.equal(final.version, 2); assert.equal(final.finalizedBy, owner.id); assert.ok(final.finalizedAt);
      await assert.rejects(finalizeReview(db, owner.id, review.id, { ...input, rationale: "A conflicting later decision must never overwrite the first." }), rejects(409));
      assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, final.id))).length, 1);
      assert.deepEqual(await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, review.jobId)), before);
      const stored = (await listReviews(db, owner.id, undefined, review.id))[0];
      assert.deepEqual(stored.scores, review.scores); assert.equal(stored.rationale, review.rationale);
      assert.equal(stored.final?.reviewer, "Reviewer"); assert.equal(stored.final?.decisions.clarity.reason, input.criteria[1].reason);
    });
    await t.test("competing different approvals serialize with exactly one success", async () => {
      const review = await draft();
      const results = await Promise.allSettled([finalizeReview(db, owner.id, review.id, input), finalizeReview(db, owner.id, review.id, { ...input, criteria: [input.criteria[0], { ...input.criteria[1], score: 2 }] })]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.ok(results.some((r) => r.status === "rejected" && rejects(409)(r.reason)));
    });
    await t.test("audit failure rolls back the entire finalization and a later retry succeeds", async () => {
      const review = await draft();
      await pool.query("CREATE FUNCTION reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$");
      await pool.query("CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_review_audit()");
      try { await assert.rejects(finalizeReview(db, owner.id, review.id, input)); }
      finally { await pool.query("DROP TRIGGER reject_review_audit ON audit_events"); }
      assert.equal((await db.select().from(assessments).where(eq(assessments.sourceDraftId, review.id))).length, 0);
      assert.equal((await finalizeReview(db, owner.id, review.id, input)).created, true);
    });
    await t.test("direct SQL cannot bypass bounds, provenance, ownership, reasoning or immutable finalization", async () => {
      const review = await draft(true);
      const insert = `INSERT INTO assessments (event_id, submission_id, evaluation_run_id, version, status, scores, rationale, finalized_by, finalized_at, source_draft_id, criterion_decisions) VALUES ($1,$2,$3,2,'finalized',$4,$5,$6,now(),$7,$8)`;
      const params: unknown[] = [submission.eventId, submission.id, review.jobId, JSON.stringify({ quality: 4, clarity: 3 }), input.rationale, owner.id, review.id, JSON.stringify({ quality: { action: "accept", reason: "" }, clarity: { action: "override", reason: input.criteria[1].reason } })];
      async function rejectsSql(query: string, values: unknown[], code = "23514") { await assert.rejects(pool.query(query, values), (error: unknown) => (error as { code: string }).code === code); }
      for (const scores of [{ quality: -1, clarity: 3 }, { quality: 11, clarity: 3 }, { quality: 4 }, { quality: 4, clarity: 3, invented: 1 }, { quality: "4", clarity: 3 }]) {
        const values = [...params]; values[3] = JSON.stringify(scores); await rejectsSql(insert, values);
      }
      const otherReviewer = [...params]; otherReviewer[5] = other.id; await rejectsSql(insert, otherReviewer);
      const unreasoned = [...params]; unreasoned[7] = JSON.stringify({ quality: { action: "accept", reason: "" }, clarity: { action: "accept", reason: "" } }); await rejectsSql(insert, unreasoned);
      const missingSource = [...params]; missingSource[6] = null; missingSource[7] = null; await rejectsSql(insert, missingSource);
      const wrongSource = [...params]; wrongSource[6] = (await listReviews(db, owner.id)).find((r) => r.id !== review.id)!.id; await rejectsSql(insert, wrongSource);
      const final = (await finalizeReview(db, owner.id, review.id, input)).assessment;
      await rejectsSql(insert, params, "23505");
      for (const id of [review.id, final.id]) {
        await rejectsSql("UPDATE assessments SET rationale = 'Tampered reasoning' WHERE id = $1", [id]);
        await rejectsSql("DELETE FROM assessments WHERE id = $1", [id]);
      }
      await rejectsSql("UPDATE evaluation_runs SET model_version = 'tampered' WHERE id = $1", [review.jobId]);
      await rejectsSql("UPDATE evidence SET excerpt = 'tampered' WHERE evaluation_run_id = $1", [review.jobId]);
      await rejectsSql("DELETE FROM findings WHERE evaluation_run_id = $1", [review.jobId]);
    });
  } finally { await fixture.close(); }
});
