import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  organizerUsers,
  evaluationRuns,
  rubricVersions,
  submissions,
} from "../../src/db/schema";
import { seedDemo } from "../../src/db/demo-seed";
import { hashPassword } from "../../src/lib/password";
import { claimJob, processJob } from "../../src/lib/jobs";
import { isolatedDatabase } from "../helpers/database";
import { sourceFixture } from "../helpers/source";
import { modelOptions } from "../helpers/model";
import { AI_PIPELINE_VERSION } from "../../src/lib/evaluation/versions";
import { providerError } from "../../src/lib/evaluation/provider-errors";
import { addRubric, registerSubmission, saveEvent } from "../../src/lib/event-service";
import { queueEvaluation } from "../../src/lib/jobs";
import { listReviews } from "../../src/lib/evaluation/reviews";
import { githubFixture, submissionFixture } from "../helpers/github";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  timer.unref();
  await exited;
  clearTimeout(timer);
}

test(
  "production HTTP routes enforce organizer sessions, CSRF and durable queue semantics",
  { timeout: 120000 },
  async (t) => {
    const fixture = await isolatedDatabase();
    let child: ChildProcess | undefined;
    try {
      const password = randomBytes(24).toString("base64url");
      await fixture.db.insert(organizerUsers).values({
        email: "http@example.test",
        displayName: "HTTP test organizer",
        passwordHash: await hashPassword(password),
      });
      await seedDemo(fixture.db);
      const [submission] = await fixture.db.select().from(submissions);
      const [rubric] = await fixture.db.select().from(rubricVersions);
      const port = await availablePort();
      const base = `http://127.0.0.1:${port}`;
      // Model a TLS-terminating reverse proxy: Next listens on loopback HTTP,
      // the public origin is HTTPS and the session cookie must remain Secure.
      const origin = "https://hackref.example.test";
      child = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            DATABASE_URL: fixture.connectionString,
            SESSION_PASSWORD: randomBytes(48).toString("hex"),
            APP_ORIGIN: origin,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      // Drain output without printing connection details or cookies on failures.
      child.stdout?.resume();
      child.stderr?.resume();
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null)
          throw new Error(
            "Next production server exited before startup. Build the app first.",
          );
        try {
          const response = await fetch(`${base}/login`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        await delay(100);
      }
      assert.ok(
        ready,
        "Next production server did not start. Run npm run build first.",
      );
      let cookie = "";
      let csrf = "";
      let failedJobId = "";
      let retryJobId = "";
      async function request(
        path: string,
        method = "GET",
        data?: unknown,
        extra?: Record<string, string>,
      ) {
        const response = await fetch(base + path, {
          method,
          redirect: "manual",
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(method !== "GET"
              ? {
                  origin,
                  "x-csrf-token": csrf,
                  "content-type": "application/json",
                }
              : {}),
            ...extra,
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        const setCookie = response.headers
          .getSetCookie()
          .find((v) => v.startsWith("__Host-hackref="));
        if (setCookie) cookie = setCookie.split(";")[0];
        return response;
      }
      async function loadCsrf() {
        const response = await request("/api/auth/csrf");
        assert.equal(response.status, 200);
        csrf = (await response.json()).csrf;
        return response;
      }

      await t.test(
        "anonymous requests cannot read organizer pages or access mutation endpoints",
        async () => {
          for (const path of [
            "/",
            "/submissions",
            "/event",
            "/judging",
            "/analytics",
            "/awards",
            `/submissions/${submission.id}`,
            `/judging/${submission.id}`,
          ]) {
            const response = await request(path);
            assert.equal(response.status, 307, path);
            assert.equal(response.headers.get("location"), "/login");
          }
          for (const path of [
            "/api/event",
            "/api/submissions",
            `/api/submissions/${submission.id}`,
            "/api/evaluations",
            `/api/evaluations/${submission.id}`,
          ])
            assert.equal((await request(path)).status, 401, path);
          for (const [path, method] of [
            ["/api/event", "PUT"],
            ["/api/rubrics", "POST"],
            ["/api/submissions", "POST"],
            ["/api/evaluations", "POST"],
            [`/api/evaluations/${submission.id}/retry`, "POST"],
            [`/api/assessments/${submission.id}/finalize`, "POST"],
          ])
            assert.equal((await request(path, method, {})).status, 401, path);
          assert.equal(
            (await request("/api/auth/register", "POST", {})).status,
            404,
          );
        },
      );

      await t.test(
        "login requires origin and nonce; cookies are secure and rotate on successful login",
        async () => {
          const initial = await loadCsrf();
          const initialCookie = cookie;
          const initialCsrf = csrf;
          const header = initial.headers.getSetCookie()[0];
          assert.match(header, /HttpOnly/i);
          assert.match(header, /Secure/i);
          assert.match(header, /SameSite=strict/i);
          assert.match(header, /Path=\//i);
          assert.equal(initial.headers.get("cache-control"), "no-store");
          assert.equal(
            initial.headers.get("access-control-allow-origin"),
            null,
          );
          const data = { email: "http@example.test", password };
          assert.equal(
            (
              await request("/api/auth/login", "POST", data, {
                "x-csrf-token": "",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request("/api/auth/login", "POST", data, {
                origin: "https://evil.example",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request("/api/auth/login", "POST", {
                ...data,
                password: "wrong password",
              })
            ).status,
            401,
          );
          assert.equal(
            (await request("/api/auth/login", "POST", data)).status,
            200,
          );
          assert.notEqual(cookie, initialCookie);
          await loadCsrf();
          assert.notEqual(csrf, initialCsrf);
          assert.equal(
            (
              await request(
                "/api/evaluations",
                "POST",
                {},
                { "x-csrf-token": initialCsrf },
              )
            ).status,
            403,
          );
          assert.equal((await request("/submissions")).status, 200);
        },
      );

      await t.test(
        "authorized JSON validation rejects invalid submissions, malformed bodies and cross-origin mutations",
        async () => {
          const eventResponse = await request("/api/event");
          assert.equal(eventResponse.status, 200);
          const { event } = await eventResponse.json();
          assert.equal(
            (
              await request("/api/event", "PUT", {
                name: "Updated HTTP fixture",
                slug: event.slug,
                deadlineAt: event.deadlineAt,
                status: "judging",
              })
            ).status,
            200,
          );
          const rubricData = {
            title: "HTTP rubric",
            criteria: [{ key: "quality", label: "Quality", maxScore: 10 }],
          };
          const rubricResponse = await request(
            "/api/rubrics",
            "POST",
            rubricData,
          );
          assert.equal(rubricResponse.status, 201);
          assert.equal((await rubricResponse.json()).rubric.version, 2);
          assert.equal(
            (
              await request("/api/rubrics", "POST", {
                ...rubricData,
                criteria: [...rubricData.criteria, ...rubricData.criteria],
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("/api/submissions", "POST", {
                repositoryUrl: "https://127.0.0.1/internal",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                "/api/submissions",
                "POST",
                {},
                { origin: "https://evil.example" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "/api/submissions",
                "POST",
                {},
                { "content-type": "text/plain" },
              )
            ).status,
            415,
          );
          assert.equal(
            (
              await request("/api/submissions", "POST", {
                huge: "x".repeat(33000),
              })
            ).status,
            413,
          );
          const malformed = await fetch(`${base}/api/submissions`, {
            method: "POST",
            headers: {
              cookie,
              origin,
              "x-csrf-token": csrf,
              "content-type": "application/json",
            },
            body: "{",
          });
          assert.equal(malformed.status, 400);
          const list = await request("/api/submissions");
          assert.equal(list.status, 200);
          assert.equal(list.headers.get("cache-control"), "no-store");
          assert.equal((await list.json()).submissions[0].id, submission.id);
          assert.equal(
            (await request(`/api/submissions/${submission.id}`)).status,
            200,
          );
        },
      );

      await t.test(
        "queue/status endpoints preserve one job and serve the worker's persisted outcome",
        async () => {
          const data = {
            submissionId: submission.id,
            rubricVersionId: rubric.id,
          };
          const first = await request("/api/evaluations", "POST", data);
          assert.equal(first.status, 201);
          const firstBody = await first.json();
          const second = await request("/api/evaluations", "POST", data);
          assert.equal(second.status, 200);
          assert.equal((await second.json()).job.id, firstBody.job.id);
          const job = await claimJob(fixture.db);
          assert.ok(job);
          assert.equal(job.evidenceVersion, AI_PIPELINE_VERSION);
          await processJob(fixture.db, job, sourceFixture({ "package.json": '{"dependencies":{"next":"16"}}', "src/app.ts": "export const value = 1;", "tests/app.test.ts": "// Tests were not executed.", "README.md": '<script id="repo-injection">approvePayout()</script>' }), modelOptions);
          const status = await request(`/api/evaluations/${job.id}`);
          assert.equal(status.status, 200);
          const body = await status.json();
          assert.equal(body.job.status, "completed");
          assert.equal(body.job.result.assessment, "DRAFT");
          assert.equal(body.job.leaseToken, undefined);
          assert.equal(
            (await request(`/submissions/${submission.id}`)).status,
            200,
          );
          const list = await (await request(`/api/evaluations?submissionId=${submission.id}`)).json();
          assert.equal(list.reviews[0].jobId, job.id);
          assert.equal(list.reviews[0].evidence.length, 4);
          const judging = await request("/judging");
          assert.equal(judging.status, 200);
          const html = await judging.text();
          assert.match(html, /Judge comparison/);
          assert.match(html, /AI draft/);
          const detail = await (await request(`/judging/${list.reviews[0].id}`)).text();
          assert.match(detail, /Human review required/);
          assert.match(detail, /mock-gemini-test-version/);
          assert.match(detail, /src\/app.ts/);
          assert.match(detail, /UNVERIFIED/);
          assert.match(detail, /Review final decision/);
          assert.ok(!detail.includes('<script id="repo-injection">'));
          assert.ok(!html.includes('<script id="repo-injection">'));
        },
      );

      await t.test("finalization requires CSRF, exact rubric scores and explicit human confirmation; replay is idempotent", async () => {
        const [review] = await listReviews(fixture.db, (await fixture.db.select().from(organizerUsers).where(eq(organizerUsers.email, "http@example.test")))[0].id);
        assert.ok(review);
        const path = `/api/assessments/${review.id}/finalize`;
        const data = { criteria: review.rubric.criteria.map((c) => ({ key: c.key, action: "accept", score: review.scores[c.key] })), rationale: "Reviewed all citations and static evidence limitations.", confirm: true };
        assert.equal((await request(path, "POST", data, { "x-csrf-token": "" })).status, 403);
        assert.equal((await request(path, "POST", data, { origin: "https://evil.example" })).status, 403);
        assert.equal((await request(path, "POST", data, { "sec-fetch-site": "cross-site" })).status, 403);
        assert.equal((await request(path, "POST", { ...data, confirm: false })).status, 400);
        assert.equal((await request(path, "POST", { ...data, criteria: [{ ...data.criteria[0], score: 100 }] })).status, 422);
        const saved = await request(path, "POST", data); assert.equal(saved.status, 201);
        const final = (await saved.json()).assessment;
        assert.equal(final.status, "finalized"); assert.equal(final.sourceDraftId, review.id); assert.ok(final.finalizedAt);
        const replay = await request(path, "POST", data); assert.equal(replay.status, 200); assert.equal((await replay.json()).assessment.id, final.id);
        assert.equal((await request(path, "POST", { ...data, rationale: "A different later decision cannot replace this finalized record." })).status, 409);
        const html = await (await request(`/judging/${review.id}`)).text();
        assert.match(html, /Human-finalized assessment/); assert.match(html, /Original AI draft/); assert.match(html, /HTTP test organizer/);
        assert.match(html, /This decision is immutable/); assert.ok(!html.includes("Review final decision"));
        const analytics = await (await request("/analytics")).text();
        assert.match(analytics, /No real submission data yet/); assert.match(analytics, /AG Studio/);
      });

      await t.test("foreign assessment pages and finalization endpoints hide other organizers' records", async () => {
        const [other] = await fixture.db.insert(organizerUsers).values({ email: "foreign-review-http@example.test", displayName: "Foreign organizer" }).returning();
        await saveEvent(fixture.db, other.id, { name: "Foreign event", slug: "foreign-http", status: "judging", deadlineAt: "2026-11-12T20:59:59Z" });
        const foreign = await registerSubmission(fixture.db, other.id, submissionFixture, githubFixture);
        const rubric = await addRubric(fixture.db, other.id, { title: "Foreign rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] });
        await queueEvaluation(fixture.db, other.id, { submissionId: foreign.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION);
        const job = await claimJob(fixture.db); assert.ok(job); await processJob(fixture.db, job, sourceFixture(), modelOptions);
        const [review] = await listReviews(fixture.db, other.id);
        // Next may have streamed the layout before notFound(), preserving status 200.
        const detail = await (await request(`/judging/${review.id}`)).text();
        assert.match(detail, /Page not found/); assert.ok(!detail.includes(review.modelVersion!));
        assert.equal((await request(`/api/assessments/${review.id}/finalize`, "POST", {})).status, 404);
        const html = await (await request("/judging")).text(); assert.ok(!html.includes(review.id)); assert.ok(!html.includes("Foreign rubric"));
      });

      await t.test("invalid model output exposes an actionable failure without scores or a fabricated draft", async () => {
        const published = await request("/api/rubrics", "POST", { title: "Failure rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] });
        const rubricId = (await published.json()).rubric.id;
        const queued = await request("/api/evaluations", "POST", { submissionId: submission.id, rubricVersionId: rubricId });
        assert.equal(queued.status, 201);
        const job = await claimJob(fixture.db); assert.ok(job);
        await processJob(fixture.db, job, sourceFixture(), { model: "mock", transport: async () => ({ text: '{"scores":{"quality":100}}', modelVersion: "mock", finishReason: "STOP" }) });
        const body = await (await request(`/api/evaluations/${job.id}`)).json();
        assert.equal(body.job.status, "failed");
        failedJobId = job.id;
        assert.equal(body.job.result.assessment, "NOT_EVALUATED");
        assert.equal(body.job.result.draft, undefined);
        assert.match(body.job.lastError, /invalid, inconsistent or unsupported/);
        const listed = await (await request("/api/evaluations")).json();
        assert.ok(!listed.reviews.some((r: { jobId: string }) => r.jobId === job.id));
      });

      await t.test("manual retry requires CSRF/origin and concurrent requests preserve one child and historical diagnostics", async () => {
        const path = `/api/evaluations/${failedJobId}/retry`;
        const [before] = await fixture.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, failedJobId));
        const detail = await (await request(`/submissions/${submission.id}`)).text();
        assert.match(detail, /Retry evaluation/);
        assert.equal((await request(path)).status, 405);
        assert.equal((await request(path, "POST", undefined, { "x-csrf-token": "" })).status, 403);
        assert.equal((await request(path, "POST", undefined, { origin: "https://evil.example" })).status, 403);
        const responses = await Promise.all(Array.from({ length: 5 }, () => request(path, "POST")));
        assert.equal(responses.filter((r) => r.status === 201).length, 1);
        assert.equal(responses.filter((r) => r.status === 200).length, 4);
        const bodies = await Promise.all(responses.map((r) => r.json()));
        assert.equal(new Set(bodies.map((body) => body.job.id)).size, 1);
        const child = bodies[0].job;
        retryJobId = child.id;
        assert.equal(child.status, "queued"); assert.equal(child.result, null);
        assert.deepEqual(child.retry, { rootJobId: failedJobId, parentJobId: failedJobId, number: 1 });
        assert.equal(child.submissionId, before.submissionId); assert.equal(child.rubricVersionId, before.rubricVersionId);
        const [after] = await fixture.db.select().from(evaluationRuns).where(eq(evaluationRuns.id, failedJobId));
        assert.deepEqual(after, before);
        assert.equal((await request("/api/evaluations/not-a-uuid/retry", "POST")).status, 400);
        assert.equal((await request(`/api/evaluations/${retryJobId}/retry`, "POST")).status, 409);
      });

      await t.test("retry authorization hides another organizer's evaluation", async () => {
        const [other] = await fixture.db.insert(organizerUsers).values({ email: "foreign-http@example.test", displayName: "Foreign fixture" }).returning();
        await saveEvent(fixture.db, other.id, { name: "Other", slug: "other-http", deadlineAt: "2026-11-12T20:59:59Z", status: "judging" });
        const foreignSubmission = await registerSubmission(fixture.db, other.id, submissionFixture, githubFixture);
        const foreignRubric = await addRubric(fixture.db, other.id, { title: "Other rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] });
        const { job } = await queueEvaluation(fixture.db, other.id, { submissionId: foreignSubmission.id, rubricVersionId: foreignRubric.id }, AI_PIPELINE_VERSION);
        await fixture.db.update(evaluationRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(evaluationRuns.id, job.id));
        assert.equal((await request(`/api/evaluations/${job.id}/retry`, "POST")).status, 404);
        assert.equal((await request(`/api/evaluations/${job.id}`)).status, 404);
        const own = await (await request("/api/evaluations")).json();
        assert.ok(!own.jobs.some((j: { id: string }) => j.id === job.id));
      });

      await t.test("HTTP exposes temporary 503 diagnostics, rejects active/completed retries and enforces the manual chain bound", async () => {
        const list = await (await request("/api/evaluations")).json();
        const completed = list.jobs.find((j: { status: string }) => j.status === "completed");
        assert.ok(completed);
        assert.equal((await request(`/api/evaluations/${completed.id}/retry`, "POST")).status, 409);
        for (let attempt = 1; attempt <= 3; attempt++) {
          const claimed = await claimJob(fixture.db); assert.ok(claimed); assert.equal(claimed.id, retryJobId);
          assert.equal((await request(`/api/evaluations/${claimed.id}/retry`, "POST")).status, 409);
          await processJob(fixture.db, claimed, sourceFixture(undefined, { truncated: true }), { model: "mock-3.5-flash", transport: async () => { throw providerError(Object.assign(new Error("upstream sensitive details"), { status: 503 })); } });
          const body = await (await request(`/api/evaluations/${claimed.id}`)).json();
          assert.equal(body.job.status, attempt < 3 ? "queued" : "failed");
          assert.equal(body.job.result.providerError.code, "GEMINI_UNAVAILABLE");
          assert.equal(body.job.result.source.coverage.treeTruncated, true);
          assert.equal(body.job.result.draft, undefined);
          assert.match(body.job.lastError, /temporarily unavailable/);
          assert.doesNotMatch(body.job.lastError, /key|sensitive|permission/i);
          if (attempt < 3) await fixture.db.update(evaluationRuns).set({ nextAttemptAt: new Date(0) }).where(eq(evaluationRuns.id, claimed.id));
        }
        let parentId = retryJobId;
        for (let number = 2; number <= 3; number++) {
          const response = await request(`/api/evaluations/${parentId}/retry`, "POST");
          assert.equal(response.status, 201);
          const child = (await response.json()).job;
          assert.equal(child.retry.number, number); assert.equal(child.retry.rootJobId, failedJobId);
          assert.equal(child.retry.parentJobId, parentId);
          parentId = child.id;
          await fixture.db.update(evaluationRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(evaluationRuns.id, parentId));
        }
        const exhausted = await request(`/api/evaluations/${parentId}/retry`, "POST");
        assert.equal(exhausted.status, 409); assert.match((await exhausted.json()).error, /limit of 3/);
        const replay = await request(`/api/evaluations/${failedJobId}/retry`, "POST");
        assert.equal(replay.status, 200); assert.equal((await replay.json()).job.id, retryJobId);
        const original = await (await request(`/api/evaluations/${failedJobId}`)).json();
        assert.match(original.job.lastError, /invalid, inconsistent or unsupported/);
        const detail = await (await request(`/submissions/${submission.id}`)).text();
        assert.match(detail, /Manual retry limit reached/);
      });

      await t.test("HTTP exposes safe invalid-contract diagnostics without upstream bodies, unsupported scores or automatic retries", async () => {
        const published = await request("/api/rubrics", "POST", { title: "Contract diagnostic rubric", criteria: [{ key: "quality", label: "Quality", maxScore: 10 }] });
        const rubricId = (await published.json()).rubric.id;
        const queued = await request("/api/evaluations", "POST", { submissionId: submission.id, rubricVersionId: rubricId });
        assert.equal(queued.status, 201);
        const job = await claimJob(fixture.db); assert.ok(job);
        await processJob(fixture.db, job, sourceFixture(undefined, { truncated: true }), { model: "mock-3.5-flash", transport: async () => {
          throw providerError(Object.assign(new Error(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "private upstream payload", details: [{ fieldViolations: [{ field: "generation_config.max_output_tokens", description: "private upstream payload" }, { field: "headers.authorization", description: "private upstream payload" }] }] } })), { status: 400 }));
        } });
        const response = await request(`/api/evaluations/${job.id}`); assert.equal(response.status, 200);
        const text = await response.text(); assert.ok(!text.includes("private upstream payload")); assert.ok(!text.includes("headers.authorization"));
        const { job: stored } = JSON.parse(text);
        assert.equal(stored.status, "failed"); assert.equal(stored.result.assessment, "NOT_EVALUATED");
        assert.equal(stored.result.providerError.status, 400); assert.equal(stored.result.providerError.code, "GEMINI_INVALID_REQUEST");
        assert.deepEqual(stored.result.providerError.diagnostics.fieldPaths, ["generationConfig.maxOutputTokens"]);
        assert.equal(stored.result.source.coverage.treeTruncated, true); assert.equal(stored.result.draft, undefined);
        assert.equal(await claimJob(fixture.db), null);
      });

      await t.test(
        "logout revokes replayed cookies on the server",
        async () => {
          const oldCookie = cookie;
          assert.equal((await request("/api/auth/logout", "POST")).status, 200);
          assert.equal((await request("/api/submissions")).status, 401);
          cookie = oldCookie;
          assert.equal((await request("/api/submissions")).status, 401);
          assert.equal((await request("/submissions")).status, 307);
          const [organizer] = await fixture.db
            .select()
            .from(organizerUsers)
            .where(eq(organizerUsers.email, "http@example.test"));
          assert.ok(organizer);
        },
      );
    } finally {
      if (child) await stop(child);
      await fixture.close();
    }
  },
);
