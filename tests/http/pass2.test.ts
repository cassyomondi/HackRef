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
  rubricVersions,
  submissions,
} from "../../src/db/schema";
import { seedDemo } from "../../src/db/demo-seed";
import { hashPassword } from "../../src/lib/password";
import { claimJob, processJob } from "../../src/lib/jobs";
import { isolatedDatabase } from "../helpers/database";
import { githubFixture } from "../helpers/github";

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
          await processJob(fixture.db, job, githubFixture);
          const status = await request(`/api/evaluations/${job.id}`);
          assert.equal(status.status, 200);
          const body = await status.json();
          assert.equal(body.job.status, "completed");
          assert.equal(body.job.result.assessment, "NOT_EVALUATED");
          assert.equal(body.job.leaseToken, undefined);
          assert.equal(
            (await request(`/submissions/${submission.id}`)).status,
            200,
          );
        },
      );

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
