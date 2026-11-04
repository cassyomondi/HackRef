# Controlled Gemini serving diagnostic

**No serving/root cause is proven from the available live evidence.** The reported full-contract HTTP 503 is a serving-unavailability result. Google's [API error documentation](https://ai.google.dev/gemini-api/docs/api-errors) distinguishes this from HTTP 400 invalid arguments. A 503 does not establish an invalid schema, invalid key or unsupported generation setting. Earlier basic and small-schema successes were different requests at different times, so they cannot isolate SDK, schema, input size or output-budget effects.

This follow-up adds controlled evidence collection without making any real provider call. The three real job records, retry identities and final remaining retry were not accessed or modified. No `.env`, production validation, provider schema, model choice, production token budget, production timeout, database schema or financial integration was changed. Existing work is preserved on `feat/evaluation-engine` at `fbc9c75`; no commit, push or branch operation was performed.

## Environment selection verified offline

The previous live command already used `loadEnvConfig(process.cwd())`, matching `cliDatabase` and the durable worker. The observability gap was in `--describe`: it skipped environment loading and did not print the selected model. Both modes now load the same read-only configuration and return only a sanitized selection summary.

The actual checkout's updated offline command reported:

```json
{
  "selectedModel": "gemini-3.5-flash",
  "modelSource": "ENV_FILE",
  "modelEnvFile": ".env"
}
```

Inherited environment values retain Next's precedence. A shell-provided `GEMINI_MODEL` is explicitly labeled `PROCESS_ENVIRONMENT`; absent configuration uses the existing default. No override is silently installed to force a particular model. Unit tests verify real Next environment loading with a temporary fake `.env` and verify inherited-model precedence; the user's file is untouched.

## Production request inspected

| Setting | Actual configuration |
| --- | --- |
| Selected model | `gemini-3.5-flash`, from the current `.env` |
| SDK | Pinned `@google/genai` 2.32.0, `models.generateContent` |
| Host / routing | `https://generativelanguage.googleapis.com`, `vertexai:false`; SDK uses `/v1beta/models/<selected model>:generateContent` in wire tests |
| Schema | `responseJsonSchema`, version `gemini-draft-structure-v2`; no `responseSchema` |
| Response format | `application/json` for production/B/C |
| Maximum output | 12,000 tokens |
| Candidates | 1 |
| Deadline | 40,000 ms client/provider-request timeout |
| SDK attempts | 1; internal retry disabled |
| Automatic continuation | Disabled |
| Model-specific tuning | No thinking/temperature/top-k/top-p overrides or tools |

Production and the diagnostic now call a small shared SDK function. The production configuration and response normalization are unchanged. Full synthetic data serialization is also shared, so diagnostic byte counts match the production assessment envelope rather than a separately maintained approximation.

## Three bounded probes

| Case | Request | Data bytes | Instruction bytes | Schema bytes | Total input bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| A | Minimal plain-text generation through the production SDK/client configuration | 24 | 11 | 0 | 35 |
| B | Minimal synthetic NOT_EVALUATED assessment using HackRef's exact provider schema | 270 | 51 | 1,407 | 1,728 |
| C | Full synthetic contract: production instructions/envelope/schema, three synthetic files and two rubric criteria | 2,358 | 1,906 | 1,407 | 5,671 |

Every default probe uses the **same model, 12,000-token cap, candidate count, endpoint, SDK attempts and forty-second deadline**. The schema hashes for B/C are identical:

```text
9b4fe24da1efea935fe6787c0bf192d4fc159e6dbdd583798a4f565c35260b53
```

Input bytes are UTF-8 bytes of data + system instruction + response schema; they exclude HTTP/JSON framing and are not a billable token count. Offline top-level `settings` describe production; each `requests` entry describes its actual probe, including any explicit diagnostic-only output-budget override.

A checks nonempty complete text. B validates its minimal synthetic NOT_EVALUATED result through the existing strict Zod/contextual validator. C invokes the existing full contract smoke path, including strict rubric, score, evidence, citation and bounds validation. All generated content is discarded after validation. No diagnostic imports the database/queue/retry service or collects real repository evidence.

The comparison makes **at most three sequential requests**, one per selected case, with no automatic retry or continuation. Each case has a forty-second deadline; the full comparison can therefore take about two minutes plus small local overhead. Authentication, permission, model access, quota or rate-limit errors stop remaining cases. HTTP 503 or 400 is recorded without silently retrying it. No comparison runs automatically in normal tests or from `--describe`.

A pass-through SDK fetch hook captures only numeric HTTP status; it does not inspect or print response bodies or credential headers. Each live result is emitted as one sanitized JSON line with selected model/source, schema hash, byte counts, token budget, elapsed time, HTTP status and normalized category. Elapsed time includes SDK response processing and local validation. Network/deadline failures can have null HTTP status; no successful status is invented. HTTP 200 with `OUTPUT_INCOMPLETE` or `OUTPUT_VALIDATION_FAILED` remains distinct from provider rejection/unavailability.

## Exact operator commands

Preview configuration and all probes without calling Gemini:

```bash
npm run gemini:contract -- --compare --describe
```

The next minimal live test is **one SDK baseline request**, explicitly opt-in and potentially billable:

```bash
npm run gemini:contract -- --case A --live
```

To explicitly authorize the complete comparison (at most three requests):

```bash
npm run gemini:contract -- --compare --live
```

Alternatively run B and C separately to inspect each result before proceeding:

```bash
npm run gemini:contract -- --case B --live
npm run gemini:contract -- --case C --live
```

For an output-budget control, explicitly rerun the **same case** with only the diagnostic cap changed:

```bash
npm run gemini:contract -- --case B --max-output-tokens 1024 --live
```

The diagnostic-only range is 256–12,000 tokens. This never changes production settings or `.env`. A low cap may yield HTTP 200 with incomplete output; that establishes serving acceptance for that request, not a successful production contract. Each command is a separate opt-in; there is no automatic repeat, budget sweep, fallback model or hidden extra call.

The existing `npm run gemini:contract -- --live` remains a single full C request. No app server or worker is needed. None of these diagnostic commands creates jobs or consumes a manual evaluation retry. A client timeout can still be billable at the provider.

## How to interpret results

| Observed pattern | Supported inference / remaining uncertainty |
| --- | --- |
| A receives 503 | Failure occurs without a response schema or full input. SDK-path serving is affected, but an SDK defect is not established; provider capacity/timing can explain it. |
| A succeeds; B returns 400 | Inspect request/schema/settings compatibility for B. This is an invalid-argument signal, unlike a 503. |
| A succeeds; B returns 503 | Structured serving failed at that time. This does not prove the schema is invalid. |
| B succeeds; C returns 400 | The exact provider schema was accepted in B. Investigate C's input/instructions or other request-specific limits. |
| B succeeds; C returns 503 | Larger/full-contract serving failed at that time; input-size/load correlation is possible but unproven. |
| Same case/settings alternate between success and 503 on separately authorized runs | Evidence for intermittent serving availability; not a deterministic schema incompatibility. |
| Same case succeeds only with a lower cap | Candidate output-budget/capacity correlation. Timing remains a confounder; do not change production based on one pair. |
| HTTP 200 with output validation failure | HTTP request was served, but output did not meet the required semantic/structural contract. No real assessment or score is published. |

Without running the opt-in live comparison, no new correlation is claimed. Preserve the remaining manual retry while 503s continue or C has not passed. A clean C pass on the intended model/configuration is the relevant gate before considering the final retry; A/B success alone is insufficient. The eligible final-retry parent remains `24d1c613-8a09-48a6-a80a-8cd0c4ad9879`, and this diagnostic never invokes its retry action.

## Changed files and verification

| Files | Focused change |
| --- | --- |
| `scripts/gemini-contract.ts` | Load worker environment in offline/live modes; expose explicit case/comparison/budget options; print only safe diagnostics |
| `src/lib/evaluation/operator-environment.ts` | Selected-model and configuration-source summary using Next's loader |
| `src/lib/evaluation/provider-diagnostic.ts` | Bounded A/B/C plans/calls, status-only observation, normalized results and stop conditions |
| `src/lib/evaluation/model.ts` | Share the unchanged SDK call and full input serialization |
| `src/lib/evaluation/contract-smoke.ts` | Include selected model and precise input sizes in offline descriptions |
| `tests/unit/provider-diagnostic.test.ts` | Seven focused regression tests for environment selection, wire requests, 400/503, validation, bounded calls and budget control |
| `README.md`, `docs/GEMINI_CONTRACT_REPORT.md`, `docs/EVALUATION_ENGINE_REPORT.md`, this report | Updated commands, findings, current behavior and limitations |

No production schema/prompt/validation, model default, retry service, job record, migration, dependency version or PayPal file was changed. The public provider schema hash remains unchanged.

Final checks: **127 tests passed** — 70 unit, 46 database and 11 production HTTP tests. `npm run check` (unit/typecheck/lint), `npm run test:db`, `npm run db:check`, `npm run build -- --webpack`, `npm run test:http` and `git diff --check` passed. All new provider tests use mocked HTTP through the actual maintained SDK. The only operator commands executed during implementation were offline descriptions; all real Gemini comparisons remain unrun.
