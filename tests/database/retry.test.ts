import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { assessments, evaluationRuns, organizerUsers } from "../../src/db/schema";
import { AppError } from "../../src/lib/errors";
import { addRubric, registerSubmission, saveEvent } from "../../src/lib/event-service";
import { claimJob, completeJob, ownedJob, processJob, publicJob, queueEvaluation } from "../../src/lib/jobs";
import { retryEvaluation } from "../../src/lib/evaluation/retry";
import { MAX_MANUAL_RETRIES, retryIdentity } from "../../src/lib/evaluation/retry-identity";
import { providerError } from "../../src/lib/evaluation/provider-errors";
import { AI_PIPELINE_VERSION } from "../../src/lib/evaluation/versions";
import { isolatedDatabase } from "../helpers/database";
import { githubFixture, submissionFixture } from "../helpers/github";
import { sourceFixture } from "../helpers/source";
import { modelOptions } from "../helpers/model";

const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test("organizer manual retries preserve history, exact inputs and bounded durable identity", async (t) => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  try {
    const [organizer, other] = await db.insert(organizerUsers).values([
      { email: "retry@example.test", displayName: "Retry fixture" },
      { email: "other-retry@example.test", displayName: "Other fixture" },
    ]).returning();
    for (const [owner, slug] of [[organizer, "retry"], [other, "other-retry"]] as const)
      await saveEvent(db, owner.id, { name: slug, slug, deadlineAt: "2026-11-12T20:59:59Z", status: "judging" });
    const submission = await registerSubmission(db, organizer.id, submissionFixture, githubFixture);
    const rubricData = { title: "Retry rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] };
    const finish = async (id: string) => {
      await db.update(evaluationRuns).set({ status: "failed", finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null,
        lastError: "Historical Gemini API key or model access is unavailable.",
        result: { assessment: "NOT_EVALUATED", limitation: "Partial source; no scores published.", source: { coverage: { treeTruncated: true, limitations: ["Partial source"] } } },
      }).where(eq(evaluationRuns.id, id));
      return ownedJob(db, organizer.id, id);
    };
    const failed = async (pipeline = AI_PIPELINE_VERSION) => {
      const rubric = await addRubric(db, organizer.id, rubricData);
      const queued = await queueEvaluation(db, organizer.id, { submissionId: submission.id, rubricVersionId: rubric.id }, pipeline);
      return finish(queued.job.id);
    };

    await t.test("retry checks ownership and hides foreign/missing jobs before mutation", async () => {
      const parent = await failed();
      await assert.rejects(retryEvaluation(db, other.id, parent.id), status(404));
      await assert.rejects(retryEvaluation(db, organizer.id, randomUUID()), status(404));
      await assert.rejects(retryEvaluation(db, organizer.id, "not-a-uuid"));
      assert.deepEqual(await ownedJob(db, organizer.id, parent.id), parent);
    });

    await t.test("simultaneous requests create one retry with the original rubric and unchanged diagnostics", async () => {
      const parent = await failed();
      await addRubric(db, organizer.id, rubricData); // The newest rubric must not replace the pinned one.
      const responses = await Promise.all(Array.from({ length: 8 }, () => retryEvaluation(db, organizer.id, parent.id)));
      assert.equal(responses.filter((r) => r.created).length, 1);
      assert.equal(new Set(responses.map((r) => r.job.id)).size, 1);
      const child = responses[0].job;
      assert.notEqual(child.id, parent.id); assert.equal(child.status, "queued"); assert.equal(child.attempts, 0);
      assert.equal(child.eventId, parent.eventId); assert.equal(child.submissionId, parent.submissionId); assert.equal(child.rubricVersionId, parent.rubricVersionId);
      assert.equal(child.result, null); assert.equal(child.lastError, null);
      assert.deepEqual(publicJob(child).retry, { rootJobId: parent.id, parentJobId: parent.id, number: 1 });
      assert.deepEqual(await ownedJob(db, organizer.id, parent.id), parent);
      await finish(child.id);
    });

    await t.test("each failed parent has one child; chains stop after three manual retries", async () => {
      const root = await failed(); let parent = root; let firstId = "";
      for (let number = 1; number <= MAX_MANUAL_RETRIES; number++) {
        const before = parent;
        const created = await retryEvaluation(db, organizer.id, parent.id);
        assert.equal(created.created, true);
        assert.deepEqual(retryIdentity(created.job.idempotencyKey), { rootJobId: root.id, parentJobId: parent.id, number });
        if (number === 1) firstId = created.job.id;
        const replay = await retryEvaluation(db, organizer.id, parent.id);
        assert.equal(replay.created, false); assert.equal(replay.job.id, created.job.id);
        assert.deepEqual(await ownedJob(db, organizer.id, parent.id), before);
        parent = await finish(created.job.id);
        assert.equal((await retryEvaluation(db, organizer.id, root.id)).job.id, firstId);
      }
      assert.equal(publicJob(parent).canRetry, false);
      await assert.rejects(retryEvaluation(db, organizer.id, parent.id), /limit of 3 manual retries/);
      assert.deepEqual(await ownedJob(db, organizer.id, root.id), root);
    });

    await t.test("queued, running, completed, nonterminal and historical pipeline jobs cannot be retried", async () => {
      const parent = await failed();
      for (const state of ["queued", "running", "completed"] as const) {
        await db.update(evaluationRuns).set({ status: state, finishedAt: state === "completed" ? new Date() : null,
          leaseToken: state === "running" ? randomUUID() : null, leaseExpiresAt: state === "running" ? new Date(Date.now() + 60_000) : null,
        }).where(eq(evaluationRuns.id, parent.id));
        await assert.rejects(retryEvaluation(db, organizer.id, parent.id), status(409));
        assert.equal(publicJob(await ownedJob(db, organizer.id, parent.id)).canRetry, false);
      }
      await finish(parent.id);
      await db.update(evaluationRuns).set({ finishedAt: null }).where(eq(evaluationRuns.id, parent.id));
      await assert.rejects(retryEvaluation(db, organizer.id, parent.id), status(409));
      await finish(parent.id);
      const legacy = await failed("pass2-input-validation-v1");
      await assert.rejects(retryEvaluation(db, organizer.id, legacy.id), status(409));
    });

    await t.test("a failed row with a persisted draft or publication marker cannot be retried", async () => {
      const parent = await failed();
      await db.insert(assessments).values({ eventId: parent.eventId, submissionId: parent.submissionId, evaluationRunId: parent.id, version: 1, status: "draft", scores: {}, rationale: "Existing draft" });
      await assert.rejects(retryEvaluation(db, organizer.id, parent.id), /already published/);
      const marked = await failed();
      await db.update(evaluationRuns).set({ result: { assessment: "DRAFT", assessmentId: randomUUID() } }).where(eq(evaluationRuns.id, marked.id));
      await assert.rejects(retryEvaluation(db, organizer.id, marked.id), /already published/);
    });

    await t.test("provider 503 uses bounded automatic backoff, preserves partial evidence and ends without scores", async () => {
      const root = await failed();
      const { job: child } = await retryEvaluation(db, organizer.id, root.id);
      const rootBefore = await ownedJob(db, organizer.id, root.id);
      for (let attempt = 1; attempt <= child.maxAttempts; attempt++) {
        const claimed = await claimJob(db); assert.ok(claimed); assert.equal(claimed.id, child.id);
        await processJob(db, claimed, sourceFixture(undefined, { truncated: true }), { model: "mock-3.5-flash", transport: async () => { throw providerError(Object.assign(new Error("API key invalid misleading upstream body"), { status: 503 })); } });
        const stored = await ownedJob(db, organizer.id, child.id);
        assert.equal(stored.status, attempt < child.maxAttempts ? "queued" : "failed");
        assert.match(stored.lastError!, /temporarily unavailable \(HTTP 503\)/);
        assert.doesNotMatch(stored.lastError!, /key|permission/i);
        assert.deepEqual(stored.result?.providerError, { code: "GEMINI_UNAVAILABLE", status: 503 });
        assert.equal(stored.result?.assessment, "NOT_EVALUATED"); assert.equal(stored.result?.draft, undefined);
        const source = stored.result?.source as { coverage: { treeTruncated: boolean } };
        assert.equal(source.coverage.treeTruncated, true);
        assert.deepEqual(retryIdentity(stored.idempotencyKey), { rootJobId: root.id, parentJobId: root.id, number: 1 });
        if (attempt < child.maxAttempts) {
          assert.ok(stored.nextAttemptAt.getTime() > Date.now() + 3000);
          assert.equal(await claimJob(db), null);
          await pool.query("UPDATE evaluation_runs SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [child.id]);
        }
      }
      const count = await pool.query("SELECT count(*) FROM assessments WHERE evaluation_run_id = $1", [child.id]);
      assert.equal(count.rows[0].count, "0");
      assert.deepEqual(await ownedJob(db, organizer.id, root.id), rootBefore);
      const replay = await retryEvaluation(db, organizer.id, root.id);
      assert.equal(replay.created, false); assert.equal(replay.job.id, child.id);
    });

    await t.test("retry jobs use worker recovery/publication fencing and remain idempotent after completion", async () => {
      const root = await failed(); const created = await retryEvaluation(db, organizer.id, root.id);
      const stale = await claimJob(db); assert.ok(stale); assert.equal(stale.id, created.job.id);
      await pool.query("UPDATE evaluation_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [stale.id]);
      const recovered = await claimJob(db); assert.ok(recovered);
      assert.equal(await completeJob(db, stale, { stale: true }), false);
      assert.equal(await processJob(db, recovered, sourceFixture(), modelOptions), true);
      const completed = await ownedJob(db, organizer.id, recovered.id);
      assert.equal(completed.result?.commitSha, submission.commitSha);
      assert.equal(completed.rubricVersionId, root.rubricVersionId);
      assert.deepEqual(publicJob(completed).retry, { rootJobId: root.id, parentJobId: root.id, number: 1 });
      assert.equal((await retryEvaluation(db, organizer.id, root.id)).job.id, completed.id);
      await assert.rejects(retryEvaluation(db, organizer.id, completed.id), status(409));
      const rows = await db.select().from(assessments).where(eq(assessments.evaluationRunId, completed.id));
      assert.equal(rows.length, 1); assert.equal(rows[0].status, "draft");
      assert.deepEqual(await ownedJob(db, organizer.id, root.id), root);
    });
  } finally { await fixture.close(); }
});
