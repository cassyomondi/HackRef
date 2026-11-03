import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  organizerSessions,
  organizerUsers,
  evaluationRuns,
  rubricVersions,
  submissions,
} from "../../src/db/schema";
import { seedDemo } from "../../src/db/demo-seed";
import { authenticate, login, logout } from "../../src/lib/auth-service";
import { AppError } from "../../src/lib/errors";
import {
  addRubric,
  ownedSubmission,
  registerSubmission,
  saveEvent,
} from "../../src/lib/event-service";
import {
  claimJob,
  completeJob,
  failJob,
  ownedJob,
  processJob,
  queueEvaluation,
} from "../../src/lib/jobs";
import { hashPassword } from "../../src/lib/password";
import { isolatedDatabase } from "../helpers/database";
import { githubFixture, submissionFixture } from "../helpers/github";

const isStatus = (status: number) => (error: unknown) =>
  error instanceof AppError && error.status === status;

test("organizer authentication, immutable inputs, authorization and durable jobs", async (t) => {
  const fixture = await isolatedDatabase();
  const { db, pool } = fixture;
  try {
    const password = randomBytes(24).toString("base64url");
    const passwordHash = await hashPassword(password);
    const [organizer] = await db
      .insert(organizerUsers)
      .values({
        email: "organizer@example.test",
        displayName: "Organizer fixture",
        passwordHash,
      })
      .returning();
    const [other] = await db
      .insert(organizerUsers)
      .values({
        email: "other@example.test",
        displayName: "Unprovisioned organizer fixture",
      })
      .returning();

    await t.test(
      "password verification, generic login failure, hashed sessions, expiry and revocation",
      async () => {
        await assert.rejects(
          db.insert(organizerUsers).values({
            email: "second-provisioned@example.test",
            displayName: "Not allowed",
            passwordHash,
          }),
        );
        await assert.rejects(
          login(db, { email: organizer.email, password: "incorrect password" }),
          isStatus(401),
        );
        await assert.rejects(
          login(db, { email: "missing@example.test", password }),
          isStatus(401),
        );
        await assert.rejects(authenticate(db, undefined), isStatus(401));
        await assert.rejects(
          authenticate(db, randomBytes(32).toString("hex")),
          isStatus(401),
        );
        const token = await login(db, {
          email: organizer.email.toUpperCase(),
          password,
        });
        assert.equal((await authenticate(db, token)).id, organizer.id);
        const [stored] = await db.select().from(organizerSessions);
        assert.notEqual(stored.tokenHash, token);
        await logout(db, token);
        await assert.rejects(authenticate(db, token), isStatus(401));
        const expired = await login(db, { email: organizer.email, password });
        await db.update(organizerSessions).set({ expiresAt: new Date(0) });
        await assert.rejects(authenticate(db, expired), isStatus(401));
      },
    );

    await t.test(
      "a shared atomic login limit prevents brute force across instances",
      async () => {
        await pool.query("UPDATE login_limits SET attempts = 9");
        const attempts = await Promise.allSettled([
          login(db, { email: organizer.email, password: "wrong" }),
          login(db, { email: organizer.email, password: "wrong" }),
        ]);
        const statuses = attempts
          .map((v) => v.status === "rejected" && v.reason.status)
          .sort();
        assert.deepEqual(statuses, [401, 429]);
        await pool.query(
          "UPDATE login_limits SET window_started_at = now() - interval '16 minutes'",
        );
        const token = await login(db, { email: organizer.email, password });
        await logout(db, token);
      },
    );

    await t.test(
      "demo seed is idempotent and never creates credentials or fabricated findings",
      async () => {
        const first = await seedDemo(db);
        assert.equal(await seedDemo(db), first);
        const count = await pool.query(
          "SELECT (SELECT count(*) FROM submissions) AS submissions, (SELECT count(*) FROM rubric_versions) AS rubrics, (SELECT count(*) FROM assessments) AS assessments, (SELECT count(*) FROM findings) AS findings",
        );
        assert.deepEqual(count.rows[0], {
          submissions: "1",
          rubrics: "1",
          assessments: "0",
          findings: "0",
        });
        // Remove these unreferenced demo fixtures only within this separate test schema.
        await pool.query("DELETE FROM submissions");
        await pool.query("DELETE FROM rubric_versions");
        await pool.query("DELETE FROM hackathon_events");
      },
    );

    const event = await saveEvent(db, organizer.id, {
      name: "Test event",
      slug: "test-event",
      deadlineAt: "2026-11-12T20:59:59Z",
      status: "open",
    });
    const otherEvent = await saveEvent(db, other.id, {
      name: "Other event",
      slug: "other-event",
      deadlineAt: "2026-11-12T20:59:59Z",
      status: "draft",
    });
    const rubricData = {
      title: "Test rubric",
      criteria: [{ key: "quality", label: "Quality", maxScore: 10 }],
    };
    const rubric = await addRubric(db, organizer.id, rubricData);
    const foreignRubric = await addRubric(db, other.id, rubricData);
    const submission = await registerSubmission(
      db,
      organizer.id,
      submissionFixture,
      githubFixture,
    );

    await t.test(
      "event updates retain identity; concurrent rubric publication creates separate versions",
      async () => {
        assert.equal(
          (
            await saveEvent(db, organizer.id, {
              name: "Updated",
              slug: "test-event",
              deadlineAt: "2026-11-12T20:59:59Z",
              status: "judging",
            })
          ).id,
          event.id,
        );
        const versions = await Promise.all([
          addRubric(db, organizer.id, rubricData),
          addRubric(db, organizer.id, rubricData),
        ]);
        assert.deepEqual(versions.map((v) => v.version).sort(), [2, 3]);
        await assert.rejects(seedDemo(db), isStatus(409));
      },
    );

    await t.test(
      "registration canonicalizes URLs, pins GitHub's SHA and persists explicit claims",
      async () => {
        assert.equal(
          submission.repositoryUrl,
          "https://github.com/octocat/hello-world",
        );
        assert.equal(
          submission.commitSha,
          "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
        );
        assert.deepEqual(submission.claims, submissionFixture.claims);
        await assert.rejects(
          registerSubmission(
            db,
            organizer.id,
            {
              ...submissionFixture,
              repositoryUrl: "https://github.com/OCTOCAT/HELLO-WORLD",
            },
            githubFixture,
          ),
          isStatus(409),
        );
        await assert.rejects(
          db
            .update(submissions)
            .set({ claims: ["silently replaced"] })
            .where(eq(submissions.id, submission.id)),
        );
        await assert.rejects(
          db
            .update(rubricVersions)
            .set({ title: "Silently replaced" })
            .where(eq(rubricVersions.id, rubric.id)),
        );
      },
    );

    await t.test(
      "submission and evaluation ownership is enforced before queueing",
      async () => {
        await assert.rejects(
          ownedSubmission(db, other.id, submission.id),
          isStatus(404),
        );
        await assert.rejects(
          queueEvaluation(db, other.id, {
            submissionId: submission.id,
            rubricVersionId: foreignRubric.id,
          }),
          isStatus(404),
        );
        await assert.rejects(
          queueEvaluation(db, organizer.id, {
            submissionId: submission.id,
            rubricVersionId: foreignRubric.id,
          }),
          isStatus(404),
        );
        assert.notEqual(event.id, otherEvent.id);
      },
    );

    let jobId = "";
    await t.test(
      "simultaneous duplicate queue requests create exactly one durable job",
      async () => {
        const queued = await Promise.all(
          Array.from({ length: 5 }, () =>
            queueEvaluation(db, organizer.id, {
              submissionId: submission.id,
              rubricVersionId: rubric.id,
            }),
          ),
        );
        assert.equal(queued.filter((j) => j.created).length, 1);
        assert.equal(new Set(queued.map((j) => j.job.id)).size, 1);
        jobId = queued[0].job.id;
        await assert.rejects(ownedJob(db, other.id, jobId), isStatus(404));
        assert.equal(
          (await ownedJob(db, organizer.id, jobId)).status,
          "queued",
        );
      },
    );

    await t.test(
      "competing workers claim once; crash recovery fences the stale worker",
      async () => {
        const claims = await Promise.all([
          claimJob(db),
          claimJob(db),
          claimJob(db),
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
        const first = claims.find((j) => j)!;
        assert.equal(first.id, jobId);
        assert.equal(first.attempts, 1);
        await pool.query(
          "UPDATE evaluation_runs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
          [jobId],
        );
        const recovered = await claimJob(db);
        assert.ok(recovered);
        assert.equal(recovered.id, first.id);
        assert.equal(recovered.attempts, 2);
        assert.notEqual(recovered.leaseToken, first.leaseToken);
        assert.equal(await completeJob(db, first, { stale: true }), false);
        assert.equal(await failJob(db, first, new Error("stale")), false);
        assert.equal(await processJob(db, recovered, githubFixture), true);
        const completed = await ownedJob(db, organizer.id, jobId);
        assert.equal(completed.status, "completed");
        assert.equal(completed.result?.claims, "NOT_EVALUATED");
        assert.equal(completed.result?.assessment, "NOT_EVALUATED");
        assert.equal(completed.leaseToken, null);
        const count = await pool.query(
          "SELECT (SELECT count(*) FROM assessments) AS assessments, (SELECT count(*) FROM findings) AS findings, (SELECT count(*) FROM evidence) AS evidence",
        );
        assert.deepEqual(count.rows[0], {
          assessments: "0",
          findings: "0",
          evidence: "0",
        });
      },
    );

    await t.test(
      "transient dependency failures retry with backoff and stop at the attempt limit",
      async () => {
        const nextRubric = await addRubric(db, organizer.id, rubricData);
        const queued = await queueEvaluation(db, organizer.id, {
          submissionId: submission.id,
          rubricVersionId: nextRubric.id,
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          const job = await claimJob(db);
          assert.ok(job);
          assert.equal(job.id, queued.job.id);
          assert.equal(job.attempts, attempt);
          await processJob(
            db,
            job,
            async () =>
              new Response("sensitive provider response", { status: 503 }),
          );
          const status = await ownedJob(db, organizer.id, job.id);
          assert.equal(status.status, attempt < 3 ? "queued" : "failed");
          assert.ok(!status.lastError?.includes("sensitive"));
          if (attempt < 3) {
            assert.equal(await claimJob(db), null);
            await pool.query(
              "UPDATE evaluation_runs SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
              [job.id],
            );
          }
        }
        assert.equal(await claimJob(db), null);
        assert.equal(
          (
            await queueEvaluation(db, organizer.id, {
              submissionId: submission.id,
              rubricVersionId: nextRubric.id,
            })
          ).created,
          false,
        );
      },
    );

    await t.test(
      "permanent GitHub errors fail without retry; final abandoned attempts are recovered to failed",
      async () => {
        const permanentRubric = await addRubric(db, organizer.id, rubricData);
        await queueEvaluation(db, organizer.id, {
          submissionId: submission.id,
          rubricVersionId: permanentRubric.id,
        });
        const permanent = await claimJob(db);
        assert.ok(permanent);
        await processJob(
          db,
          permanent,
          async () => new Response("", { status: 404 }),
        );
        assert.equal(
          (await ownedJob(db, organizer.id, permanent.id)).status,
          "failed",
        );
        const crashRubric = await addRubric(db, organizer.id, rubricData);
        const queued = await queueEvaluation(db, organizer.id, {
          submissionId: submission.id,
          rubricVersionId: crashRubric.id,
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          const active = await claimJob(db);
          assert.ok(active);
          assert.equal(active.attempts, attempt);
          await db
            .update(evaluationRuns)
            .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
            .where(eq(evaluationRuns.id, active.id));
          assert.equal(await completeJob(db, active, { tooLate: true }), false);
        }
        assert.equal(await claimJob(db), null);
        const exhausted = await ownedJob(db, organizer.id, queued.job.id);
        assert.equal(exhausted.status, "failed");
        assert.equal(exhausted.attempts, 3);
        assert.ok(exhausted.finishedAt);
        await assert.rejects(
          db
            .update(evaluationRuns)
            .set({ attempts: 4 })
            .where(eq(evaluationRuns.id, queued.job.id)),
        );
        await assert.rejects(
          db
            .update(evaluationRuns)
            .set({ status: "running", leaseToken: randomUUID() })
            .where(eq(evaluationRuns.id, queued.job.id)),
        );
      },
    );
    await t.test(
      "rate-limited jobs persist the upstream deadline across workers without an early retry",
      async () => {
        const limitedRubric = await addRubric(db, organizer.id, rubricData);
        const queued = await queueEvaluation(db, organizer.id, {
          submissionId: submission.id,
          rubricVersionId: limitedRubric.id,
        });
        const active = await claimJob(db);
        assert.ok(active);
        assert.equal(active.id, queued.job.id);
        const reset = Math.ceil(Date.now() / 1000) + 3600;
        let calls = 0;
        await processJob(db, active, async () => {
          calls++;
          return new Response("raw upstream body must not be persisted", {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(reset),
              "retry-after": "7200",
            },
          });
        });
        const waiting = await ownedJob(db, organizer.id, active.id);
        assert.equal(calls, 1);
        assert.equal(waiting.status, "queued");
        assert.equal(waiting.attempts, 1);
        assert.ok(waiting.nextAttemptAt.getTime() >= (reset + 1) * 1000);
        assert.ok(waiting.nextAttemptAt.getTime() >= Date.now() + 7190_000);
        assert.match(waiting.lastError ?? "", /rate limit/);
        assert.ok(!waiting.lastError?.includes("raw upstream body"));
        assert.equal(
          await claimJob(db),
          null,
          "A different claim cycle must respect the durable retry deadline.",
        );
      },
    );
  } finally {
    await fixture.close();
  }
});
