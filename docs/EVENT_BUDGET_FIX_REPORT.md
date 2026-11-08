# Event budget integration fix

## Root cause and runtime evidence

The reported error is the strict **pre-budget server request validator** rejecting the new UI's `budgetCents` key. It occurs before the event service or database update; neither `1` versus `1.00` nor migration 0004 can cause an “Unrecognized key” error.

At investigation time, `src/lib/validation.ts` already included `budgetCents: budgetCentsInput.optional()`, and the UI sent integer cents. The Next development server listening on `127.0.0.1:3000` was running from this checkout but had started at 21:09:54 Africa/Nairobi on November 7, before the Stage A validator change at 21:59. Its `.next/dev` cache contained both older validators without the budget field and newer validators with it. The cached pre-budget validator was replayed offline against a synthetic event payload containing `budgetCents: 100`; it produced exactly:

```text
Unrecognized key: "budgetCents"
```

The current source validator accepted the identical payload as 100 cents. The older schema plus `.strict()` explains the failure exactly. This is a stale development runtime/client-server contract mismatch, not a reason to remove strict validation or allow arbitrary fields. The original browser's in-memory module state cannot be inspected from this workspace; a hard refresh is required after restarting the server. New production browser tests verify the actual client payload, HTTP validation, database value and reload together.

The stale server was stopped and its development cache preserved at `/tmp/hackref-budget-dev-cache-1794083054`. After all tests passed, it was restarted on `127.0.0.1:3000` with its original environment, retained in memory without printing or writing credentials. Anonymous, read-only requests confirmed `/login` returns `200`, `/event` redirects to login (`307`), and `/api/event` requires authentication (`401`). Freshly generated development event validators all contain the optional integer-cent budget field; fresh browser assets contain the new dollar/cents display. No authenticated mutation was sent to either development database. Hard-refresh the existing browser tab to load these assets.

## Changes and units

| Input | On blur / reload | HTTP `budgetCents` / database `budget_cents` |
| --- | --- | --- |
| `1` | `1.00` | `100` |
| `1.5` | `1.50` | `150` |
| `1.00` | `1.00` | `100` |
| `0.10` | `0.10` | `10` |

The form keeps raw text while the organizer edits it, including an intermediate `1.`. Valid complete inputs normalize to two decimal places on blur or submission. Invalid text stays visible for correction; it is never rounded, truncated to two decimal places, or sent to the mutation endpoint. The input no longer has the old eleven-character cap that could hide extra fractional digits. An accessible live display shows both formatted USD and exact cents.

Money conversion splits decimal text, pads the fractional string and uses `BigInt` arithmetic, then converts the bounded integer cents to a JavaScript number. Empty, negative, malformed, excessive and more-than-two-decimal values have distinct field-level errors. Maximum budget remains 2,147,483,647 cents (USD 21,474,836.47); zero still means no configured prize funds.

The strict request contract continues to accept only an optional **numeric integer** `budgetCents`; it does not accept floating-point dollars or numeric strings. Omission preserves existing budgets. New events safely use the schema's zero-cent default. PostgreSQL's integer `budget_cents`, Drizzle's `budgetCents`, the request validator, service and UI all use the same cents unit.

The event service retains its organizer and event locks, ownership scoping, omitted-field behavior and aggregate reservation check. A reservation conflict now carries a structured `budgetCents` field error through the existing HTTP and client helpers. Unknown request keys are still rejected, with a nonempty `request` field and a safe message that does not echo arbitrary keys or validator internals. No SQL, credentials or submitted values are exposed.

Budget-only saves also preserve any existing deadline seconds/milliseconds hidden by the minute-resolution form control. All other event details and versioned judging/financial records are checked for preservation in browser regressions.

## Exact files changed for this fix

These are changes relative to the already-present, uncommitted Stage A implementation; the earlier Stage A files remain in the working tree.

| File | Purpose |
| --- | --- |
| `src/components/event-form.tsx` | Controlled money editing, blur normalization, dollar/cents display, accessible local/server field errors, exact cents payload and unchanged deadline preservation. |
| `src/lib/money.ts` | Specific syntax, precision, sign and range errors; bounded exact integer conversion. |
| `src/lib/awards-validation.ts` | Useful API error messages for the shared integer-cent budget schema. Award/approval schemas retain their existing constraints. |
| `src/lib/validation.ts` | Sanitized named validation errors. Existing optional budget contract retained. |
| `src/lib/http.ts` | Uses the sanitized validation error mapper. Authentication, CSRF and bounded JSON reading are unchanged. |
| `src/lib/errors.ts` | Optional structured fields on existing application errors. |
| `src/lib/event-service.ts` | Attaches the budget field to reservation conflicts; financial checks and locks are unchanged. |
| `src/lib/api-client.ts` | Retains structured API errors for field-level rendering while preserving messages for existing forms. |
| `tests/unit/event-budget.test.ts` | Four exact input cases, money error categories, strict/omitted budget contract, safe validation messages and structured client errors. |
| `tests/http/pass2.test.ts` | Real budget PUT/GET/database round trips, old-client omission, invalid fields, sanitized unknown keys, unchanged data and structured reservation conflicts. |
| `tests/ui/judging.test.ts` | Real form → HTTP → PostgreSQL → GET/reload regression, editing/blur behavior, no writes for invalid input, deadline precision and unchanged event/judging/financial data after rejected reductions. Earlier award, Gemini fixture, AG Grid and AG Studio checks retained. |
| `docs/EVENT_BUDGET_FIX_REPORT.md` | This report. |

`src/app/api/event/route.ts`, `src/db/schema.ts`, the allocation/approval services, and `drizzle/0004_awards_stage_a.sql` were inspected and left unchanged. No migration is needed for this fix. Migration 0004's event-row serialization, aggregate award budget checks, eligibility checks and immutable award/approval guards remain intact.

## Verification

| Command | Result |
| --- | --- |
| `npm run check` | Passed: 13 unit test files, TypeScript and ESLint |
| `npm run test:db` | Passed: 64 tests, including allocation/approval races, budget exhaustion and lock-order overlap |
| `npm run db:check` | Passed |
| `npm run build -- --webpack` | Passed |
| `npm run test:http` | Passed: 15 tests |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome npm run test:ui` | Passed: complete browser scenario, including all four budget formats, rejection/no-write cases, reservation conflicts and earlier judging/Studio checks |
| `git diff --check` | Passed |

All integration writes and migrations are confined to disposable schemas in the dedicated test database. Existing fixture helpers and synthetic awards/approvals run only there as part of the requested suites. Neither existing development database was migrated or mutated; no application awards were created or approved, no seed command was run, and no live Gemini or PayPal request was made. No branch change, commit, push, merge or deployment was performed.

## Manual verification

1. Hard-refresh `/event` at the exact configured local `APP_ORIGIN`, then sign in if necessary. Use the intended event only when you intend to change its budget; the automated suite uses disposable data for all four examples and the reservation case.
2. Enter `1`. It should remain `1` while typing. Move focus away: it becomes `1.00`, and the display reads `USD 1.00 · 100 USD cents`. Save: Network should show a `PUT /api/event` with numeric `budgetCents: 100` and a successful response. Reload: the field remains `1.00`.
3. Repeat with `1.5`, `1.00` and `0.10`, expecting the table above. The event ID, name, slug, owner, status, deadline (including hidden precision) and versioned judging data must stay unchanged when only the budget is edited.
4. Try `-1`, `1.001`, `1e2`, `abc`, an empty input and `21474836.48`. Each must show a specific error beside the budget field; invalid text must remain available for correction. Saving must issue no event PUT and leave the saved budget unchanged.
5. If the chosen event already has reserved awards, a reduction below their total must return `409`, show the budget field error and preserve all records. Do not allocate or approve an award just to test this; the automated HTTP/browser suites exercise the case using disposable fixtures.

No financial execution or migration against either preserved development database is part of manual verification of this fix.
