# Gemini request contract investigation

> The [controlled A/B/C follow-up](GEMINI_DIAGNOSTIC_REPORT.md) verifies environment selection, adds safe request metrics and separates serving unavailability from invalid arguments. The current suite has 127 passing tests. No later HTTP 503 result proves the earlier schema-complexity hypothesis.

The production request was sending the entire rich `z.toJSONSchema(draftSchema)` result directly as `responseJsonSchema`. This exposed server validation details to the provider grammar compiler. The inspected SDK's `tJsonSchema` function returns this object unchanged; it does not sanitize the unsupported constraints. The request contract now uses an explicit minimal structural schema, while all rich internal Zod and contextual validation remains unchanged.

**The precise cause of the two live rejections is not proven.** No live Gemini request was made during this investigation, and the earlier error handler retained neither field violations nor schema rejection categories. The strongest identified risk is schema grammar complexity and provider-subset compatibility. It would be inaccurate to conclude that `minLength`/`maxLength` alone caused HTTP 400: current Google documentation says those constraints are ignored. A basic generation success does not exercise HackRef's structured response contract.

Existing jobs were neither read nor modified, and the final manual retry was not consumed:

| Run | ID |
| --- | --- |
| Original failure | `08ead5a2-1df9-4324-baf7-f32c69dace13` |
| First manual retry | `ef166c8b-e5ca-4a55-97c2-a1ab2f4cbd47` |
| Second manual retry | `24d1c613-8a09-48a6-a80a-8cd0c4ad9879` |

## Actual request findings

The original converted schema was reproduced offline, without reading environment secrets or repository evidence. It is **2,821 compact JSON bytes**, with 31 schema nodes and a maximum schema-node depth of seven. It contains `$schema`, `minLength`, `maxLength`, `pattern`, UUID `format`, `minimum`, `maximum`, `minItems`, `maxItems`, `anyOf`, required object fields, enums and `additionalProperties:false`. Reused citation objects are inlined twice. There are no `$ref`, `$defs` or recursive definitions in the actual output.

| Field/feature | Investigation and change |
| --- | --- |
| `minLength` / `maxLength` | Emitted repeatedly by bounded Zod strings. Removed from the provider schema; still enforced internally. Their presence is not a proven standalone rejection cause. |
| `pattern` | UUID and SHA regexes were forwarded unchanged. This keyword is absent from the maintained SDK's documented `responseJsonSchema` support list; removed from the provider grammar. |
| UUID `format` | Generic format support does not establish UUID enforcement for every backend. Provider UUID format hints are removed; `z.uuid()` remains mandatory. |
| `$schema` | Zod emits the draft-2020-12 dialect declaration. It is unnecessary for this contract and absent from the SDK's documented keyword list; omitted. |
| Line-number `maximum` | `z.number().int()` generates `9007199254740991`. This large numeric bound was repeated in citation objects. Provider numeric bounds are removed; safe integers and collected line limits remain internally enforced. |
| Nested array bounds | Criteria 1–20, citations up to 4, findings up to 3, limitations 1–12. Provider bounds are removed to reduce grammar state expansion; internal array bounds remain unchanged. |
| Nullable score | The number/null `anyOf` becomes `type:["number","null"]`. Same output domain, fewer schema nodes. |
| Object structure | Required fields, primitive types, the two allowed AI statuses and closed objects are retained. Field names and citation nesting remain the same. |
| `responseMimeType` / schema pairing | Already correct: `application/json` with `responseJsonSchema`, without `responseSchema`. Preserved. |
| Generation parameters | 12,000 output tokens and one candidate. No temperature, thinking configuration, tools or model-specific tuning was present. No incompatibility was established for those settings. |
| Timeout and continuation | Forty-second timeout retained; SDK retries remain one attempt. Automatic continuation is now explicitly disabled to prevent follow-up generation calls. |

The maintained [GenerateContentConfig reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html) documents the MIME/schema pairing and the supported `responseJsonSchema` subset. The separate OpenAPI-style `responseSchema` field has different constraints; its keyword list is not interchangeable with this JSON Schema surface. The inspected installed SDK is `@google/genai` **2.32.0**.

Google's [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output) describes ignored string-length constraints and schema compilation limits. It identifies nested array/numeric bounds, unions and structural depth as sources of HTTP 400 complexity failures. This supports simplifying the grammar, without identifying the exact rejected field in the historical requests.

The [Gemini 3.5 Flash model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) lists structured output and a 65,536-token output limit, so the configured 12,000-token cap is not excessive against that published limit. Account-specific behavior remains a live-contract question. HackRef preserves the selected model ID and does not silently change models.

## Implemented contract

`providerResponseSchema()` constructs only `type`, `properties`, `required`, `additionalProperties`, `items` and the two-status `enum`. It is reference-free and has no dialect declaration, regexes, formats, string/numeric/array bounds or `anyOf`. Required object structure and score nullability still match the full internal schema exactly.

The new schema is **1,407 compact JSON bytes**, with 29 schema nodes and the same maximum schema-node depth of seven. Shape equality tests protect against drift between its fields/types and the rich Zod schema. Nesting is preserved to keep the existing citation/output contract; backend acceptance still requires the opt-in live test.

`draftSchema` and `validateDraft` retain all existing enforcement: strict fields/statuses, text and array bounds, UUID/SHA syntax, safe integer line ranges, exact rubric coverage, score maxima, collected evidence IDs, run/commit/path identity, valid citation ranges, uncited-output rejection and unsupported-coverage handling. The provider's smaller grammar cannot authorize unsupported scores or verified functionality. Output/input byte limits and the token cap are retained.

Bounds are also included as generation instructions. Traceability uses provider schema version `gemini-draft-structure-v2` and prompt version `rubric-static-review-v2`, recorded for future results/failure diagnostics. The pipeline remains `gemini-draft-v1`; queue identities, retry links, retry counters and published snapshots are unchanged.

Schema SHA-256 from the offline description:

```text
9b4fe24da1efea935fe6787c0bf192d4fc159e6dbdd583798a4f565c35260b53
```

## Safe request diagnostics

Unrecognized HTTP 400 responses now receive `GEMINI_INVALID_REQUEST`, upstream status 400 and a bounded diagnostic object. Recognized invalid-key errors remain distinct. The diagnostic categories are `UNSUPPORTED_SCHEMA_KEYWORD`, `SCHEMA_COMPLEXITY`, `INVALID_SCHEMA`, `INVALID_GENERATION_SETTING`, `INVALID_REQUEST_FIELD` or generic `INVALID_ARGUMENT`. Categories are a safe interpretation of available provider details, not a definitive root-cause guarantee.

Google `BadRequest.fieldViolations` and message-only field paths are inspected, but raw descriptions/messages are never retained. Paths must contain only known request/schema/property tokens and bounded array indexes. Unknown property names, credential-bearing headers and arbitrary text are discarded. At most eight canonical paths are retained. For example, `generation_config.max_output_tokens` becomes `generationConfig.maxOutputTokens`. An arbitrary `headers.authorization` path is discarded entirely.

The worker stores only safe code/status/category/path metadata alongside its existing partial-source limitations. It never persists raw provider bodies or publishes a draft/scores on a request-contract failure. HTTP 400 remains non-retryable automatically, protecting the existing attempt budget.

## Isolated operator contract test

The smoke test imports no database/queue/retry service and invokes no source collector. Its fixture contains three short in-memory synthetic files, two synthetic rubric criteria, synthetic identifiers/hashes and `urn:hackref:synthetic` source URIs. It uses the same `assessSource`, system instructions, provider schema, SDK adapter, generation settings and post-response validation as production. It also requires at least one cited, provisionally scored synthetic criterion before reporting PASS.

Offline inspection at the repository root:

```bash
npm run gemini:contract -- --describe
```

This prints **NOT_RUN**, the selected model/configuration source, contract/prompt fingerprints, schema size, generation settings and request byte counts. It reads the same server environment configuration as the worker, makes no provider request and accesses no database. Running the command with no arguments is also offline.

The operator can explicitly opt into one potentially billable provider request:

```bash
npm run gemini:contract -- --live
```

All modes now load the existing ignored server environment using the worker's `@next/env` convention. Only `--live` permits provider calls. It uses the existing `GEMINI_MODEL` and `GEMINI_API_KEY` without changing either. It sends only synthetic evidence; no real repository source or job record enters the request. No app server or worker is required. SDK retries and automatic continuation are disabled. The forty-second client timeout does not guarantee cancellation of provider billing.

On **PASS / exit 0**, CLI output contains the selected model, schema fingerprint, request byte counts, generation settings, elapsed time, observed HTTP status and a normalized result category. It prints no generated assessment text, full prompt, key, headers or provider body. Failures retain the same bounded metrics with a normalized category, without exception text/stacks. There is no automatic fallback or second request in the default single-case mode. The opt-in A/B/C comparison is documented in the follow-up.

This command is separate from all normal test scripts. Automated tests invoke only offline or mocked-provider paths, including mocked HTTP through the actual SDK. No real provider request was made while implementing or verifying it.

## Verification

**120 tests passed**, up from 110: **63 unit, 46 DB and 11 HTTP** (including Node's nested/parent test counts).

| Check | Result |
| --- | --- |
| `npm run check` | Passed: unit files, TypeScript and zero-warning ESLint |
| Direct execution of all unit files | 63 tests passed; includes eight new contract tests |
| `npm run test:db` | 46 passed; isolated schemas in the separate test database |
| `npm run db:check` | Passed; no migration |
| `npm run build -- --webpack` | Passed production compilation, TypeScript, generation and tracing |
| `npm run test:http` | 11 passed against the production Next.js server and isolated database |
| `npm run gemini:contract -- --describe` | Passed offline; NOT_RUN with the schema fingerprint above |
| `git diff --check` | Passed |
| Live provider contract | Not run; awaits explicit operator execution |

Contract unit tests assert the exact SDK wire schema/settings from the real production assessment path, successful structured citation validation, preserved internal bounds, model selection, continuation suppression, safe field-path filtering and exact HTTP 400 classification. Existing simplified transport-test schemas were replaced with the production schema. DB/HTTP tests verify persisted sanitized diagnostics, partial evidence, absence of unsupported scores/artifacts, non-retryable 400 behavior and retained authorization/retry safeguards.

Approved execution outside the sandbox was used for DB/HTTP loopback access and production builds. No development database records were accessed or changed. No real `.env`, credentials, dependency versions, PayPal code, schema/migrations, branch or commit were changed. Existing uncommitted work is preserved on `feat/evaluation-engine` at `fbc9c75`.

## Files changed in this investigation

| Files | Purpose |
| --- | --- |
| `src/lib/evaluation/provider-schema.ts` | Minimal provider-facing schema and generation bounds instructions |
| `src/lib/evaluation/model.ts` | Separate provider schema, shared generation config, unchanged strict validation |
| `src/lib/evaluation/request-diagnostics.ts` | Allowlisted field paths and reason categories |
| `src/lib/evaluation/provider-errors.ts` | Safe invalid-request classification |
| `src/lib/evaluation/worker.ts`, `versions.ts` | Safe diagnostic/schema-version persistence and new prompt version |
| `src/lib/evaluation/contract-smoke.ts` | Synthetic fixture, offline description and isolated contract check |
| `scripts/gemini-contract.ts`, `package.json` | Explicit offline/opt-in operator command |
| `tests/unit/provider-contract.test.ts` | Contract, wire request, configuration, safety and validation tests |
| `tests/unit/model.test.ts`, `retry.test.ts` | Production-schema fixtures and updated 400 expectations |
| `tests/database/evaluation.test.ts`, `tests/http/pass2.test.ts` | Safe persisted/HTTP diagnostics and no-score failure checks |
| `README.md`, `docs/EVALUATION_ENGINE_REPORT.md`, `docs/EVALUATION_RETRY_REPORT.md`, this report | Current contract, historical notes and operator instructions |

## Final remaining retry

Keep the final retry untouched until `npm run gemini:contract -- --live` prints **PASS** and exits zero using the intended model configuration. A clean pass demonstrates acceptance of the actual production schema/settings plus strict validation of representative synthetic output. It is then reasonable to use the final retry after restarting the worker on this code/configuration. It does not guarantee that a real repository's evidence, model reasoning, provider availability or output size will pass every later validation.

The eligible parent for that final action is **retry 2**, `24d1c613-8a09-48a6-a80a-8cd0c4ad9879`. Actions on the original or retry 1 return their existing child by design. This investigation does not invoke the retry endpoint or worker against any real job. If the contract test fails, retain the remaining retry and investigate only its sanitized output first.
