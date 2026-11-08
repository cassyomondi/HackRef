# Awards Stage A

Stage A implements organizer-controlled prize allocation and a separate permanent approval of exact financial terms. It never contacts PayPal, creates a payout intent, dispatches money, calls Gemini, or executes the CLI spike. Existing development data and credentials are unchanged. Work remains on `feat/paypal-awards`; no commit, push, merge, deployment or branch change was performed.

## Files and migration

| Files | Change |
| --- | --- |
| `src/lib/money.ts`, `awards-validation.ts` | Exact decimal-text conversion using integer arithmetic, USD formatting, recipient masking and bounded strict allocation/approval schemas. |
| `src/lib/award-budget.ts`, `awards.ts` | Shared reservation total, transactional allocation/approval, scoped reads, exact confirmation comparison and sanitized audit writes. |
| `src/lib/event-service.ts`, `validation.ts` | Optional integer-cent event budget; omitted budgets preserve existing values; event lock protects reductions. |
| `src/app/api/awards/route.ts`, `src/app/api/awards/[id]/approve/route.ts` | Separate authenticated, exact-origin CSRF-protected allocation and approval endpoints using existing bounded JSON helpers. |
| `src/app/(organizer)/awards/page.tsx`, `awards/[id]/page.tsx`, `src/components/award-forms.tsx` | Responsive award register, allocation, private exact-term confirmation, provenance and financial summary cards. |
| `src/components/event-form.tsx`, `src/app/(organizer)/event/page.tsx` | Budget configuration and explanations of zero budget and reservation constraints. |
| `src/app/(organizer)/page.tsx`, `README.md` | Awards capability references and this report. Overview metrics remain placeholders. |
| `drizzle/0004_awards_stage_a.sql`, `drizzle/meta/0004_snapshot.json`, `_journal.json` | Additive PostgreSQL guard functions/triggers; no new tables, destructive SQL or data backfill. |
| `tests/unit/awards.test.ts`, `tests/database/awards.test.ts`, `tests/helpers/awards.ts` | Validation, integer cents, authorization, finalization, concurrency, database guards, replay, rollback and execution-isolation coverage using offline fixtures. |
| `tests/database/invariants.test.ts` | Foundation fixture now finalizes before allocation; verifies draft allocation rejection under the stricter rule. |
| `tests/http/pass2.test.ts`, `tests/ui/judging.test.ts` | Production HTTP and real Chromium award flow, exact stored terms, masked lists and no implicit approvals. Existing judging and Studio checks retained. |

The migration was generated as a custom additive Drizzle migration. Existing `awards`, `award_approvals`, `payouts`, `audit_events`, award revision and composite foreign keys are retained. The SQL adds guards without rewriting or deleting any event, award, approval, assessment or AI evidence. Historical invalid/over-budget records are retained; eligibility and aggregate budget are checked before a new approval or allocation. Existing historical approvals remain visible.

The migration has only been applied inside disposable test schemas. It was **not** applied to the original demo database or `hackref_real_dev`. Before using the feature in a chosen application database, review and apply the checked-in migrations intentionally. No seed, application-data mutation or live provider request is required to review this change.

## Financial invariants

- Every stored/API amount is an integer number of USD cents. Budget range is 0–2,147,483,647; award range is 1–2,147,483,647. Dollar-text input rejects negative values, exponents, fractions beyond two places and overflow; it uses `BigInt` conversion rather than multiplying floating-point dollars. Recipient case and supplied address are preserved exactly.
- Every allocated award reserves budget immediately, even before approval. `SUM(awards.amount_cents) <= event.budget_cents` is checked under the event row's `FOR UPDATE` lock. Approval does not reserve twice. Budget reductions acquire the same lock and cannot fall below any reserved awards, including approved ones. Omitted budgets preserve existing records' budgets.
- Direct SQL insert/update guards also lock the event and enforce budget and eligibility. Tests observe a real competing PostgreSQL lock wait, then confirm the losing insert sees the committed reservation. Case-insensitive duplicate titles and duplicate projects are rejected under the event lock. Event creation/edit serialization uses an organizer `NO KEY UPDATE` lock so the approver/auditor's foreign-key `KEY SHARE` checks can complete while an event edit waits; a forced-overlap regression verifies this avoids a lock-order deadlock.
- Stage A allows one immutable award per project, with a unique title per event (case-insensitive for new allocations). It accepts only a finalized assessment for that exact submission/event, finalized by the event's organizer. Multiple final assessment versions are listed with their versions; selecting one never promotes AI ranking to an official result.
- Allocation requires an organizer-supplied email and explicit recipient confirmation. It creates revision 1 and an allocation audit record atomically. It creates no approval or payout. Invalid inputs and duplicate allocations leave no partial financial writes.
- Approval requires a separate checked confirmation and POST containing the displayed title, project, assessment, revision, exact amount, USD currency and recipient. Every term must match the immutable stored allocation. The transaction locks event and award, rechecks assessment and total reservations, then writes the exact approval snapshot, organizer ID, database timestamp and audit event together.
- Concurrent identical approval requests create exactly one approval and one approval audit event. An identical replay returns the same approval (`200`, versus `201` on creation); differing valid terms return `409`. The existing award/revision uniqueness and exact-term composite foreign keys remain effective.
- Awards and approvals cannot be updated or deleted, including by ordinary direct SQL. Existing immutable assessment/evidence guards remain intact. The award title/project are fixed by the allocation's immutable row; the approval's existing columns snapshot its financial terms and assessment. There is no edit, cancellation, replacement, revision-bump or budget-release endpoint in Stage A.
- Financial audit metadata contains only IDs, revision, cents, currency and budget totals. It contains no recipient, title/free text, credentials or provider payloads. Audit insertion failure rolls back the allocation/approval. Existing request error handling prints only a generic service failure.
- List views mask local and domain portions of recipient emails. Full recipients appear only on their authenticated, event-owned private confirmation. API responses return IDs, not recipient snapshots. Both mutations use organizer authentication, exact configured-origin CSRF, strict field schemas and the existing 32 KiB JSON bound. Read/preview actions perform no mutations.
- `payouts` is read only to accurately label any pre-existing historical record; no Stage A path inserts or changes it. An approved award with no payout record is shown as not sent. The spike, payout schema, PayPal configuration and worker remain unchanged.

## Automated verification

Final command results are recorded below. Database, HTTP and browser fixtures use the repository's dedicated loopback `_test` database with unique disposable schemas, never either application database. GitHub/Gemini fixtures are offline. Existing fixture seed helpers run only inside test schemas; `npm run db:seed` was not run.

| Command | Result |
| --- | --- |
| `npm run check` | Passed: all 12 unit test files, TypeScript and ESLint |
| `npm run test:db` | Passed, 64 tests |
| `npm run db:check` | Passed |
| `npm run build -- --webpack` | Passed: production compilation, TypeScript and route generation |
| `npm run test:http` | Passed, 14 tests |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome npm run test:ui` | Passed: complete browser scenario including existing judging/Studio checks, exact approval and mobile layout |
| `git diff --check` | Passed |

Database, server/browser and Webpack verification required approved execution outside the sandbox for local sockets and subprocesses. Final check/build verification ran sequentially. Chromium verified that an unchecked confirmation and repeated preview/reload do not approve, exact recipient/cents are persisted, budget reductions fail, no full recipient enters register HTML/serialized data, no PayPal/Gemini browser requests occur, and no payout rows are created. Desktop and mobile screenshots were visually inspected; no page overflow or uncaught browser errors were observed.

## Precise browser verification

Use a disposable test database and organizer when reproducing these steps; preserve the original demo and `hackref_real_dev`. The browser suite provisions this isolation automatically, uses a temporary TLS proxy for secure cookies, starts the production build and removes its schema afterward.

1. Sign in and visit `/awards` before creating an event: verify the event setup link and empty state. Create an event at `/event` with a zero budget; Awards must show zero funds, no finalized assessments and no awards.
2. Finalize an assessment in Judging using the existing review confirmation. Return to Awards: the human score, final version, reviewer, immutable rubric and pinned SHA must appear. Allocation must be disabled with no available budget.
3. At `/event`, set Prize budget (USD) to `200.01`. Save; the database must contain `budget_cents = 20001`. Return to Awards and choose the intended human-finalized assessment.
4. Enter a title, `125.51`, and a recipient supplied directly by the team. Check recipient confirmation and click **Allocate award · review next**. The new private page must show project, title, final assessment/version, recipient verbatim, `USD 125.51`, revision 1, `USD 74.50` remaining and zero additional reservation on approval.
5. Verify the allocation is `amount_cents = 12551`, with no approval and no payout. Reload the preview: no approval is created. Attempt submission with the final confirmation unchecked: no approval is created.
6. Check the explicit permanent-approval confirmation and click **Approve these exact award terms**. Verify one approval with exactly the displayed recipient/cents/assessment/revision and signed-in organizer ID plus timestamp. Reload: no second approval. No payout is created or sent.
7. Return to `/awards`: verify **Approved exact terms** and **Not sent** are distinct; the full recipient must be absent from HTML and serialized page data. Draft allocations use a separate amber badge. Provenance links open the original review and evidence.
8. At `/event`, try lowering the budget to `125.50`; saving must fail and preserve `20001`. With any allocated unapproved award, also verify funds stay reserved before approval.
9. Inspect the register and preview at 1440 px and 390 px widths. Tables scroll within their cards, the page does not overflow, labels remain readable, and keyboard focus/checkboxes are usable. Confirm browser network activity contains no PayPal or live Gemini requests.

Screenshots are written to ignored `test-results/awards-desktop.png`, `awards-mobile.png`, `award-confirmation-desktop.png` and `award-confirmation-mobile.png`. They contain only synthetic test recipients.

## Limits and Stage B handoff

Stage A validates email syntax and organizer attestation; it does not verify mailbox ownership, PayPal account existence, Payouts permission, sender balance or payment eligibility. Budget represents prize principal only, not PayPal fees. Allocations deliberately cannot be corrected or released in this milestone. An incorrect allocation must remain unapproved until an explicit audited correction/cancellation design is implemented. Database administrators can disable triggers; application authorization and audit atomicity assume use of the supported services with ordinary table constraints intact.

Stage B should consume the immutable `award_approvals` snapshot through a **separate explicitly authorized sandbox execution action**, never allocation or approval hooks. In a transaction, recheck ownership/approval/terms, reserve one durable `payouts` intent per award and approval, and persist permanent sender batch/item identifiers before dispatch. A leased/fenced worker can then contact a fixed sandbox endpoint with isolated server credentials and bounded transport behavior. Never invoke the CLI as an application subprocess.

Persist provider identifiers and request outcomes without secrets or full recipient logs. Treat timeouts, malformed responses and ambiguous acceptance as unknown; retain identifiers and reconcile rather than create a replacement intent or rotate sender IDs. Provider duplicate windows supplement the permanent local uniqueness constraints.

Reconcile each PayPal item against its original approved recipient, USD amount and stable sender item ID. Only verified item-level success with external item ID and reconciliation timestamp may mark `succeeded`; batch acceptance/success alone cannot. Preserve pending, failed, unclaimed, returned and unknown outcomes, with immutable/sanitized transition audit history. Reconciliation needs durable scheduling/recovery, idempotent observations and a reviewed policy for reversals. New identifiers or replacement payouts require a separately designed history-preserving workflow. Live-money mode remains outside scope.
