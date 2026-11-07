# Human judging, AG Grid and AG Studio

Implemented on `feat/judging-analytics`, based on `d610277` (merged PR #3). No branch changes, commits, pushes or deployments. PayPal spike and settlement code are untouched.

## Delivered behavior

### Stage 1: human-reviewed judging

`/judging/[draftId]` shows the preserved AI rationale, per-criterion suggestions, uncertainty, citations, collected excerpts, coverage limits and model/prompt/evidence provenance. The organizer can accept each scored suggestion or set an individual score with override reasoning. An unsupported/unscored criterion starts with an empty score and requires an explicit override and explanation. An explicit zero is permitted; a missing score is never converted to zero.

The organizer supplies an overall rationale, previews the complete decision, then explicitly clicks **Finalize human assessment**. Previewing does not write a decision. The saved page shows original AI suggestions and the human assessment separately, including each accepted/overridden criterion, rationale, reviewer name/ID, version and UTC timestamp. No awards, official winner selection or payout execution are added.

`POST /api/assessments/[id]/finalize` uses the existing authenticated database session, exact-origin and session-nonce CSRF checks, bounded JSON reader and error handling. The organizer's event scopes the lookup before accessing the draft. Foreign/missing records are hidden. Next can stream a not-found page with HTTP 200 after the layout has started; the mutation endpoint returns 404 and the page exposes no assessment data.

The service locks the original draft, checks its completed AI publication and immutable rubric, and validates all criterion keys exactly once against their maximum scores. Overrides require at least ten characters of reasoning; accepting a changed or unscored suggestion fails. Reviewer identity comes from the authenticated session. A new finalized assessment and audit event are inserted in one transaction. Identical retries return the same assessment with HTTP 200; a first finalization returns 201; conflicting approvals return 409. An audit insert failure rolls back finalization.

Finalized assessments cannot be edited or deleted. This milestone creates version 2 from the original version 1 AI draft; it does not offer amendment of a finalized human decision. Original draft scores, rationale, source evidence, findings and published model provenance are preserved.

### Stage 2: AG Grid comparison

`/judging` uses official AG Grid React Community modules, with organizer-scoped database rows. It includes projects/teams, pinned SHA, immutable rubric version, separate AI/human criterion scores and totals, citation coverage, collected/omitted files, tree truncation, evaluation status, review state and drill-down links.

There is one row per project/rubric, using the latest AI run, including manual retries; projects without an AI run remain visible. All rubric versions have separate criterion columns. Historical pre-AI pipeline jobs remain in submission job history, not in this AI comparison view. Partial AI assessments have no AI total. Amber identifies AI recommendations; teal identifies human-finalized scores. Sorting never awards an official winner.

Available interactions: header sorting and multi-sort, native text/numeric filters and floating filters, quick search, rubric selection, criterion/AI column visibility, resizing/reordering, pagination and reset. Accessible links provide another path to review pages. The grid scrolls internally on narrow screens.

### Stage 3: real AG Studio embedded analytics

`/analytics` mounts the actual `AgStudio` component and `AgStudioProvider`, dynamically in the browser. The report uses Studio's native editable canvas, widgets, data engine, field panels, grid widgets, chart widgets, cross-filtering and edit/view modes. Host report tabs select Studio pages through its documented `getState`/`setState` API; they preserve the current editor state. It does not substitute a custom chart dashboard. Editor changes remain in the current browser session and never change judging records.

The server supplies only the authenticated organizer's records. Demo events and demo submissions are excluded. No sample vendor dataset, invented submissions, financial data or official rankings are supplied. Data sources cover:

- Submission evaluation status and human review progress: latest AI run per submission, counted once.
- Criterion comparisons: actual AI/human scores and percent of the pinned criterion maximum, grouped separately by rubric version.
- Score distributions: separate human-finalized and complete AI totals as percent of each rubric maximum; each histogram requires at least two records of its own kind.
- Evidence coverage: criteria with collected citations, collected file counts, omitted counts and tree truncation, per project/rubric.

Citation coverage does not imply verified functionality or repository completeness. Missing scores stay null; they are excluded from averages/totals rather than filled with zero. Empty and insufficient-data states explain why a report is unavailable. Editor panels/canvas scroll inside their container on small screens. Compare matching rubric snapshots; a normalized percentage does not make different rubrics equivalent.

## Packages and official references

| Package | Installed version | Use |
| --- | --- | --- |
| `ag-grid-community` | 36.3.0 | Comparison grid, MIT Community modules |
| `ag-grid-react` | 36.3.0 | Official React grid |
| `ag-studio` | 3.1.0 | Official embedded analytics engine/widgets |
| `ag-studio-react` | 3.1.0 | Official React Studio and provider |
| `ag-grid-enterprise` | 36.3.0 (transitive) | Studio dependency |
| `ag-charts-enterprise` / `ag-charts-community` | 14.3.0 (transitive) | Studio dependency |
| `@playwright/test` | 1.64.1 (development) | Chromium UI verification |

Versions are locked in `package-lock.json`. Studio 3.1.0's published dependencies require Grid `~36.3.0` and Charts `~14.3.0`; `npm ls` verifies a single compatible dependency set. Existing React 19.3.1 satisfies the published peer ranges.

Official references checked during implementation: [Studio installation](https://www.ag-grid.com/studio/react/installation/), [Studio quick start](https://www.ag-grid.com/studio/react/quick-start/), [Studio data API](https://www.ag-grid.com/studio/react/data/), [Studio licence installation](https://www.ag-grid.com/studio/react/licence-install/), and [React Grid installation](https://www.ag-grid.com/react-data-grid/installation/). Published package declarations were also checked against the implementation.

## Licensing and local trial configuration

The comparison grid registers Community modules only and requires no Enterprise key. Studio is a separate commercial product. Its official documentation permits local evaluation without a key, with vendor watermark and console warnings. A trial/production Studio entitlement must be checked separately from AG Grid Enterprise; this implementation does not treat a Grid key as a Studio key.

No AG licence environment variable was present in the existing local `.env` when inspected. The existing user trial therefore has not been validated or automatically installed. Local integration can be exercised without a key. Production/non-loopback Studio rendering is gated when no Studio key is configured; human judging and the Community comparison grid remain available. Supplying a key does not by itself prove its entitlement or validity: the vendor validates it.

To use your existing **AG Studio** trial, add its actual value only to the ignored `.env`:

```dotenv
AG_STUDIO_LICENSE_KEY=<your AG Studio trial key>
```

Restart Next after changing it. The server passes it to `AgStudioProvider` only on the authenticated Analytics page. A browser-library licence must be delivered to the browser; do not put API credentials or other secrets in this setting. No licence string is committed. `.env.example` contains only a commented empty setting. No AI Studio module, remote assistant or LLM credentials are configured.

## Additive migration

`drizzle/0003_human_reviews.sql`, its snapshot and journal entry add:

- Nullable `assessments.source_draft_id` and `criterion_decisions` JSONB. Existing records retain null values; no scores or provenance are rewritten.
- A composite self-reference proving the source draft shares the same run/submission/event; source uniqueness; one new human review per evaluation run; review shape checks.
- SQL finalization validation for exact rubric keys, numeric bounds, event ownership, source draft/version, explicit criterion decisions and override reasoning. Existing historical records remain intact; newly finalized historical records must satisfy score/ownership checks.
- Triggers rejecting changes/deletion of finalized assessments and published AI drafts, and changes/deletion of published AI run provenance, evidence and findings.

No tables or columns are dropped. No financial schema changes are introduced. The application service writes the immutable final record and its audit event together; there is no automatic migration-time finalization.

## Local verification

Use Node 22.22.x and npm 10.x. Keep `DATABASE_URL` and a separate local `TEST_DATABASE_URL` in ignored `.env`; never point tests at application/production data. Existing organizer/auth/Gemini setup remains as documented in `DEVELOPMENT.md` and `EVALUATION_ENGINE_REPORT.md`.

```bash
npm ci
npm run db:up
npm run db:migrate
npm run check
npm run test:db
npm run db:check
npm run build -- --webpack
npm run test:http
npx playwright install chromium
npm run test:ui
```

The browser suite needs OpenSSL to create a temporary self-signed TLS proxy, preserving production secure-cookie checks. It uses only isolated test database schemas, mocked source/provider responses and temporary TLS material; it never finalizes an application submission or contacts GitHub/Gemini/PayPal. Chromium can be overridden with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing installation. Screenshots are written under ignored `test-results/`.

For interactive verification, start `npm run dev` at the exact loopback `APP_ORIGIN` configured by `npm run auth:configure`; run `npm run worker` in another terminal. Use the existing local organizer login and a non-demo event. Register actual authorized public repositories and publish a rubric, then queue their evaluations. No demo seed is required or used for analytics. An event previously created by `db:seed` remains marked demo; its records intentionally do not become real analytics by changing its display name.

1. Open Judging. Search/filter by project, choose a rubric, toggle AI/criterion columns, sort and resize headers. Verify that the pinned SHA matches the submission and that an incomplete AI draft has no total.
2. Open **Evidence & review** (or an accessible assessment link). Inspect citations, excerpts, omissions and model provenance.
3. Accept a scored suggestion. Override another criterion and explain your reasoning. An unscored criterion must start blank and require its own score and explanation.
4. Supply overall rationale; click **Review final decision**. The database must still contain only the draft at this point. Click **Finalize human assessment** to save.
5. Refresh: original AI content is preserved alongside the human final, reviewer, reasons and UTC timestamp. The form is gone. Repeat the exact API request to get the same record; change it to get 409.
6. Open Analytics. Use the report tabs to select Studio pages, select chart bars or grid rows to cross-filter, switch edit/view modes, expand the native Compose/Data panels and drag fields onto the canvas. With fewer than two human finals, the human distribution must remain unavailable. Demo-only events show an honest empty state.
7. Inspect Judging and Analytics at desktop and mobile widths. Content should stay within the page, with internal grid/editor scrolling.

Build-cache troubleshooting: browser verification discovered stale Next 16.4.4 route-cache HTML referencing deleted assets from an older build. The old `.next` directory was preserved under `/tmp/hackref-next-stale-judging-20261105` and rebuilt from scratch. If reproducing on an existing checkout with stale assets, stop local Next processes, preserve/move `.next` out of the repository, then run the build again; do not run a build concurrently with production HTTP/browser tests.

## Verification results

The additive migration has been applied successfully to the configured local application database. No application assessment was automatically finalized.

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 72 unit tests, TypeScript, ESLint with zero warnings |
| `npm run test:db` | Passed: 53 tests, including review concurrency, idempotency, authorization, score bounds, audit rollback, immutable provenance and SQL constraints |
| `npm run db:check` | Passed |
| `npm run build -- --webpack` | Passed from fresh build output |
| `npm run test:http` | Passed: 13 tests, including production sessions, origin/CSRF, human finalization, replay/conflict, foreign assessment isolation, HTML escaping and existing evaluation/retry behavior |
| `npm run test:ui` | Passed: Chromium integration scenario covering real rendered AG Grid and AG Studio, review preview without a write, explicit finalization, separate preserved AI/human views and mobile containment |
| Additional review SQL scope assertion | Passed: focused database suite, 7 tests |
| `git diff --check` | Passed |

The browser suite was run with the locally cached Chromium executable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome npm run test:ui
```

It verified database rows in AG Grid, search, sorting, AI-column visibility, drill-down, an initially empty unscored field, override reasoning, preview without finalization, one saved human version, all four Studio report pages (including the real histogram), rendered chart canvases, edit/view switching, no uncaught browser errors and no Studio rendering-error notification. Desktop and 390px mobile screenshots were visually inspected. Screenshots under ignored `test-results/` include `judging-desktop.png`, `review-confirmation.png`, `analytics-desktop.png`, `analytics-editor.png` and `judging-mobile.png`.

The Studio key-specific activation/expiry/entitlement path remains unverified because no actual Studio trial key was configured. Local unlicensed Studio rendering was verified; it is not evidence of a production licence. No live provider calls, awards or payments were made by these tests.
