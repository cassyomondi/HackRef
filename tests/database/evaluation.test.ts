import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { assessments, evaluationRuns, evidence, findings, organizerUsers } from "../../src/db/schema";
import { addRubric, registerSubmission, saveEvent } from "../../src/lib/event-service";
import { AppError } from "../../src/lib/errors";
import { claimJob, failJob, ownedJob, PIPELINE_VERSION, processJob, queueEvaluation } from "../../src/lib/jobs";
import { AI_PIPELINE_VERSION, assessSource, providerError } from "../../src/lib/evaluation/model";
import { listReviews } from "../../src/lib/evaluation/reviews";
import { collectSource } from "../../src/lib/evaluation/source";
import { persistDraft, renewLease } from "../../src/lib/evaluation/worker";
import { isolatedDatabase } from "../helpers/database";
import { githubFixture, submissionFixture } from "../helpers/github";
import { modelDraft, modelFixture, modelOptions } from "../helpers/model";
import { sourceFixture } from "../helpers/source";
import { PROVIDER_SCHEMA_VERSION } from "../../src/lib/evaluation/provider-schema";

test("AI evaluation persistence, isolation, concurrency and recovery", { timeout: 90_000 }, async (t) => {
  const fixture = await isolatedDatabase(); const { db, pool } = fixture;
  try {
    const [organizer, other] = await db.insert(organizerUsers).values([
      { email: "ai@example.test", displayName: "AI fixture" },
      { email: "other-ai@example.test", displayName: "Other fixture" },
    ]).returning();
    await saveEvent(db, organizer.id, { name: "AI event", slug: "ai-event", deadlineAt: "2026-11-12T20:59:59Z", status: "judging" });
    await saveEvent(db, other.id, { name: "Other event", slug: "other-ai-event", deadlineAt: "2026-11-12T20:59:59Z", status: "judging" });
    const submission = await registerSubmission(db, organizer.id, submissionFixture, githubFixture);
    const rubricData = { title: "Exact rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] };
    const enqueue = async () => {
      const rubric = await addRubric(db, organizer.id, rubricData);
      const queued = await queueEvaluation(db, organizer.id, { submissionId: submission.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION);
      return { rubric, queued };
    };
    const artifactCount = async (runId: string) => {
      const result = await pool.query("SELECT (SELECT count(*) FROM assessments WHERE evaluation_run_id = $1) AS assessments, (SELECT count(*) FROM evidence WHERE evaluation_run_id = $1) AS evidence, (SELECT count(*) FROM findings WHERE evaluation_run_id = $1) AS findings", [runId]);
      return result.rows[0];
    };

    await t.test("AI queue identity is distinct; historical PASS 2 jobs and finalized assessments are unchanged", async () => {
      const { rubric, queued } = await enqueue();
      const legacy = await queueEvaluation(db, organizer.id, { submissionId: submission.id, rubricVersionId: rubric.id });
      assert.notEqual(queued.job.id, legacy.job.id);
      assert.equal(legacy.job.evidenceVersion, PIPELINE_VERSION);
      const claims = await Promise.all([claimJob(db), claimJob(db), claimJob(db)]);
      assert.equal(claims.filter(Boolean).length, 2);
      const oldJob = claims.find((j) => j?.id === legacy.job.id)!;
      assert.equal(await processJob(db, oldJob, githubFixture), true);
      assert.equal((await ownedJob(db, organizer.id, oldJob.id)).result?.assessment, "NOT_EVALUATED");
      assert.deepEqual(await artifactCount(oldJob.id), { assessments: "0", evidence: "0", findings: "0" });
      // Historical finalized records can coexist and are never overwritten.
      await db.insert(assessments).values({ eventId: submission.eventId, submissionId: submission.id, evaluationRunId: oldJob.id, version: 1, status: "finalized", scores: { quality: 8 }, rationale: "Historical human decision", finalizedBy: organizer.id, finalizedAt: new Date() });
      const aiJob = claims.find((j) => j?.id === queued.job.id)!;
      assert.equal(await processJob(db, aiJob, sourceFixture(), modelOptions), true);
      const [historical] = await db.select().from(assessments).where(eq(assessments.evaluationRunId, oldJob.id));
      assert.equal(historical.rationale, "Historical human decision"); assert.equal(historical.status, "finalized");
    });

    await t.test("duplicate requests and competing workers publish exactly one atomic draft", async () => {
      const rubric = await addRubric(db, organizer.id, rubricData);
      const jobs = await Promise.all(Array.from({ length: 5 }, () => queueEvaluation(db, organizer.id, { submissionId: submission.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION)));
      assert.equal(jobs.filter((j) => j.created).length, 1);
      const claims = await Promise.all([claimJob(db), claimJob(db), claimJob(db)]);
      assert.equal(claims.filter(Boolean).length, 1);
      const job = claims.find(Boolean)!;
      assert.equal(await processJob(db, job, sourceFixture(), modelOptions), true);
      assert.equal(await processJob(db, job, sourceFixture(), modelOptions), false);
      assert.deepEqual(await artifactCount(job.id), { assessments: "1", evidence: "4", findings: "1" });
      const stored = await ownedJob(db, organizer.id, job.id);
      assert.equal(stored.result?.assessment, "DRAFT"); assert.equal(stored.modelVersion, "mock-gemini-test-version"); assert.ok(stored.promptVersion);
      assert.equal(stored.result?.providerSchemaVersion, PROVIDER_SCHEMA_VERSION);
      const [assessment] = await db.select().from(assessments).where(eq(assessments.evaluationRunId, job.id));
      assert.deepEqual(assessment.scores, { quality: 4 }); assert.equal(assessment.status, "draft"); assert.equal(assessment.finalizedAt, null);
      assert.ok((await db.select().from(findings).where(eq(findings.evaluationRunId, job.id))).every((f) => f.status === "UNVERIFIED"));
      assert.ok((await db.select().from(evidence).where(eq(evidence.evaluationRunId, job.id))).every((e) => e.status === "UNVERIFIED"));
      const reviews = await listReviews(db, organizer.id, submission.id);
      assert.ok(reviews.some((r) => r.jobId === job.id && r.evidence.length === 4));
      assert.deepEqual(await listReviews(db, other.id, submission.id), []);
      await assert.rejects(ownedJob(db, other.id, job.id), (error: unknown) => error instanceof AppError && error.status === 404);
    });

    await t.test("expired workers cannot renew or publish; recovered workers write once", async () => {
      const { rubric, queued } = await enqueue();
      const stale = await claimJob(db); assert.ok(stale);
      const source = await collectSource(submission, stale.id, sourceFixture());
      const result = await assessSource(source, rubric, submission.claims, modelOptions);
      await pool.query("UPDATE evaluation_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [stale.id]);
      assert.equal(await renewLease(db, stale), false);
      const recovered = await claimJob(db); assert.ok(recovered); assert.equal(recovered.id, queued.job.id);
      assert.equal(await persistDraft(db, stale, source, result), false);
      assert.equal(await failJob(db, stale, new Error("stale")), false);
      assert.deepEqual(await artifactCount(stale.id), { assessments: "0", evidence: "0", findings: "0" });
      assert.equal(await processJob(db, recovered, sourceFixture(), modelOptions), true);
      assert.equal((await artifactCount(stale.id)).assessments, "1");
    });

    await t.test("lease renewal covers slow provider calls and prevents concurrent recovery", async () => {
      await enqueue(); const job = await claimJob(db); assert.ok(job);
      let renewed = false;
      const success = await processJob(db, job, sourceFixture(), { model: "mock", transport: async (request) => {
        const [before] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, job.id));
        await delay(10_500);
        const [after] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, job.id));
        renewed = after.leaseExpiresAt!.getTime() > before.leaseExpiresAt!.getTime() + 5000;
        assert.equal(await claimJob(db), null);
        return modelFixture(request);
      } });
      assert.equal(success, true); assert.equal(renewed, true);
    });

    await t.test("lease lost during Gemini cannot publish stale artifacts", async () => {
      await enqueue(); const stale = await claimJob(db); assert.ok(stale);
      const success = await processJob(db, stale, sourceFixture(), { model: "mock", transport: async (request) => {
        await pool.query("UPDATE evaluation_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [stale.id]);
        const recovered = await claimJob(db); assert.ok(recovered);
        assert.equal(await processJob(db, recovered, sourceFixture(), modelOptions), true);
        return modelFixture(request);
      } });
      assert.equal(success, false); assert.deepEqual(await artifactCount(stale.id), { assessments: "1", evidence: "4", findings: "1" });
    });

    await t.test("fake model citations roll back all artifacts; missing evidence never calls Gemini", async () => {
      for (const missing of [false, true]) {
        await enqueue(); const job = await claimJob(db); assert.ok(job); let calls = 0;
        assert.equal(await processJob(db, job, sourceFixture(missing ? {} : undefined), { model: "mock", transport: async (request) => {
          calls++; const draft = modelDraft(request); draft.criteria[0].findings[0].citation.path = "invented.ts";
          return { text: JSON.stringify(draft), modelVersion: "mock-version", finishReason: "STOP" };
        } }), false);
        assert.equal(calls, missing ? 0 : 1);
        assert.equal((await ownedJob(db, organizer.id, job.id)).status, "failed");
        assert.deepEqual(await artifactCount(job.id), { assessments: "0", evidence: "0", findings: "0" });
      }
    });

    await t.test("partial evidence persists with truthful limitations and unsupported criteria remain unscored", async () => {
      await enqueue(); const job = await claimJob(db); assert.ok(job);
      assert.equal(await processJob(db, job, sourceFixture(undefined, { truncated: true }), { model: "mock", transport: async (request) => {
        const draft = modelDraft(request);
        draft.criteria[0] = { ...draft.criteria[0], suggestedScore: null, status: "NOT_EVALUATED", citations: [], findings: [] };
        return { text: JSON.stringify(draft), modelVersion: "mock-partial", finishReason: "STOP" };
      } }), true);
      const [assessment] = await db.select().from(assessments).where(eq(assessments.evaluationRunId, job.id));
      assert.deepEqual(assessment.scores, {});
      const review = (await listReviews(db, organizer.id)).find((r) => r.jobId === job.id)!;
      assert.equal(review.coverage.treeTruncated, true); assert.equal(review.draft.criteria[0].status, "NOT_EVALUATED");
    });

    await t.test("provider cooldown persists durably and recovered attempts do not duplicate artifacts", async () => {
      await enqueue(); const job = await claimJob(db); assert.ok(job);
      await processJob(db, job, sourceFixture(), { model: "mock", transport: async () => { throw providerError(Object.assign(new Error("rate limited private details"), { status: 429 })); } });
      const waiting = await ownedJob(db, organizer.id, job.id);
      assert.equal(waiting.status, "queued"); assert.ok(waiting.nextAttemptAt.getTime() >= Date.now() + 55_000); assert.ok(!waiting.lastError?.includes("private"));
      assert.equal(await claimJob(db), null); assert.equal((await artifactCount(job.id)).assessments, "0");
      await pool.query("UPDATE evaluation_runs SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [job.id]);
      const retry = await claimJob(db); assert.ok(retry);
      assert.equal(await processJob(db, retry, sourceFixture(), modelOptions), true);
      assert.equal((await artifactCount(job.id)).assessments, "1");
    });

    await t.test("atomic publication rolls back earlier inserts when a later write fails", async () => {
      const { rubric } = await enqueue(); const job = await claimJob(db); assert.ok(job);
      const source = await collectSource(submission, job.id, sourceFixture());
      const result = await assessSource(source, rubric, submission.claims, modelOptions);
      await db.insert(assessments).values({ evaluationRunId: job.id, eventId: job.eventId, submissionId: job.submissionId, version: 1, scores: {}, rationale: "Existing record proves conflict rollback" });
      await assert.rejects(persistDraft(db, job, source, result));
      assert.deepEqual(await artifactCount(job.id), { assessments: "1", evidence: "0", findings: "0" });
      assert.equal((await ownedJob(db, organizer.id, job.id)).status, "running");
      await failJob(db, job, new AppError(422, "Test conflict"));
      assert.equal((await db.select().from(evidence).where(and(eq(evidence.evaluationRunId, job.id), eq(evidence.status, "VERIFIED")))) .length, 0);
    });

    await t.test("invalid provider contracts persist only safe field diagnostics and partial evidence without scores", async () => {
      await enqueue(); const job = await claimJob(db); assert.ok(job);
      await processJob(db, job, sourceFixture(undefined, { truncated: true }), { model: "mock-3.5-flash", transport: async () => {
        throw providerError(Object.assign(new Error(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "private upstream payload", details: [{ fieldViolations: [{ field: "generation_config.response_json_schema", description: "Schema too complex; private upstream payload" }] }] } })), { status: 400 }));
      } });
      const stored = await ownedJob(db, organizer.id, job.id);
      assert.equal(stored.status, "failed");
      assert.equal(stored.result?.assessment, "NOT_EVALUATED"); assert.equal(stored.result?.draft, undefined);
      assert.equal(stored.result?.providerSchemaVersion, PROVIDER_SCHEMA_VERSION);
      assert.deepEqual(stored.result?.providerError, { code: "GEMINI_INVALID_REQUEST", status: 400, diagnostics: { category: "SCHEMA_COMPLEXITY", fieldPaths: ["generationConfig.responseJsonSchema"], reasons: ["SCHEMA_COMPLEXITY"] } });
      assert.ok(!JSON.stringify(stored.result).includes("private upstream payload"));
      assert.deepEqual(await artifactCount(job.id), { assessments: "0", evidence: "0", findings: "0" });
    });

    await t.test("lease expiry inside the publication transaction rolls back every artifact", async () => {
      const { rubric } = await enqueue(); const job = await claimJob(db); assert.ok(job);
      const source = await collectSource(submission, job.id, sourceFixture());
      const result = await assessSource(source, rubric, submission.claims, modelOptions);
      // Only this isolated schema is changed. Delay after the row lock to prove
      // publication uses the wall clock, not PostgreSQL's transaction-start now().
      await pool.query("CREATE FUNCTION slow_assessment_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$");
      await pool.query("CREATE TRIGGER slow_assessment_insert BEFORE INSERT ON assessments FOR EACH ROW EXECUTE FUNCTION slow_assessment_insert()");
      try {
        await pool.query("UPDATE evaluation_runs SET lease_expires_at = clock_timestamp() + interval '0.15 second' WHERE id = $1", [job.id]);
        assert.equal(await persistDraft(db, job, source, result), false);
        assert.deepEqual(await artifactCount(job.id), { assessments: "0", evidence: "0", findings: "0" });
      } finally {
        await pool.query("DROP TRIGGER slow_assessment_insert ON assessments");
        await pool.query("DROP FUNCTION slow_assessment_insert()");
      }
      await pool.query("UPDATE evaluation_runs SET lease_expires_at = now() - interval '1 second', attempts = max_attempts WHERE id = $1", [job.id]);
      assert.equal(await claimJob(db), null);
      assert.equal((await ownedJob(db, organizer.id, job.id)).status, "failed");
    });
  } finally { await fixture.close(); }
});
