# HackRef evaluation engine

> Current provider contract: see the [Gemini contract investigation](GEMINI_CONTRACT_REPORT.md) and [controlled A/B/C diagnostic](GEMINI_DIAGNOSTIC_REPORT.md). Provider-facing schema and internal validation are separate; prompt version is `rubric-static-review-v2`. The current verified suite has 127 tests. Earlier implementation/verification notes below remain historical.

> The [retry and provider-error follow-up](EVALUATION_RETRY_REPORT.md) adds bounded organizer manual retries and distinct provider errors. The verification counts below describe the original engine implementation; the follow-up records the current 110-test result. Its manual retry endpoint supersedes the original terminal-job limitation described below.

Implemented on the existing `feat/evaluation-engine` checkout, based on `fbc9c75`. No branch, commit, push or PR was created. No real environment file, credential, registered submission, published rubric, finalized assessment or development database record was changed. All database and HTTP fixtures used isolated schemas in the separate local test database. The PayPal spike is unchanged.

## Architecture and versions

The authenticated organizer API now queues `gemini-draft-v1` jobs. Identity is `pipeline + submission ID + pinned commit SHA + rubric version ID`; the existing unique key handles simultaneous duplicate requests. The worker claims both the new pipeline and historical `pass2-input-validation-v1` jobs, preserving the latter's input-validation behavior. Queueing the new pipeline does not repin submissions, modify rubric snapshots or replace historical assessments. Internal `queueEvaluation` defaults to the historical pipeline for compatibility; the HTTP endpoint explicitly selects the AI pipeline. `evaluation_runs.evidence_version` remains the queue discriminator; the actual source collector version is recorded separately in the run result.

`source.ts` reuses the canonical server-only GitHub client, its `GITHUB_API_TOKEN`, public metadata/identity checks and rate-limit classification. It resolves the stored commit's Git tree SHA with `/git/commits/<SHA>`, reads `/git/trees/<treeSHA>?recursive=1`, then fetches selected `/git/blobs/<blobSHA>`. Repository content supplies neither URLs nor moving references. Redirects remain rejected. SHA-1 Git object hashes are recalculated from blob bytes, and SHA-256 content hashes, source paths, commit/blob SHAs, run/evidence UUIDs and exact excerpt line bounds accompany every retained file.

The collector never clones, installs, builds, runs, imports or triggers workflows in a submission. It accepts common source languages, JSON/TOML/YAML configuration, Dockerfile/Makefile, documentation, manifests and tests. Selection favors manifests, tests, application source, other supported files, then READMEs. Ordering is stable and independent of rubric text. File count does not mean full repository coverage.

`model.ts` uses server-only `@google/genai` **2.32.0**, pinned in the lockfile, with a fixed Gemini API host and no tools, browsing, code execution, Vertex routing or automatic SDK retries. Structured JSON is requested using a JSON Schema generated from the strict Zod output definition. Zod and contextual validation run after generation. The schema covers all queued rubric keys exactly once, bounded rationale/uncertainty/limitations, nullable provisional scores and citations. Citation checks require an evidence UUID collected in this attempt, the exact run/commit/path and an ordered range entirely inside the retained excerpt. Extra fields, invalid statuses, absent criteria, duplicate keys, invalid scores, uncited scored criteria/findings, oversized output and blocked/truncated responses fail the attempt.

Versions are `bounded-github-v1` for evidence and `rubric-static-review-v1` for the prompt. Results record requested/returned model versions, those versions, input hash/byte count, source provenance, coverage, deterministic checks and the validated draft. Model version is the SDK response's version when provided, otherwise the requested ID; the original requested ID is always retained.

## Budgets per attempt

| Resource | Limit / behavior |
| --- | --- |
| GitHub requests | 20 total, including 2 identity requests, 1 Git commit and 1 tree request; up to 16 blob requests |
| GitHub response | Existing client caps each response at 1 MiB; at most 20 MiB of response bodies across the request budget |
| Tree | 4,000 listed entries; invalid/oversized trees fail clearly instead of inventing coverage |
| Source file | 16 KiB; oversized files are excluded before blob fetch |
| Aggregate source | 64 KiB of decoded source payload under GitHub's declared/validated sizes |
| Retained files | At most 16; symlinks/submodules are excluded |
| Excerpts | Whole lines only, at most 3 KiB per file and 24 KiB total; omitted tail lines cannot be cited |
| Omission details | Total omissions counted, first 100 detail records retained; unsafe/secret paths are replaced with a generic label |
| GitHub runtime | 25 seconds overall, with the canonical 10-second per-request timeout |
| Model input | 64 KiB UTF-8 budget across data, instructions and declared response schema; reject before provider call if exceeded |
| Model output | `maxOutputTokens=12000`; additionally reject JSON larger than 64 KiB |
| Gemini runtime | 40 seconds, cancellable; one provider request per attempt |
| Processing deadline | 90-second abort deadline; database operations retain existing 5-second connection / 10-second statement timeouts |
| Worker lease | Existing 60 seconds; renewed every 10 seconds while collecting/evaluating |
| Attempts | Existing maximum of 3, with durable exponential backoff and provider cooldowns |

The input byte cap is a conservative input-size budget, not a measurement of Gemini's billable tokenizer. No extra token-counting request is made. Escaping, long rubric/claim content and coverage details count toward the cap; an otherwise valid large input can be refused instead of silently dropping data. Whole-line excerpts can retain less than their byte allowance.

Binary/non-UTF-8 content, generated/minified files, dependency/build directories, lockfiles, workflows, unsupported paths, unsafe paths, secret filenames and suspected embedded credentials are excluded. The model input is an explicit data allowlist; environment configuration is never serialized. Matching configured server secrets also blocks a provider request. Screening is conservative and heuristic; it does not guarantee detection of every possible secret committed to a public repository. Do not submit repositories containing credentials.

Truncated trees, omitted/truncated files, unavailable blobs and budgets are explicit coverage limitations. An incomplete tree never proves file absence. Some unavailable files can yield a partial review; canonical GitHub rate/auth failures remain actionable errors rather than invented success. No usable evidence means no Gemini call or scores.

## Status semantics and untrusted content

All repository content, claims and rubric strings are JSON data under a separate system instruction. Embedded role messages, credential requests and judging/payout instructions have no tool or privileged action to invoke. React renders excerpts and model prose as escaped text, without raw HTML or Markdown execution.

Only deterministic file presence and parsed package.json dependency declarations receive `VERIFIED`, and their exact statements explicitly exclude installation, runtime behavior and working integrations. Dependency declarations are read only from a complete collected manifest excerpt, without importing its code. These checks are persisted in the run's evidence bundle and displayed separately from AI findings.

AI findings and retained static evidence rows are `UNVERIFIED`. Unsupported/skipped criteria are `NOT_EVALUATED`, with null suggested score and no invented findings/citations. A draft's score map omits unscored criteria; the validated output retains the explicit null/status. `FAILED` is not an allowed AI-issued finding status: no submitted checks actually run in this pipeline. A failed processing job is a worker failure, not a verdict that a project's integration failed.

Prompt injection can still influence a model's prose or proposed score within the allowed schema. Citation validation proves location/provenance, not that an interpretation is correct. Semantic judgments and suggested scores require human review. No finalization, award approval or payout execution is implemented.

## Persistence, leases and recovery

No schema migration is required. Existing `evaluation_runs`, `evidence`, `findings` and `assessments` tables and foreign-key/unique constraints cover the new artifacts.

The worker initially verifies/renews its lease and renews it during source/model processing. Renewal requires the current token, running status, correct pipeline and a lease that has not expired. Loss or renewal errors abort processing. Provider cancellation is bounded independently of the SDK response; normal heartbeat/database timers are cleaned up after each attempt.

Publication locks the active run row in a short transaction, inserts source evidence, cited findings and one version-1 DRAFT assessment, then conditionally completes the run. The final lease predicate uses `clock_timestamp()` so expiry *inside* that transaction also rolls everything back. Competing recovery/publication serializes on the run lock. A stale token or expired lease cannot complete, fail, renew or publish results. No existing finalized assessment is updated. The existing unique `(evaluation_run_id, version)` constraint provides another duplicate-assessment safeguard.

Crashes may repeat read-only GitHub or billable provider requests after lease recovery; they cannot publish duplicate committed artifacts. Invalid output does not leave partial assessment/evidence rows. Available source coverage can remain in the fenced failure diagnostic in the run result, explicitly marked `NOT_EVALUATED`, without model scores. Reclaiming a retry clears the previous result. Terminal jobs remain idempotent; there is no reset/retry endpoint. Publish another rubric version only when intentionally changing criteria; a future pipeline revision can define a new queue identity.

Missing worker credentials and missing model access fail with safe configuration messages. Gemini 429 responses distinguish recognized exhausted/daily/billing quota from transient limits; transient cooldown uses a usable `google.rpc.RetryInfo` delay with a 60-second minimum. Unrecognized 429s use bounded transient retries and can ultimately fail. Missing key/model access is never silently replaced by another model. GitHub's existing primary/secondary rate deadlines retain their durable retry policy. Provider bodies, keys and prompts are not logged as errors.

Submission detail pages poll for real persisted drafts. Judging shows the latest 30 drafts and requires refresh for new results. Both display the immutable commit, exact rubric version/maxima, suggested scores, findings, line citations, hashes, excerpts, deterministic checks, exclusions and limitations. Organizer session/CSRF checks and event ownership remain server-side. Draft review lists are limited to 30; jobs remain limited to 200 without pagination.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/lib/evaluation/source.ts` | Immutable source collection, selection, budgets, provenance, static presence checks |
| `src/lib/evaluation/model.ts`, `versions.ts` | SDK adapter, configuration/errors, structured schema/prompt, validation/version identity |
| `src/lib/evaluation/worker.ts` | Lease renewal, bounded processing, atomic fenced publication |
| `src/lib/evaluation/reviews.ts` | Organizer-scoped persisted assessment/evidence/finding reads |
| `src/lib/github.ts`, `src/lib/jobs.ts`, `scripts/worker.ts` | Reused canonical transport with cancellation; new queue dispatch and diagnostics; retained PASS 2 support |
| `src/app/api/evaluations/route.ts` | Queue AI version; expose organizer-owned reviews alongside jobs |
| `src/components/assessment-review.tsx`, `job-panel.tsx` | Cited draft review and refreshed queue interface |
| `src/app/(organizer)/judging/page.tsx`, `submissions/[id]/page.tsx` | Persisted draft pages under existing authorization/layout |
| `tests/helpers/source.ts`, `model.ts` | Deterministic GitHub blob and Gemini fixtures |
| `tests/unit/source.test.ts`, `model.test.ts` | Collection, budgets, adversarial outputs, prompt/secret boundaries and SDK configuration tests |
| `tests/database/evaluation.test.ts`, `tests/http/pass2.test.ts` | Persistence, concurrency, recovery, rollback, authorization and production rendering/failure tests |
| `package.json`, `package-lock.json` | One direct dependency: pinned `@google/genai` |
| `.env.example`, `README.md`, this report | Server configuration, operating instructions, implementation/verification record |

`src/db/schema.ts`, all migrations, published snapshots, real environment files and all `spikes/paypal-payouts` files are unchanged.

## Environment variables

New worker-only variables: `GEMINI_API_KEY` and optional `GEMINI_MODEL` (default `gemini-2.5-flash`). Set them in ignored `.env`/`.env.local` or deployment secrets; never prefix them with `NEXT_PUBLIC_`. The model must support structured JSON and be accessible to the configured account; no live availability claim is made. Existing `GITHUB_API_TOKEN` is reused by app and worker. Existing `DATABASE_URL`, `SESSION_PASSWORD`, `APP_ORIGIN` and isolated `TEST_DATABASE_URL` behavior remains. No PayPal variable is required or sent to Gemini.

## Verification

Stage A was verified with its focused mocked source suite and TypeScript before Stage B implementation began. A later direct focused run confirmed individual source assertions; two rounds added explicit request/file-ceiling and cancellation coverage. Stage B was verified through mocked structured provider output, the actual SDK with mocked HTTP, isolated PostgreSQL persistence/concurrency tests and production Next.js HTTP rendering.

| Command/check | Result |
| --- | --- |
| Focused Stage A source tests | Passed; final suite has 8 tests |
| Focused Stage B model tests | Passed; 25 tests including adversarial subtests |
| `npm run check` | Passed: unit tests, TypeScript, ESLint with zero warnings |
| All unit files run directly through Node/tsx | 52 tests passed, no skips; sandboxed Node `--test` output summarized six passing files instead of individual test cases |
| `npm run test:db` | 37 tests passed, no skips; includes retained provenance/financial invariants, PASS 2, setup command and 11 AI tests including their parent |
| `npm run db:check` | Passed; no migrations added/applied to the development database |
| `npm run build -- --webpack` | Passed outside the sandbox: production compilation, TypeScript, generation and tracing |
| `npm run test:http` | 7 tests passed including parent; real production server with mocked worker providers, draft/citation rendering, untrusted HTML escaping, failure diagnostics, organizer/CSRF and logout protections |
| `git diff --check` | Passed |
| Live GitHub / Gemini evaluation | Not performed; real Gemini output, latency, account/model access and quota remain unverified |

The sandbox blocks PostgreSQL/HTTP loopback access, so DB/HTTP verification used approved execution outside it. The first sandboxed build failed while parsing TypeScript subprocess output; the approved Webpack retry passed. npm dependency installation also required approved network access after a sandbox DNS failure. Installation reported the existing 20 moderate advisories; no unrelated upgrades/overrides were applied.

The database suite verifies simultaneous queue requests/claims, real heartbeat renewal during a slow mocked provider call, stale publication/retry rejection, expired recovery, a lease expiring *during* publication, transaction rollback after a later insertion fails, partial/no evidence, invalid references, provider cooldown/recovery, preserved finalized/history rows and organizer isolation. HTTP tests verify the built application rather than a mocked route implementation.

## Exact local sample evaluation

Use an existing authorized registered submission and a published rubric. These instructions intentionally queue a real provider request when you execute them; they were not run against your development records during implementation.

Configure the worker's `GEMINI_API_KEY`, optional `GEMINI_MODEL` and optional `GITHUB_API_TOKEN` privately in ignored server configuration. Do not copy credentials from the PayPal spike. Existing PASS 2 setup/migrations still apply for a fresh installation; an already configured checkout needs no migration for this engine.

Terminal 1, at the repository root:

```bash
nvm use
npm ci
npm run dev
```

Sign in at the exact `APP_ORIGIN` (normally `http://localhost:3000/login`). Publish a rubric under **Event & rubric** if needed. Register a public repository you are authorized to submit, with explicit claims; registration resolves/stores its SHA. Open that submission, select the published rubric version and click **Queue AI evaluation**.

For an exact API alternative to clicking Queue, run this in that signed-in page's browser developer console. It uses the latest registered submission and latest rubric returned by your authenticated APIs; inspect/change the selection if you have multiple records:

```javascript
const read = async (path) => {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
};
const { submissions } = await read('/api/submissions');
const { rubrics } = await read('/api/event');
const submission = submissions[0];
const rubric = rubrics[0];
if (!submission || !rubric) throw new Error('Register a submission and publish a rubric first.');
const { csrf } = await read('/api/auth/csrf');
const response = await fetch('/api/evaluations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ submissionId: submission.id, rubricVersionId: rubric.id }),
});
const queued = await response.json();
if (!response.ok) throw new Error(queued.error);
console.log(queued.job.id, queued.job.status);
```

Terminal 2:

```bash
nvm use
npm run worker -- --once
```

`--once` processes at most one eligible job, which might be an older queued job. For a backlog or durable retry cooldowns, run `npm run worker` instead. Leave it running until the intended job completes/fails. Refresh **Judging** or watch the submission's five-second status polling. A successful run shows **DRAFT · Human review required** with real collected citations and provisional scores. Missing model access, rate limits or validation failure show the persisted safe error; no success is inferred.

To reproduce automated verification without real providers:

```bash
npm run check
npm run test:db
npm run db:check
npm run build -- --webpack
npm run test:http
node --conditions=react-server --import tsx tests/unit/source.test.ts
node --conditions=react-server --import tsx tests/unit/model.test.ts
```

The separate test database must already exist/configure `TEST_DATABASE_URL`; the existing test guard refuses development/remote databases. No real environment file needs changing to run a configured test suite.

## Limits and remaining checks

Real provider evaluation remains unverified. A model's structured-output schema support, score quality and latency must be checked with your configured account before relying on it. There is no silent fallback if the default model is retired/unavailable. Static excerpts and presence/declaration checks cannot establish runtime correctness, security, passing tests or working integrations. Selection is deliberately incomplete, and prompt injection remains a human-review risk within unprivileged prose/scores. Provider token billing and repeated read-only requests after crashes are not deduplicated.

No new tests run participant code, launch workflows, approve awards or call PayPal. The existing organizer authorization, architecture, visual shell and financial constraints are retained. Visual browser inspection at desktop/mobile widths was not performed; production HTML rendering and escaping were tested. Overview/Analytics/Awards preview metrics were not replaced with fabricated evaluation statistics.

SDK implementation was checked against the official [GenerateContentConfig reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html), [HTTP retry configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html), and [Gemini structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output).
