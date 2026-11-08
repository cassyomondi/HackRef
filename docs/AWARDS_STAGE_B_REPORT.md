# HackRef Awards Stage B implementation report

Implemented on `feat/paypal-awards`, November 8, 2026. The November 12 hackathon deadline and existing event dates were not changed. Existing uncommitted Stage A work is retained. No commit, push, merge or deployment was performed.

## Result and financial boundaries

An authenticated event organizer can separately authorize **Send sandbox payout** for an already approved, exact-term award. The page shows the award, exact USD amount, recipient confirmation and explicit SANDBOX warning. Both sandbox confirmations are required. Approval, assessment finalization, AI evaluation, page rendering and refresh never dispatch funds.

Sending is disabled unless `HACKREF_SANDBOX_PAYOUTS_ENABLED=true`, server-only sandbox credentials exist, and the exact approved recipient appears in `PAYPAL_SANDBOX_RECIPIENT_EMAILS`. The operator must verify that address privately against an actual PayPal Developer sandbox recipient account; the organizer separately confirms that verification in the send form. This is an organizer/operator attestation, not an account-ownership verification API. The app cannot determine from an arbitrary email whether a sandbox account exists.

No real PayPal requests were made during implementation or testing. PayPal developer account settings, the spike and its historical `.local/dispatch.json` guard were untouched. `.env` was not edited or printed. No Gemini call, application seed command, database reset, application migration or application award mutation was performed. All test fixture writes, including existing suite fixture seeds, were confined to disposable schemas in the dedicated local `_test` database. Neither `hackref` nor `hackref_real_dev` was migrated or modified.

## Files

| Files | Purpose |
| --- | --- |
| `src/lib/payouts.ts` | Scoped authorization, durable intent/claim, replay handling, atomic audited updates and reconciliation version fencing. |
| `src/lib/paypal-sandbox.ts` | Server-only OAuth, payout POST and read-only batch/item GET adapter; injected HTTP in tests. Safely adapted from the isolated spike. |
| `src/lib/payout-validation.ts` | Strict confirmation schemas and bounded provider identifiers. |
| `src/lib/payout-presentation.ts` | Conservative, user-facing explanations for prepared, accepted, pending, uncertain and reconciled states. |
| `src/app/api/awards/[id]/send-sandbox/route.ts`, `reconcile/route.ts` | POST-only actions using existing database-backed sessions, exact-origin and CSRF validation, JSON limits and sanitized errors. |
| `src/db/schema.ts`, `drizzle/0005_awards_stage_b.sql`, `drizzle/meta/0005_snapshot.json`, journal | Additive payout fields, evidence constraints and permanent database guards. |
| `src/lib/awards.ts`, organizer awards register/detail pages, `src/components/payout-controls.tsx` | Scoped payout reads, confirmation, masked summary, item observations, identifiers, audit history and read-only recovery controls. |
| `src/components/event-form.tsx` | Budget output now shows formatted USD only; decimal validation and integer-cent storage remain intact. |
| `.env.example`, `README.md`, this report | Opt-in server configuration, boundaries and operator instructions. |
| `tests/unit/paypal.test.ts`, `tests/database/payouts.test.ts` | Adapter, concurrency, crash, approval, audit, correlation, migration and status tests. |
| `tests/helpers/paypal.ts`, `payout-process.ts`, `paypal-preload.mjs`, `database.ts` | Mock HTTP, independent-process/crash fixtures, production-server HTTP injection, and migration-boundary fixtures. |
| Existing financial unit/invariant, HTTP and browser suites | Updated Stage A expectations and integrated Stage B checks. |
| `scripts/setup-organizer.ts` | Small security fix identified during required checks: terminal echo is disabled and the input listener attached before the hidden-password prompt becomes visible. This removes a PTY timing race. |

## Additive migration and permanent invariants

Migration `0005_awards_stage_b` only adds payout columns, constraints, an organizer foreign key, and a payout trigger/function. It does not replace tables, reset data, rewrite prior terms or expand the payout enum. The existing unique constraints on award, approval, sender batch/item IDs and PayPal item ID remain intact.

New fields include authorization actor/time, recipient verification time, dispatch state, permanent claim/time, state version, sanitized outcome, normalized item status and minimal correlated item evidence. The existing `reconciled_at` stores the last matched item observation. Audits preserve each observation and its exact `observedAt` timestamp.

Existing payout rows receive the additive default `dispatch_state=legacy`. Their financial terms, identifiers, statuses and timestamps remain unchanged. Legacy records can be reconciled but never dispatched by Stage B. A migration test constructs a Stage A database, inserts historical records including a succeeded historical payout, applies only Stage B, and compares all prior awards, approvals, assessments, audits and payout fields.

Authorization takes the event row lock, then the award lock. It checks organizer/event scope, award revision/title/submission/assessment, exact recipient/amount/USD, matching approval and its organizer, finalized assessment provenance, and the reserved event budget. Stage A immutable award/approval/assessment and budget triggers remain active.

The dispatch sequence is:

1. Commit the authorized intent, stable sender IDs and authorization audit.
2. Authenticate with PayPal. OAuth failure leaves a **prepared, never dispatched** intent and sanitized preflight audit.
3. Commit a permanent dispatch claim, `dispatch_started_at`, `status=unknown` and dispatch-start audit.
4. Only the request that created that intent and successfully committed that claim can make one payout POST.
5. Commit the sanitized result and audit together. If this persistence fails, the permanent started/unknown claim survives.

No database transaction stays open across provider HTTP. Event and payout row locks serialize concurrent writers across connections and processes. Repeated send requests return the existing payout; even prepared records do not automatically resume. Triggers prohibit deleting payouts, rotating financial identities or sender IDs, clearing/resetting a started claim, changing a known provider ID, reopening legacy records, or updating without a newer version. Award and approval terms remain immutable.

PayPal documents a 30-day sender-batch duplicate window. HackRef has no dispatch-claim expiration, deletion or retry/reset endpoint; provider retention is not its permanent safeguard. See [PayPal create-batch documentation](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-post).

## Sandbox HTTP and reconciliation

The adapter has no configurable base URL and no production mode. Its only paths are OAuth token creation, payout creation, original-batch retrieval, and original-item retrieval on `https://api-m.sandbox.paypal.com`. Identifiers are validated before interpolation. Every request rejects redirects, bypasses caches, has a 15-second timeout and has no retry loop. Duplicate-response links yield only a validated sandbox batch identifier; the app never follows provider-supplied URLs.

Money stays in bounded integer cents. USD serialization uses integer/BigInt formatting, including `10 → "0.10"` and the maximum supported integer amount. Tokens, credentials, raw error/provider bodies and full recipient addresses do not enter logs or financial audit metadata. The full approved address remains available only in the authenticated private award confirmation; register and payout summaries mask it.

**Reconcile status** performs OAuth and GETs only; it never creates or retries a payout. Local observations and audits are updated transactionally. It validates the original provider batch, permanent sender batch ID, exactly one batch item, sender item ID, approved recipient, EMAIL recipient type, exact amount and USD. It then retrieves that specific item and independently validates its provider batch/item IDs and sender/financial terms.

Batch acceptance, batch SUCCESS and a batch item's SUCCESS cannot substitute for the matching direct item's SUCCESS. See [PayPal item details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-item-get).

| Direct item status | Ledger observation |
| --- | --- |
| `SUCCESS` | `succeeded`, with correlated evidence, provider item ID and reconciliation timestamp. |
| `PENDING` | `pending`; payment unconfirmed. |
| `UNCLAIMED` | `unclaimed`; payment unconfirmed. |
| `FAILED` | `failed`; the individual item failed. |
| `RETURNED`, `REFUNDED`, `REVERSED` | `returned`; exact item status remains preserved. |
| `ONHOLD`, `BLOCKED`, missing/unrecognized status | `unknown`; never guessed to be succeeded or failed. |

A payout POST rejection is separately recorded as `REJECTED`/`failed`, without claiming an item failure or recipient payment. Duplicate replies remain uncertain pending correlated reconciliation. Timeouts, server errors, malformed successful responses and missing/incorrect acceptance identifiers remain unknown. Failed lookups or correlation mismatches retain the last matched evidence/time and explicitly flag the latest attempt as unverified. A later valid reversal can supersede an earlier observed success.

Each reconciliation reserves a newer state version before HTTP, and the final transaction applies its observation only if that version is still current. This also fences a delayed dispatch result. Older in-flight results cannot overwrite a newer observation. Audits and resulting status/evidence updates commit together.

## Automated verification

Final results: all required checks passed. Provider checks always use injected/mock HTTP; the browser itself never contacts PayPal or receives credentials. The HTTP/browser preload fixture is test-only, requires a disposable `_test` schema, and blocks real PayPal/Gemini access. It is not imported by application source or normal startup.

| Required command | Result |
| --- | --- |
| `npm run check` | Passed: 14 unit test files, TypeScript and ESLint. |
| `npm run test:db` | Passed: 80 tests in disposable schemas, including separate-process dispatch, abrupt exits and migration preservation. |
| `npm run db:check` | Passed. |
| `npm run build -- --webpack` | Passed; both new POST routes appear in the production build. |
| `npm run test:http` | Passed: 15 tests against the production build with injected PayPal HTTP. |
| `npm run test:ui` | Passed: full browser scenario, including real send/reconcile routes, timeout recovery and desktop/mobile checks; installed Chromium override described below. |
| `git diff --check` | Passed. |

The default Playwright browser revision is absent locally. Browser verification uses the existing installed Chromium through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome`; no browser installation or account changes were needed. Database/network-server checks and the production build needed execution outside the filesystem/network sandbox. The first restricted build failed in its TypeScript subprocess; the unrestricted Webpack build passed. A concurrent database/browser run exceeded the existing PTY setup test’s 15-second deadline; the complete database suite passed when rerun alone, without relaxing its timeout.

Coverage includes concurrent clicks across independent pools and separate processes; replay/restart; abrupt exits before and after the dispatch claim; duplicate batches and original-batch recovery; invalid credentials; provider rejection, HTTP errors and timeouts; exact money; approval-only inactivity; all listed item statuses; batch/direct-item disagreement; identifier/recipient/amount/currency mismatch; stale success after a newer reversal; failed audits before dispatch and after external acceptance; cross-event/session/CSRF boundaries; preservation of historical migration data; and disabled duplicate-send controls after refresh. Screenshots in ignored `test-results/sandbox-payout-*.png` cover desktop/mobile confirmation, pending, unknown and reconciled states.

## Limitations and operator investigation

- No real sandbox integration was exercised. Actual account access, Payouts permission, balances/fees and real recipient behavior still require separately authorized sandbox verification.
- Prepared intents are deliberately not resumed, including OAuth/preflight failures. There is no reset, cancellation, replacement-award or resend workflow. Operator investigation must preserve these records; any future recovery capability needs separate review.
- A started claim proves dispatch may have happened, not that a request reached PayPal. No automated process guesses otherwise. Unknown delivery without a stored batch requires manual lookup in the sender's sandbox activity.
- A recovered batch ID is accepted only after complete correlation. A duplicate reply's original ID alone does not prove award identity or recipient payment. A mismatched original ID requires investigation; the app cannot replace a known provider ID.
- Correlation is intentionally strict. Missing fields, changed email casing, unexpected amount representation or provider-contract changes can require operator investigation instead of reporting payment.
- Reconciliation is manual; there are no webhooks or polling jobs. A successful item is an observation at a recorded time, not a guarantee against a later refund/reversal. Provider raw payloads are intentionally not retained.
- There is no live-money capability, provider mutation/cancel action, or automatic retry. Preserve the durable ledger across backups/restores; do not drop constraints, clear claims, rotate IDs or delete records to bypass uncertainty.

## Future operator-controlled sandbox verification — not executed

These steps require separate operator review and authorization. The prior approval of **First Prize, USD 0.10**, does not authorize dispatch by this implementation.

1. Review this report, migration and final test results. Explicitly authorize applying the additive migration to the intended application database. Back it up, verify the selected database/event, confirm Stage A is present, and review which migrations are pending. Then the operator may run `npm run db:migrate` against that explicitly selected database. Do not reset or reseed it. This migration was not applied to either application database during implementation.
2. In the existing PayPal Developer sandbox accounts, privately verify the business sender, its sandbox REST credentials, available balance/fees, and the actual recipient account. Do not change developer account settings as part of verification. Compare the recipient email character-for-character with the original immutable award. If it differs or its sandbox-account provenance cannot be established, stop; do not edit or recreate the award to bypass the mismatch.
3. Privately configure `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET` and the exact verified address in `PAYPAL_SANDBOX_RECIPIENT_EMAILS`. Never use `NEXT_PUBLIC_*` or live credentials. Leave `HACKREF_SANDBOX_PAYOUTS_ENABLED=false` until a specific transfer has been authorized. Do not run the spike's execute command or modify its historical guard.
4. Sign in as the original event organizer. Open Awards on the **original demo event**, then the existing **First Prize** award. Confirm the event marker/identity, USD **0.10**, title/revision, submission, finalized assessment, recipient, original approval actor/time and budget. Confirm there is no existing payout record. Loading and refreshing this page must create no payout.
5. Obtain explicit operator authorization to send this one **USD 0.10 SANDBOX payout** to that exact verified recipient. Only then set `HACKREF_SANDBOX_PAYOUTS_ENABLED=true` privately and restart the application using its normal start/dev command. Do not use test preload flags. Re-open the same award, check both sandbox confirmations and press **Send sandbox payout** once. Record the durable sender/provider IDs without copying credentials or full recipient addresses into logs or chat.
6. Inspect the returned state. Acceptance is unconfirmed payment. A prepared record means no payout POST started; stop for investigation. Started/unknown, a timeout or a missing batch ID means do not send again. Preserve the record and locate the original batch in sender sandbox activity using its permanent sender batch ID.
7. Press **Reconcile status**. When delivery was uncertain and no batch ID was stored, enter the operator-recovered original PayPal batch ID. The app performs only reads and verifies all original terms. A mismatch, unavailable lookup or unknown status requires investigation, not another transfer. Pending/unclaimed/held/blocked statuses require later read-only checks.
8. Consider the recipient paid only when the matching direct individual item reports **SUCCESS**, its PayPal item ID and observation timestamp are stored, and the audit history shows the correlated transition. Check the recipient's sandbox activity privately. Refresh/replay must retain the same single payout record and keep sending unavailable. Later checks can record returns, refunds or reversals.
9. Set `HACKREF_SANDBOX_PAYOUTS_ENABLED=false` again after the authorized verification and restart the application. Read-only reconciliation remains available with server-side sandbox credentials. Retain the financial ledger, audits, stable IDs and spike guard permanently.
