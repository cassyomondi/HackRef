# PASS 2 implementation and operations

Implemented on the existing `feat/app-foundation` branch. No branches, commits, pushes, pull requests or deployments were created. The existing Next.js 16.4.4 application, visual design, Drizzle architecture, historical documentation and isolated PayPal spike are preserved. No PayPal financial requests, Gemini or AG Studio calls are made. Submitted code is never cloned, installed, imported or executed.

## Local functional verification

Use WSL Ubuntu, Node 22.22.0 and npm 10.9.4. Commands run from the repository root. Keep your existing `.env` and database volume.

```bash
cd /home/cassy/Development/code/phase-5/HackRef
nvm use
npm ci
cp -n .env.example .env
npm run db:up
npm run db:migrate
npm run auth:configure
npm run organizer:setup
```

`auth:configure` adds only missing `SESSION_PASSWORD` and `APP_ORIGIN` settings to ignored `.env`, preserves existing settings and sets file permissions to `0600`. The secret contains 48 random bytes encoded as base64url; it is never printed. Review `.env.local` and exported variables because Next.js environment precedence can override `.env`. The local default origin is exactly `http://localhost:3000`; use that address consistently, including its port. Changing to `127.0.0.1` requires changing `APP_ORIGIN` and signing in again.

`organizer:setup` requires a terminal and prompts for email, display name, password and confirmation. Password entry is hidden, accepts 15+ characters with at most 256 UTF-8 bytes, and is never passed on the command line or stored in plaintext. It creates one provisioned organizer or provisions a matching PASS 1 identity. It refuses a second organizer. There is no public registration route and no seeded organizer credential.

For optional demo records, run this **before** creating a real event:

```bash
npm run db:seed
npm run dev
```

Open **http://localhost:3000/login**, sign in with the credentials you just chose, and visit **Submissions**. The seed adds `DEMO · HackRef development event`, a rubric v1 and a submission for public `octocat/Hello-World` at fixed commit `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` (GitHub repository ID `1296269`). Every demo record is labeled. Demo claims are illustrative statements, never findings; the example team does not assert ownership of Octocat's repository. Seeding is offline, transactional and idempotent. It never overwrites existing records, creates credentials, queues jobs or inserts financial/assessment records. It refuses production, remote databases and an organizer's existing non-demo event. Skip seeding to create a real event in **Event & rubric** instead. Demo flags remain attached when editing demo event metadata.

To check the full workflow:

1. Visit **Event & rubric**. Save event metadata and publish a rubric with one criterion per line, such as `quality | Engineering quality | 10`. Deadline inputs are UTC. Publishing again creates v2; v1 is retained unchanged.
2. In **Submissions**, register a public GitHub URL, its actual user/organization owner, project/team names, a branch/tag/SHA (optional), at least one explicit claim, and the submission-authority attestation. Leave the reference blank to pin the current default-branch commit. A second registration of the same canonical repository returns a useful duplicate error.
3. Open the registered project. Check its full SHA, GitHub repository ID, authority attestation and stored claims. Choose a rubric version and queue its evaluation twice. Both requests refer to the same durable job.
4. In another terminal at the same repository root, start the worker:

   ```bash
   npm run worker
   ```

   Alternatively, process at most one currently eligible job:

   ```bash
   npm run worker -- --once
   ```

5. The project detail page refreshes job status every five seconds. `completed` means only input/repository validation finished. Claims and assessments remain `NOT_EVALUATED`; there are no scores, evidence findings or AI output. Stop the worker with Ctrl+C; SIGINT/SIGTERM finishes its active attempt before closing connections.
6. Sign out. Organizer pages redirect to login, APIs return 401, and replaying the old cookie cannot restore the revoked database session.

Rotate a forgotten or compromised password from a trusted local terminal:

```bash
npm run organizer:setup -- --reset-password
```

Enter the existing organizer email and a new hidden password. Rotation and session revocation are atomic. Concurrent login rechecks and locks the password hash before persisting its session, so an old password cannot create a session after rotation. Cookie-key rotation is separate: replace `SESSION_PASSWORD` with a fresh secret and restart the app; old sealed cookies then become unreadable.

## Authentication and request security

- Exact-pinned `iron-session` **9.0.1** is maintained and supports Next.js 16's asynchronous cookie store. Its encrypted, authenticated cookie contains a random session token and CSRF nonce. It never contains the password or password hash. See the [maintainer documentation](https://github.com/vvo/iron-session).
- Passwords use Node's asynchronous scrypt (`N=131072`, `r=8`, `p=1`, 32-byte random salt, 64-byte derived key) and constant-time hash comparison. Missing accounts perform the same derivation work. Login failures use a generic message.
- Authentication checks a SHA-256 hash of the opaque token in `organizer_sessions`, its eight-hour expiry and the organizer's provisioned password. Logout deletes the session row before clearing the cookie. Expired rows are cleaned during successful login. Sessions are absolute, without sliding refresh.
- Cookies are `HttpOnly`, `SameSite=Strict`, path `/`, with an eight-hour maximum age and no domain attribute. HTTPS uses a `Secure` `__Host-hackref` cookie. HTTP is allowed only on loopback outside production, under the distinct `hackref-local` name. Production fails closed without an exact HTTPS `APP_ORIGIN` and a valid cookie secret.
- Every mutation verifies the exact configured `Origin` and a constant-time comparison of the session's 256-bit CSRF nonce against `X-CSRF-Token`. This includes login and logout. Missing/null/foreign origins are rejected. The nonce rotates on login. `/api/auth/csrf` is non-cacheable and does not permit cross-origin response access.
- A PostgreSQL-backed global bucket allows **10 login attempts per 15 minutes**, shared across application instances. Both successes and failures count. It does not trust client IP/forwarded headers. This single-organizer tradeoff can temporarily block legitimate login during a sustained attack; use deployment-level rate limiting when exposing the app publicly.
- Organizer layouts authorize server-side, and every database-reading page and API checks the session independently. Submission, rubric and evaluation lookups include the authenticated organizer's event scope. Request JSON is bounded to 32 KiB, inputs are validated with Zod, and API errors omit SQL, credentials and upstream bodies. APIs use `Cache-Control: no-store` and do not enable CORS.

Production requires HTTPS and a TLS reverse proxy in front of the loopback Next server. Set `APP_ORIGIN` to the exact public origin and supply secrets through the deployment environment. `npm run dev` supports local HTTP. `npm start` deliberately rejects authentication with an HTTP production origin. The HTTP test suite simulates TLS termination with an HTTPS public origin while keeping transport on local loopback; it asserts the actual `Secure` cookie header.

## Event and submission rules

One event per organizer is enforced in PostgreSQL. Event name, slug, UTC deadline and status can be updated; financial fields have no PASS 2 mutation route. Rubric publication locks the event and allocates monotonically increasing version numbers, including concurrent requests. Rubric criteria require unique keys and bounded labels/scores. Published rubric contents and registered submission snapshots are protected by database UPDATE triggers as well as the absence of editing routes.

Repository URLs are canonicalized to lowercase `https://github.com/owner/repository`, accepting an optional `.git` suffix/trailing slash. Other hosts/protocols, credentials, nondefault ports, queries, fragments, encoded paths and deeper paths are rejected. The declared owner must match the URL. Fixed-host GitHub REST requests then check public visibility, canonical `full_name`, owner login and numeric repository identity, and resolve the requested reference to a full 40-character SHA. Redirects are refused. Each response is limited to 1 MiB and each network request has a ten-second timeout. GitHub credentials are optional; see the token setup below.

Commit resolution requests GitHub's [SHA-only media type](https://docs.github.com/en/rest/commits/commits#get-a-commit), avoiding commit patches and source-file responses. GitHub API ownership checks establish which account owns the repository. The organizer separately attests that the team is authorized to submit it. **Team control of that GitHub account is not independently proven:** there is no OAuth or challenge-response ownership workflow in this pass. Claims are explicit, bounded, immutable team statements, never automatically verified facts. A failed registration does not create a partial submission. Repository IDs prevent a worker from accepting a different repository recreated at the same URL.

## GitHub API authentication and rate limits

Set this optional variable yourself in the ignored root `.env` or the server environment:

```dotenv
GITHUB_API_TOKEN=<your-token>
```

Restart both `npm run dev` (or the production app) and `npm run worker` after changing it. Your actual secret file is left unchanged by this fix. Next.js and worker CLI environment loading retain their existing precedence rules. Never use a `NEXT_PUBLIC_` prefix or put the token into a URL, browser configuration, source file, test fixture or command-line argument. Use a token suitable for reading public repository metadata/commits; write permissions are unnecessary. Authenticated access does **not** permit private submissions or bypass repository owner/identity and pinned-SHA checks.

The shared client adds `Authorization: Bearer` only when `GITHUB_API_TOKEN` is nonempty. It remains anonymous otherwise. An explicit `server-only` import blocks browser imports; the standalone worker and test scripts use Node's `--conditions=react-server` to load that marker outside Next.js. Both metadata and SHA-only requests retain the fixed `https://api.github.com` host, redirect rejection, timeout and response bounds. The client never logs credentials, returns them, echoes raw GitHub error bodies or automatically falls back to anonymous access after token rejection.

| Upstream condition                                      | HackRef response / worker behavior                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 403/429 and `x-ratelimit-remaining: 0`             | HTTP **429** with a safe primary-quota message. Uses `x-ratelimit-reset` (epoch seconds) and `Retry-After` (seconds or HTTP date), waiting until the later deadline, with a one-second reset margin.    |
| Other HTTP 429, or HTTP 403 with a usable `Retry-After` | HTTP **429** with a safe temporary-rate-limit message. Waits at least one minute and never earlier than `Retry-After`.                                                                                  |
| HTTP 401                                                | HTTP **502**, explaining that server GitHub credentials were rejected and must be checked/replaced. No automatic retry or anonymous fallback. This does not invalidate the organizer's HackRef session. |
| Other HTTP 403                                          | HTTP **403**, asking the organizer to check server token permissions/organization restrictions. No automatic retry. It is not classified as repository-owner mismatch.                                  |
| HTTP 404, unresolvable reference, or private metadata   | HTTP **422**, explaining that the repository/reference is missing or private; public repositories only.                                                                                                 |
| Network failure, timeout or upstream 5xx                | HTTP **503** with a safe transient-failure message; existing bounded retries apply.                                                                                                                     |

Rate-limit responses include a safe `retryAt` UTC timestamp and a `Retry-After` response header when a deadline is available. The existing UI displays the actionable message and time. Registration makes no automatic retry. Workers persist the later of normal backoff and the upstream deadline in the existing `next_attempt_at` column, so restarts and other workers cannot reclaim that job early. The three-attempt limit remains. If an exhausted primary quota provides no usable reset or retry deadline, the job fails without automatically guessing a retry time. No schema migration is needed. Other queued jobs may independently discover the same quota; this targeted fix does not add a shared global quota scheduler.

This follows [GitHub's documented rate-limit response headers and retry guidance](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). A 60-request anonymous-quota exhaustion is a provider rate limit, not evidence of an owner mismatch. Authentication raises the applicable quota but does not eliminate limits. Automated checks use mocked responses, never real GitHub requests or real credentials.

Targeted-fix verification: **19 unit tests, 26 database tests and 6 production HTTP tests passed**, including seven new unit tests and one new durable retry-deadline test. `npm run typecheck`, `npm run lint`, `npm run db:check`, `git diff --check` and `npm run build -- --webpack` passed. The supported Webpack option avoids this environment's previously documented Turbopack port restriction. A random token supplied only to the build process was absent from all generated browser assets; its value was never printed. No schema, dependencies, PayPal code, actual secret files, commits or branch changes were introduced by this fix.

## Durable worker lifecycle and recovery

The existing `evaluation_runs` table is the queue; no external broker or new database architecture is introduced. Queue identity is `pass2-input-validation-v1 + submission ID + immutable SHA + rubric ID`. A database unique key makes simultaneous duplicate requests return the existing job, including terminal jobs. PASS 1 runs without this pipeline marker are not claimed by the worker.

| State       | Transition and persistence                                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`    | Eligible at `next_attempt_at`. New jobs start with zero attempts and a maximum of three.                                                                                                                                                |
| `running`   | A short transaction uses `FOR UPDATE SKIP LOCKED`, increments attempts, assigns a fresh UUID lease token and sets a 60-second lease using the database clock. Other workers skip locked/live-leased rows.                               |
| `completed` | Conditional update matches the running state, lease token and unexpired lease; stores only the truthful input-validation result, clears the lease and records finish time.                                                              |
| `failed`    | Permanent errors fail immediately. Transient errors return to queued after 5 then 10 seconds, extended to any GitHub rate-limit deadline; the third failed attempt is terminal. All terminal paths clear leases and record finish time. |

A worker that is killed or loses database access leaves a durable running lease. A subsequent worker reclaims it after expiry with a new token and another attempt. If the final attempt was abandoned, the next claim cycle marks it failed instead of leaving it running forever. A stale worker cannot complete or fail a reclaimed/expired job because every terminal/retry update checks its lease token and expiry. Requests are bounded well below the lease during normal operation; there is no long-running task or heartbeat in PASS 2. The delivery model is at least once after a crash; duplicated read-only GitHub requests are possible, while stale database writes are fenced.

Workers poll every second when idle, back off five seconds after a database error, sanitize logs, and stop gracefully on SIGINT/SIGTERM. `--once` processes at most one eligible job and does not wait for future retry eligibility. Multiple worker processes are supported. Database outages preserve state for recovery; no process resets the queue at startup.

For a manual crash check, queue a job with the worker stopped, start `npm run worker`, terminate its process after it logs the claimed job and before completion, then restart it after 60 seconds. The job is reclaimed if its attempt budget remains. Fast metadata checks may finish too quickly for this manual check; `npm run test:db` deterministically tests expired leases, competing workers, stale completion/failure, transient backoff and a final abandoned attempt without sleeping or changing development records.

## Authorized API surface

Obtain the cookie and nonce through `GET /api/auth/csrf`. Mutation requests send the cookie, `Origin: <APP_ORIGIN>`, `X-CSRF-Token: <nonce>`, and `Content-Type: application/json` when sending a body. The UI handles this automatically. Login/logout are POST-only; GET never mutates organizer data.

| Endpoint                                   | Behavior                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                     | `{email, password}`; validates nonce/origin, rotates cookie/token/nonce.                                                      |
| `POST /api/auth/logout`                    | Revokes the cookie's database session and clears the cookie.                                                                  |
| `GET /api/event` / `PUT /api/event`        | Read event/rubrics; create or update `{name, slug, deadlineAt, status}` for the session's organizer.                          |
| `POST /api/rubrics`                        | Append `{title, criteria:[{key,label,maxScore}]}` as a new immutable version.                                                 |
| `GET /api/submissions`                     | Latest 200 organizer-owned submissions.                                                                                       |
| `POST /api/submissions`                    | Register `{name, teamName, repositoryUrl, repositoryOwner, ref, claims:string[], ownershipAttested:true}` and pin its commit. |
| `GET /api/submissions/:id`                 | Inspect one owned submission and its stored claims.                                                                           |
| `POST /api/evaluations`                    | `{submissionId, rubricVersionId}`; returns 201 for a new job, 200 for the existing duplicate.                                 |
| `GET /api/evaluations?submissionId=<uuid>` | Latest 200 owned jobs, optionally filtered by submission.                                                                     |
| `GET /api/evaluations/:id`                 | Persisted status, attempts, safe error and result; never exposes lease tokens.                                                |

## Schema migrations and files

`0000_foundation.sql` is unchanged. Both new migrations are checked in with Drizzle snapshots and journal entries; `db:push` is not used.

- **`drizzle/0001_pass2_organizer_jobs.sql`**: adds `organizer_users.password_hash`, the partial singleton provisioned-organizer index, `organizer_sessions` and `login_limits`; enforces one event per organizer and adds demo flags; adds submission owner, GitHub repository ID, claims and authority attestation; adds evaluation attempts, retry scheduling, lease token/expiry, error/result, queue index and attempt/lease constraints. Legacy identities remain unprovisioned and legacy submissions retain safe defaults. No foundation records were present before application.
- **`drizzle/0002_pass2_immutable_inputs.sql`**: custom Drizzle migration with a PL/pgSQL function and UPDATE triggers protecting published rubric/submission snapshot content. Both applied successfully to PostgreSQL **16.15** in the existing Docker container. Migration reruns are non-destructive no-ops.

Changed/new source groups:

```text
README.md, .env.example, package.json, package-lock.json
docs/DEVELOPMENT.md, docs/DATABASE.md, docs/PASS2_REPORT.md
drizzle/0001_pass2_organizer_jobs.sql, drizzle/0002_pass2_immutable_inputs.sql
drizzle/meta/0001_snapshot.json, 0002_snapshot.json, _journal.json
src/db/schema.ts, client.ts, connection.ts, demo-seed.ts
src/lib/auth-config.ts, auth-service.ts, password.ts, csrf.ts, session.ts
src/lib/validation.ts, github.ts, event-service.ts, jobs.ts
src/lib/errors.ts, http.ts, api-client.ts, test-database.ts
src/app/layout.tsx, error.tsx, login/page.tsx
src/app/(organizer)/layout.tsx, loading.tsx, error.tsx
src/app/(organizer)/event/page.tsx
src/app/(organizer)/submissions/page.tsx, submissions/[id]/page.tsx
src/app/api/auth/{csrf,login,logout}/route.ts
src/app/api/event/route.ts, rubrics/route.ts
src/app/api/submissions/route.ts, submissions/[id]/route.ts
src/app/api/evaluations/route.ts, evaluations/[id]/route.ts
src/components/app-shell.tsx, navigation.tsx, workspace-ui.tsx
src/components/auth-controls.tsx, management-forms.tsx, job-panel.tsx
scripts/cli-database.ts, configure-auth.ts, setup-organizer.ts
scripts/setup-test-database.ts, seed.ts, worker.ts
tests/unit/auth.test.ts, submissions.test.ts
tests/database/invariants.test.ts, pass2.test.ts, setup-command.test.ts
tests/helpers/database.ts, github.ts; tests/http/pass2.test.ts
```

Overview, Judging, Analytics and Awards pages moved into the protected `(organizer)` route group; their public URLs and existing design remain the same. Overview/Judging and shared preview copy now correctly distinguish planned assessments/awards from the functioning registry, rubric and worker. Analytics and Awards page content is unchanged. `.gitignore`, Compose, PASS 1 migration, scope document, license and all spike files are unchanged. Existing ignore rules already cover root/spike environment files, secrets, keys, `.next`, `node_modules` and test artifacts. Only `.env.example` files are tracked.

## Tests and build results

Create the separate local test database once, without resetting anything:

```bash
npm run db:test:setup
npm test
npm run test:db
npm run typecheck
npm run lint
npm run db:check
npm run build -- --webpack
npm run test:http
git diff --check
```

`db:test:setup` uses `TEST_DATABASE_URL` when configured or derives a database name ending in `_test` from the development URL and saves it in ignored `.env`. The account needs `CREATEDB` only if that database is missing. Tests reject non-loopback URLs, names without `_test`, or the development database's name, including hostname aliases. They apply **all checked-in migrations** to uniquely named test schemas. Concurrent-worker tests use committed fixtures and independent pooled connections. Cleanup drops only those random schemas in the separate test database; it never resets development data. The retained PASS 1 invariant suite rolls back its schema and fixtures. CLI tests require WSL's util-linux `script` command to provide a real terminal and verify passwords are not echoed. HTTP tests start/stop their own production server on a free loopback port, using random temporary credentials and the same isolated test harness. Routine tests mock GitHub and make no external API requests.

| Check                                | Result                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                           | 12 unit tests passed. Password hashing, cookie integrity/flags, CSRF, environment/database guards, input validation and GitHub failures.                                                                                                                                                                                                        |
| `npm run test:db`                    | 25 tests including parent tests passed; no skips. Authentication/revocation/throttling, ownership, immutable inputs, idempotent seed, duplicate jobs, competing workers, stale leases, bounded retries, final-attempt recovery and interactive setup/password reset. PASS 1 financial/provenance constraints still pass without calling PayPal. |
| `npm run test:http`                  | 6 tests including parent test passed; no skips. Real built Next.js routes, anonymous access denial, Secure/HttpOnly cookies, login/CSRF rotation, invalid/oversized JSON, queue/status and logout replay.                                                                                                                                       |
| `npm run typecheck` / `npm run lint` | Passed with zero lint warnings.                                                                                                                                                                                                                                                                                                                 |
| `npm run db:check`                   | Passed for the complete migration journal.                                                                                                                                                                                                                                                                                                      |
| `npm run db:migrate`                 | Applied both additive migrations successfully to existing PostgreSQL 16.15; no data reset.                                                                                                                                                                                                                                                      |
| `npm run build -- --webpack`         | Passed production compilation, TypeScript, generation and tracing. The production HTTP suite runs this artifact.                                                                                                                                                                                                                                |
| `npm run build` (Turbopack)          | This execution environment blocks its CSS worker's internal port binding (`EPERM`), including the elevated retry. The supported Webpack option succeeds; the default build script remains unchanged for normal WSL.                                                                                                                             |
| Live read-only GitHub check          | The actual resolver confirmed the demo repository ID, public owner and fixed SHA against GitHub; no code downloaded or executed.                                                                                                                                                                                                                |
| Git ignore / whitespace checks       | Passed. Root/spike `.env`, generated build files and TypeScript cache remain ignored; no spike changes.                                                                                                                                                                                                                                         |

Final operational checks also passed: `npm audit --omit=dev` reported zero vulnerabilities, a second `npm run db:migrate` safely completed without changing application data, and `npm run worker -- --once` started and exited cleanly with an empty development queue. The final SHA-only resolver succeeded against live GitHub after a transient upstream response on an earlier attempt.

## Known limits

- No AI assessment, static source analysis, project-claim verification, Gemini, AG Studio, judging actions, awards or application PayPal integration. Overview metrics remain placeholders rather than invented statistics.
- Repository-account control is not independently verified; the recorded organizer attestation is explicit. Public metadata can later become unavailable, private, transferred or rate limited. Workers report this instead of fabricating results. GitHub limits still apply with the optional server token; primary-limit deadlines are respected for each job.
- One event and one provisioned organizer; no public registration, email reset, MFA, participant portal or multi-tenant administration. Lists are capped at 200 without pagination. Event status/deadline are organizer metadata; PASS 2 does not enforce participant intake windows.
- Submission snapshots cannot be edited or repinned through the app; rubric edits create another version. Failed/completed jobs remain idempotent: queueing again returns their existing status. There is no manual retry/reset endpoint. A later pipeline revision can define another run identity deliberately.
- Leases fence writes; read-only metadata requests may be repeated after a process stall/crash. The worker needs a separately supervised process in deployment. There is no heartbeat, scheduler service or attempt-history table.
- Database triggers protect UPDATEs, not a privileged database administrator issuing destructive SQL. No deployment/migration-role separation or financial authorization changes are introduced in this pass.
- Local development configuration was added to ignored `.env` and the additive migrations were applied; **no development organizer or demo event was created**, so you choose your own credentials and whether to seed. Automated fixtures existed only in isolated test schemas.
- Visual browser inspection was not available; production HTTP rendering and the existing styles were checked. Manually inspect desktop/mobile forms and keyboard interactions locally.
- The inherited 20 moderate development-tool advisories and ESLint 9 compatibility limitation remain as documented in the PASS 1 report; no unrelated toolchain upgrades or forced overrides were made.
