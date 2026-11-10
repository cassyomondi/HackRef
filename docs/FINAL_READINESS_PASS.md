# Final usability and data-integrity pass

November 10, 2026 · `chore/hackathon-demo` · deadline November 12.

This pass preserves the previous judging and analytics polish. It adds submission readiness and makes report scope explicit. No application migrations, live registrations, Gemini/PayPal requests, financial writes, environment edits, commits or pushes are performed.

## Changed files in this pass

- `src/app/(organizer)/submissions/page.tsx`: prominent top-right registration link; same `ownedEvent` scope used by analytics; accurate full registry count with latest-200 display limit. The form moves off the registry.
- `src/app/(organizer)/submissions/new/page.tsx`: authenticated dedicated route reusing `SubmissionForm`, with event-setup guidance when needed.
- `src/components/management-forms.tsx`: existing POST API and validation retained; green accessible registration status; navigate to the returned submission ID and prevent a second submit during navigation.
- `src/app/(organizer)/submissions/[id]/page.tsx`: destination status when arriving from registration. The `registered=1` presentation flag persists on refresh and has no effect on records, identity, authorization, pinning or evaluation state.
- `src/app/(organizer)/analytics/page.tsx`: collapsed “How metrics are calculated”, visible event/eligible-project context, and a fresh Studio instance when organizer/event/data changes. Licensing remains unchanged.
- `src/components/analytics-studio-runtime.tsx`, `src/components/analytics-studio.tsx`: concise instructions, native view mode, explicit filtered/all-project scope and native-state filter reset. The editor remains available through the internal `allowCustomization` prop (default false), which the analytics route does not enable; no query parameter exposes editing.
- `src/lib/evaluation/analytics-state.ts`: detects native selected-page cross-filters and page/widget filters; clears filters immutably on every page while preserving widgets/layout.
- `src/lib/evaluation/analytics.ts`: modest KPI typography adjustment and native leaderboard bar width/value labels. Null scores, ties, rubric dimensions, sources and aggregation logic are preserved.
- `tests/unit/analytics-state.test.ts`: selection/range/page/widget filter detection, per-page scope and immutable whole-report clearing.
- `tests/helpers/paypal-preload.mjs`: isolated-test-only GitHub metadata/SHA responses for registration; unexpected GitHub and real model requests are blocked. Existing PayPal transport remains mocked.
- `tests/http/pass2.test.ts`: authentication for the new route, registry CTA and dedicated validated form.
- `tests/ui/judging.test.ts`: real form/POST registration in disposable schemas with mocked GitHub, destination success and refresh, duplicate rejection without record changes, collapsed methodology, absence of ordinary editor controls, native KPI cross-filtering with scope notices, clear/reset/page-switch/reload behavior and existing null/tie/mobile regressions.

`finalize-review.tsx`, `judge-comparison.tsx` and `tests/unit/reviews.test.ts` retain their earlier uncommitted changes; this pass does not replace them.

## Read-only investigation

Diagnostics used PostgreSQL connections with `default_transaction_read_only=on`, a public search path and bounded query timeouts. They called the actual `listComparison` and `analyticsData` functions with organizer-scoped database rows. No provider credentials, login details, repository contents or payout recipients were output.

### Current database evidence

| Database | Event | Registry | Eligible analytics | Human finals / highest |
| --- | --- | --- | --- | --- |
| Configured `hackref` | DEMO · HackRef development event | 2 projects | 0 projects (demo event excluded) | No eligible final score |
| `hackref_real_dev` | HackRef Evaluation Pilot | 4 non-demo projects | 4 projects | 4 / 82.5% |

Current showcase finals, all under Combined Rubric v5 (maximum 40):

| Project | Final | Percentage |
| --- | --- | --- |
| Airline Booking CLI | 31/40 | 77.5% |
| FundFlow | 33/40 | 82.5% |
| HackRef | 31/40 | 77.5% |
| Project Idea Vault | 33/40 | 82.5% |

The previously described three projects/scores remain present; Project Idea Vault is a fourth project. Its registration timestamp is November 9 at 23:37 EAT and its finalization is November 9 at 23:49 EAT. There is one evaluation run, a partial AI draft (24 points across three scored criteria), and one immutable human final (33 points across four criteria). No persisted 31/40 Project Idea Vault final was found. Its submission creation/update timestamps are equal.

The installed native AG Studio data engine was also queried in memory using the actual organizer-scoped report sources read from the showcase database (no copied/inserted records):

| Native query scope | Registered-project sum | Highest finalized max |
| --- | --- | --- |
| All projects | 4 | 82.5% |
| Project Idea Vault | 1 | 82.5% |
| HackRef | 1 | 77.5% |

All three native queries completed without engine errors. This rules out a current native max-aggregation error for this dataset; it does not establish the historical screenshot's state.

### Cause classification

- **Confirmed UI ambiguity:** native cross-filtering changed KPI queries without a visible host scope notice. A single selected 31/40 project can yield 1 registered project and 77.5%. The new notice/reset control addresses this actual usability bug without changing scores.
- **Project Idea Vault screenshot:** selecting Project Idea Vault from the current data should yield 1 and 82.5%, so selection alone does **not** explain the user's specific 1 / Project Idea Vault / 77.5% screenshot. Its exact historical cause remains unresolved without that image and its browser/report state. Do not label it a confirmed filtering or scoring bug.
- **Environment difference confirmed, screenshot attribution unproven:** the configured database is `hackref`; showcase records are in `hackref_real_dev`. The current demo database would yield zero eligible projects, not the reported screenshot. No environment setting was changed.
- **No persisted browser-state restoration found:** the host does not load Studio state from local/session storage or a database. Selections exist in the mounted report. Refresh resets them; changed data/event snapshots now remount Studio. Historical stale in-memory rendering cannot be proven from current records.
- **No current score/data-loss bug found:** registry and analytics use the same organizer's single event (`one_event_per_organizer` is enforced). Eligible source IDs match non-demo registry IDs. Registry count versus analytics can differ intentionally for demo records; registry rows are limited to 200, while its count and analytics eligibility use the full event dataset.

## Verification

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 105 unit tests, TypeScript and ESLint |
| `npm run db:check` | Passed |
| `npm run build -- --webpack` | Passed, including `/submissions/new` |
| `npm run test:http` | Passed: 15 tests |
| `npm run test:ui` | Passed: complete Chromium integration scenario, including registration/duplicate handling, scope notices, clear/reset/page switching, nulls/ties and mobile layout |
| Read-only native Studio KPI diagnostics | Passed: full dataset 4 / 82.5%; Project Idea Vault 1 / 82.5%; HackRef 1 / 77.5% |
| `git diff --check` | Passed |

Browser executable: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome`.

All test writes are confined to disposable random schemas in the separate local test database. Tests initialize their existing fixture schema; no migration command or application database migration is run. Existing payout regressions use only mocked transport. Sandbox restrictions prevented subprocess capture and loopback access, so successful build/check/HTTP/browser/diagnostic runs used approved execution outside the sandbox. Logs are in `/tmp/hackref-final-{check,build,http,ui}.log` for this session.

## Manual review

1. Confirm the intended launch environment and visible event name before recording the demo. The showcase event is **HackRef Evaluation Pilot** in `hackref_real_dev`; this pass does not switch `.env` or create live records.
2. Open `/submissions`: the top-right **+ Register submission** link opens `/submissions/new`. Check labels, required fields and navigation without submitting a real repository. Registration success/duplicate handling is exercised in disposable browser fixtures.
3. Open `/analytics`: methodology is collapsed, the event and eligible project count are visible, and there is no View & Filter label or Customize report control.
4. In Review Progress, select a row. Confirm the native KPI changes and amber filtered-view notice. Switch pages and return; the selected report retains its native session selection. **Clear all filters** restores full scope across pages; refresh also starts clean.
5. For the current showcase, the full-data project count should be 4 and highest finalized percentage 82.5. Project Idea Vault alone should be 82.5; Airline Booking CLI or HackRef alone should be 77.5. Do not infer a winner from sorting or ties.
6. Review the leaderboard, criterion comparison (missing AI scores remain dashes), evidence caveat and 390px mobile layout. Native grids may scroll and long phone labels may truncate; full data remains in tooltips/tables. Studio licence entitlement is outside these local unlicensed evaluation tests.

Test screenshots under ignored `test-results/` show disposable fixture projects (**Review Alpha/Beta**), not live showcase data: `submissions-registry.png`, `submission-new.png`, `submission-registered.png`, `analytics-desktop.png`, `analytics-filtered.png`, `analytics-leaderboard.png`, `analytics-criteria-mobile.png` and `analytics-evidence.png`.

API references checked: installed AG Studio 3.1.0 declarations for report state, cross-filters, filters, value/bar widgets and theme; [official Studio state API](https://www.ag-grid.com/studio/javascript/state/).
