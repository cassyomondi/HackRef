# Evaluation retries and provider errors

> The [Gemini contract investigation](GEMINI_CONTRACT_REPORT.md) adds a separate opt-in provider test and safe HTTP 400 field diagnostics. It preserves this retry mechanism and its limits. The earlier 110-test verification below is superseded by 120 passing tests.

Eligible failed `gemini-draft-v1` evaluations can now be retried through an organizer-authorized action. A retry creates a distinct queued run using the same immutable submission, event, pinned commit and rubric version. The failed parent is never reset or rewritten. This follow-up preserves the existing engine, PostgreSQL worker, leases, publication fencing and visual shell.

## Retry behavior

`POST /api/evaluations/:id/retry` requires the existing organizer session, exact Origin and CSRF nonce. It returns **201** for a new child or **200** with the existing child on replay. Another organizer's job is **404**. Invalid IDs are **400**. Ineligible states or an exhausted manual retry budget are **409**. GET does not mutate and returns **405**.

Only terminal `failed` AI jobs with a finish timestamp and cleared leases are eligible. Queued, running, completed and historical PASS 2 jobs are rejected. The server also checks the assessments table and publication markers, so a failed row with an existing draft/finalized assessment cannot create a retry.

Each failed parent has exactly one child through this action. A short transaction locks the organizer-owned parent and uses a deterministic unique queue key. Simultaneous clicks create one child; network/request replay returns it, even if it has since completed. To try again after a child fails, retry that child explicitly. Repeating an action on the original parent never skips ahead or forks the chain.

At most **three manual retries** are permitted after the original run. A child retains the parent's automatic attempt budget (normally three; the existing database constraint caps it at five). Manual retries and automatic transient retries are separate: normally at most four runs with three automatic attempts each. Existing backoff remains five then ten seconds, extended for rate-limit cooldowns, with a terminal failure after the automatic attempt limit.

No migration is needed. The existing unique `evaluation_runs.idempotency_key` has a dedicated namespace:

```text
gemini-draft-v1:manual-retry:<root UUID>:<manual ordinal>:<parent UUID>
```

This is durable lineage, separate from the result JSON that the worker replaces. Responses expose `retry.rootJobId`, `retry.parentJobId`, `retry.number`, `maxManualRetries` and advisory `canRetry`. Before creating a child, the service validates the bounded ancestor chain, matching event/submission/rubric scope and the original commit-bound queue identity against the immutable submission. Existing schema triggers keep the submission/rubric snapshot fixed. The retry endpoint accepts no replacement commit, rubric, model or event fields.

The UI shows **Retry evaluation**, pending/success/error feedback, retry counts, links to parent/root entries, an existing-retry label and the exhausted-budget message. Polling errors are separate from action errors, so a successful background poll does not erase a retry rejection. The server's assessment/eligibility checks remain authoritative.

Parent timestamps, errors, result JSON and partial evidence remain unchanged. Child runs collect their own evidence and receive fresh citation IDs; parent evidence is not passed off as newly collected evidence. Failed child attempts retain safe partial-source limitations without publishing scores. Existing per-run automatic-attempt behavior is retained; this does not introduce a separate log of every HTTP attempt.

## Provider error behavior

The SDK adapter now uses a dedicated sanitized classifier. HTTP status takes precedence over suggestive error prose: **HTTP 503 cannot become a key/access error because its body mentions credentials**. Numeric SDK status, numeric-string status and the SDK's JSON error envelope are supported. Error messages, prompts, API keys and raw provider bodies are never stored as provider diagnostics.

| Condition | Safe code | Automatic retry |
| --- | --- | --- |
| No configured worker key | `GEMINI_KEY_MISSING` | No |
| 401, or recognized invalid/expired-key details on 400/403 | `GEMINI_KEY_INVALID` | No |
| 403 without invalid-key evidence | `GEMINI_PERMISSION_DENIED` | No |
| 404 | `GEMINI_MODEL_NOT_FOUND` | No |
| Recognized daily/exhausted/billing quota or depleted credits | `GEMINI_QUOTA_EXHAUSTED` | No |
| Transient 429 | `GEMINI_RATE_LIMITED` | Yes; durable provider cooldown |
| 503 or another temporary server failure | `GEMINI_UNAVAILABLE` | Yes; bounded worker backoff |
| 408/504, timeout/abort error or recognized transport timeout cause | `GEMINI_TIMEOUT` | Yes; bounded worker backoff |
| Other network/connection failure | `GEMINI_TRANSPORT_ERROR` | Yes; bounded worker backoff |
| Other rejected request | `GEMINI_REQUEST_REJECTED` | No |

Worker failure diagnostics include the safe code and upstream HTTP status when available. The model deadline is distinguished from worker cancellation/lease loss. SDK internal retries remain disabled so the PostgreSQL worker controls the attempt budget. No default model, credential or environment file was changed. The user's selected `gemini-3.5-flash` is read from the existing worker configuration after restart; there is no silent fallback or account availability assumption.

The earlier failed run's historical generic error is deliberately preserved. Future attempts receive the new classification. Google's official [Gemini API error documentation](https://ai.google.dev/gemini-api/docs/generate-content/api-errors) identifies 503 as temporary service overload/unavailability, separate from permission/authentication failures.

## Changed files in this follow-up

| Files | Change |
| --- | --- |
| `src/lib/evaluation/retry.ts` | Authorized, transactional retry creation and eligibility/lineage checks |
| `src/lib/evaluation/retry-identity.ts` | Durable parent/root identity and three-retry bound |
| `src/app/api/evaluations/[id]/retry/route.ts` | POST-only organizer/CSRF-protected retry endpoint |
| `src/lib/jobs.ts` | Public retry metadata and advisory eligibility |
| `src/components/job-panel.tsx` | Retry control, status/error feedback and history links |
| `src/lib/evaluation/provider-errors.ts` | Distinct safe Gemini error codes/classification |
| `src/lib/evaluation/model.ts` | Classifier integration, missing-key and deadline handling |
| `src/lib/evaluation/worker.ts` | Persist safe provider code/status with failure coverage |
| `tests/unit/retry.test.ts`, `tests/unit/model.test.ts` | Retry identity, distinct errors and real SDK with mocked HTTP 503 |
| `tests/database/retry.test.ts` | Ownership, concurrency, bounds, preservation, backoff and worker recovery |
| `tests/http/pass2.test.ts` | Production HTTP authorization/CSRF, replay, state restrictions, bounds and 503 diagnostics |
| `README.md`, `docs/EVALUATION_ENGINE_REPORT.md`, this report | Current behavior and safe operating instructions |

No schema/migration, dependency, PayPal, real `.env`, credential or development-record changes were made in this follow-up. Existing uncommitted engine work was retained. Branch remains `feat/evaluation-engine`, HEAD `fbc9c75`; no commit, push, merge or branch operation was performed.

## Verification

**110 tests passed**: 55 unit, 45 database and 10 production HTTP tests, counting nested/parent tests as reported by Node. This adds 14 tests to the existing 96-test engine suite. All provider requests were mocked, including the actual SDK receiving an HTTP 503 fixture.

| Command | Result |
| --- | --- |
| `npm run check` | Passed: all unit files, TypeScript and zero-warning ESLint |
| All unit files run directly with Node/tsx | 55 tests passed; confirms individual assertions behind the sandbox runner's file summaries |
| `npm run test:db` | 45 passed, no skips; isolated schemas in the separate local test database |
| `npm run db:check` | Passed; no migration required |
| `npm run build -- --webpack` | Passed: production compilation, type checks, generation and tracing |
| `npm run test:http` | 10 passed, no skips; real built Next.js server and isolated database |
| `git diff --check` | Passed |

DB and HTTP tests/build used approved execution outside the sandbox where required for PostgreSQL/loopback/process access. Database tests compare original rows before/after retries, verify simultaneous requests create one child, reject published drafts, enforce the chain bound, preserve exact pinned inputs, exhaust 503 automatic attempts safely and recover stale leases without duplicate publication. HTTP tests additionally verify anonymous denial, CSRF/Origin enforcement, cross-organizer isolation and visible UI/error output.

No real Gemini request was executed. The existing failed evaluation `08ead5a2-1df9-4324-baf7-f32c69dace13` was not changed or retried during implementation. Its live success with the selected model remains to be checked by the user.

## Exact commands to retry the existing failed evaluation

If you want to inspect the queued child before allowing live provider work, stop any existing worker first. Queueing does not itself call Gemini, but an already-running worker can immediately claim the child.

At the repository root, start/restart the app with the new code:

```bash
npm run dev
```

Sign in at the exact configured `APP_ORIGIN`. In that signed-in page's browser developer console, execute:

```javascript
const csrfResponse = await fetch('/api/auth/csrf');
if (!csrfResponse.ok) throw new Error('Sign in before retrying.');
const { csrf } = await csrfResponse.json();
const response = await fetch('/api/evaluations/08ead5a2-1df9-4324-baf7-f32c69dace13/retry', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrf },
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
console.log({ created: result.created, retryId: result.job.id, status: result.job.status, history: result.job.retry });
```

Re-executing this request returns the same child. You can inspect it without invoking Gemini:

```javascript
console.log(await (await fetch(`/api/evaluations/${result.job.id}`)).json());
```

Alternatively, open the original job's submission and click **Retry evaluation**. The original record stays failed and retains its diagnostics.

When you choose to perform a real evaluation, restart the worker so it loads the existing ignored `.env` selection (`gemini-3.5-flash`):

```bash
npm run worker -- --once
```

This command **can call real GitHub/Gemini** and processes at most one eligible job; an older queued job may be selected first. It does not wait for future backoff deadlines. For continuous processing and bounded automatic retries, explicitly run `npm run worker` instead. Watch the returned child ID on the submission page (five-second polling) or refresh Judging. Never reset the failed record with SQL or alter its submission/rubric to force another queue identity.

For a second manual retry, use the first child's **Retry evaluation** action after it becomes terminal failed. At most three manual retries are allowed; no retry is allowed after successful draft publication.
