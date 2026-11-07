# Focused judging UX pass

Work remains on `feat/judging-analytics`. No commit, push, merge, deployment or branch change was performed. Existing uncommitted judging/analytics work was preserved.

## Changes in this pass

| Files | Change |
| --- | --- |
| `src/components/app-shell.tsx`, `src/components/navigation.tsx` | Remove the sidebar promotional card; prevent desktop navigation shrinking; use viewport-height internal sidebar scrolling; show all six navigation destinations in a mobile grid. Preserve active links and header sign-out. |
| `src/components/management-forms.tsx`, `src/components/event-form.tsx` | Separate the event editor from submission registration. Generate new lowercase kebab-case slugs; stop automatic changes after manual editing or successful saving. Saved events initialize with their existing slug. Show immediate missing/character/80-character-limit feedback. Keep the event PUT contract. |
| `src/components/rubric-form.tsx`, `src/lib/management-validation.ts` | Replace pipe-delimited parsing with ordered criterion rows, generated/custom keys, add/remove controls, duplicate detection, field errors and a live total. Validate against the existing backend schemas: 1–20 criteria, 1–120-character labels, 1–40-character lowercase keys starting with a letter, integer maximum scores of 1–100. Confirm all rows together before one publication POST. |
| `src/app/(organizer)/event/page.tsx` | Wrap maximum-length historical criterion labels and keys within mobile snapshot cards, without changing their contents. |
| `src/lib/evaluation/analytics.ts`, `src/components/analytics-studio-runtime.tsx`, `src/app/(organizer)/analytics/page.tsx` | Use genuine AG Studio 3.1.0 widgets with wrapped titles, readable field names, explicit layout tracks, shorter tables, teal/amber chart colours, native responsive stacking and a contained mobile editor. Show real counts and contextual missing-score/evidence/distribution messages. Preserve report editing, chart/grid cross-filtering, null scores and non-demo organizer-scoped data. |
| `tests/unit/management-validation.test.ts`, `tests/ui/judging.test.ts` | Cover schema bounds, generated identifiers, invalid/duplicate keys, four ordered criteria in one publication, custom/saved slug behavior, publication cancellation, immutable historical snapshots, navigation reachability, mobile stacking and native Studio row selection. Retain existing human-finalization and AG Grid checks. |
| `docs/UX_POLISH_REPORT.md` | Record scope, validation and limitations. |

The Studio configuration follows the vendor's [3.1.0 responsive layout API](https://www.ag-grid.com/studio/react/responsive-layout/) and installed 3.1.0 TypeScript declarations for theme parameters, widget titles, grid headers and page layouts. No static replacement charts, custom sponsor mocks or undocumented DOM styling were added to the application.

## Data and integration boundaries

No application database records were changed, no application rubric was published, and application v1–v4 snapshots were never read or rewritten. No migrations, demo-seeding command, evaluation worker command, live Gemini call or PayPal operation was run. Database services, authoritative input schemas, evaluation/finalization/provenance logic, licence configuration and financial code were left unchanged by this pass.

Requested automated suites use a separate loopback database ending in `_test`, with disposable schemas removed afterward. Existing regression suites exercise their own seed fixtures inside those schemas. The browser suite creates its own v1–v4 fixtures, publishes exactly one four-criterion v5 through the real UI/API, and asserts the older snapshots remain byte-for-byte equivalent. Model and repository responses are offline fixtures; none of these are application submissions or assessments.

## Verification

| Exact command | Result |
| --- | --- |
| `npm run check` | Passed: 76 unit assertions including nested tests, TypeScript and ESLint. |
| `npm run test:db` | Passed: 53 database tests. |
| `npm run db:check` | Passed: migration metadata consistent. |
| `npm run build -- --webpack` | Passed: production compilation and route generation. |
| `npm run test:http` | Passed: 13 HTTP tests. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/cassy/.cache/ms-playwright/chromium-1179/chrome-linux/chrome npm run test:ui` | Passed: expanded production-browser integration scenario. |
| `git diff --check` | Passed. |

Build and service-dependent tests required execution outside the filesystem sandbox to run their subprocesses, bind loopback servers and access the separate test database. The initially restricted attempts failed; normal-access runs passed. No application environment file was edited.

Viewport checks cover 390×390, 390×844, 1280×390 and 1440×900, with report screenshots at 1440×1100. Browser assertions check navigation hit testing, active state, reachable sign-out, page-width containment, criterion publication, native Studio rendering and mobile widget stacking. Ignored screenshots in `test-results/` include `event-mobile.png`, `analytics-single-submission.png`, `analytics-single-mobile.png`, `analytics-desktop.png`, `analytics-editor.png`, `judging-desktop.png`, `judging-mobile.png` and `review-confirmation.png`.

## Remaining limitations

- Studio edit mode intentionally retains a horizontally scrollable desktop canvas on phones so its genuine widget and data panels remain usable; view mode stacks widgets natively.
- The browser suite uses local Studio trial mode with an explicitly empty test-process licence key. The user's activated application licence and environment were preserved; no activation or external-provider re-verification was attempted.
- Report edits remain in the current browser session, matching existing behavior. Scores, evidence and distributions depend on actual available records; no values are invented to fill the layout.

Human-approved PayPal prize settlement remains the next major milestone and was outside this pass.
