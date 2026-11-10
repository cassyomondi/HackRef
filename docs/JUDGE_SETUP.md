# HackRef judge setup

This guide reproduces the app from source on a fresh local machine. Use Linux/macOS or WSL Ubuntu with an interactive terminal. Hosting is optional: the [official rules](https://paypalaihackathon.devpost.com/rules) accept complete local setup/run instructions as access to a functional build.

Commands were checked against `package.json`, scripts, and application code. Documentation preparation did **not** execute migrations, provisioning, seeds, provider requests, or payouts. A complete fresh-machine run remains a manual submission check.

## Quick Start

For a fresh checkout with Node 22.22.0, npm 10.9.4, and Docker Compose available, run at the repository root:

```bash
npm ci
cp -n .env.example .env
npm run db:up
npm run db:migrate
npm run auth:configure
npm run organizer:setup
npm run dev
```

`organizer:setup` is a **one-time secure administrator bootstrap in an interactive terminal**. Then sign in normally at **http://localhost:3000/login**. No web signup exists or is required. For prerequisites and command details, see [source/runtime](#1-source-and-runtime), [database setup](#2-local-postgresql-and-migrations), and [authentication](#3-authentication-and-organizer-provisioning).

- **Core local functionality, no Gemini/PayPal credentials:** browser login, [event/rubric setup](#4-event-and-rubric), and empty submission/judging/analytics views. [Public repository registration](#5-public-github-registration) additionally requires GitHub network access; a token is optional.
- **Credential-dependent functionality:** new AI drafts require [Gemini access and the worker](#6-gemini-credentials-and-worker); human finalization requires a completed draft. New payouts require a human final, allocation, approval, and [separately authorized PayPal sandbox access](#9-optional-separately-authorized-paypal-sandbox-test). Leave sending disabled for ordinary setup.

**Fresh installs contain neither the four-project showcase nor the prior payout record.** No private database dump is supplied; the optional seed does not recreate those records. Read the [access status](#judge-access-requirements-and-status) before planning provider-dependent testing.

## Judge-access requirements and status

| Capability | Required access | Current judge-access status |
| --- | --- | --- |
| Core local app | Node/Docker and the organizer created by your own terminal bootstrap | No shared login needed; no hosted judge login is arranged |
| GitHub registration/source collection | Public authorized repository and outbound GitHub access; optional read-only token | No shared GitHub token provided; anonymous access is supported subject to rate limits |
| New Gemini evaluations | API key, quota, configured-model access, and worker | Dedicated judge key/quota/access remain unarranged; private developer configuration is not shared judge access |
| AG Studio | Loopback evaluation, or appropriate Studio entitlement for non-loopback use | Local evaluation is described below; no shared hosted judge service/entitlement is arranged |
| New sandbox payouts/reconciliation | Authorized sandbox sender app, credentials, recipient account, and separate operator authorization | Dedicated judge sandbox accounts/credentials remain unarranged; the previous private test does not grant access |

No credentials, test accounts, funded services, or access delivery are promised by this guide. Provider-dependent testing needs either the judge's own authorized access or a separately confirmed private arrangement. Before submission, the maintainer must resolve how judges can test required integrations without charges and document the actual private access route. Until then, full provider-dependent reproduction is an outstanding submission task.

## 1. Source and runtime

```bash
git clone https://github.com/cassyomondi/HackRef.git
cd HackRef
```

Use the final source revision linked from Devpost. The documentation is being prepared on `docs/hackathon-submission`; that branch must be published before a remote checkout of it can be assumed. Do not replace an existing working checkout/database to follow this guide.

Install Node **22.22.0** and npm **10.9.4**. If nvm is already installed, `.nvmrc` selects the correct Node version:

```bash
nvm install
nvm use
node --version
npm --version
npm ci
docker --version
docker compose version
```

Expected: Node `v22.22.0`, npm `10.9.4`; supported engines are Node `>=22.22.0 <23`, npm `>=10`. With a direct Node installation omit the nvm commands. Docker Engine/Desktop must be running and accessible to your user. Retain the root lockfile. The historical PayPal spike has separate dependencies and is unnecessary for running HackRef.

## 2. Local PostgreSQL and migrations

```bash
cp -n .env.example .env
```

This preserves an existing `.env`. Review it privately: `DATABASE_URL` must target the intended **local** database. Do not print it or include it in screenshots. The template sets:

| Variable | Local template value / purpose |
| --- | --- |
| `POSTGRES_USER` | `hackref` |
| `POSTGRES_PASSWORD` | `hackref_local_only`, local sample only |
| `POSTGRES_DB` | `hackref` |
| `POSTGRES_PORT` | `5433` on the host |
| `DATABASE_URL` | Template URL for that user/database at `127.0.0.1:5433` |
| `HACKREF_SANDBOX_PAYOUTS_ENABLED` | `false`; leave disabled for ordinary judging |

If changing the password, URL-encode it in `DATABASE_URL` and keep all settings consistent. If port 5433 is occupied, change both `POSTGRES_PORT` and the URL port. An existing named volume retains its original credentials; editing `.env` does not change them.

```bash
npm run db:up
npm run db:migrate
```

`db:up` runs `docker compose up -d --wait`. Compose pins PostgreSQL `16.15-alpine`, binds only to `127.0.0.1`, checks readiness, and persists data in a named volume. `db:migrate` applies committed `drizzle/` migrations, including invariant-enforcing triggers. Do not substitute schema push or migration generation.

`npm run db:logs` follows local database logs; Ctrl-C exits the viewer. Keep logs private. `npm run db:down` stops Compose without removing its volume. Do not remove/reset a volume containing existing work.

## 3. Authentication and organizer provisioning

```bash
npm run auth:configure
npm run organizer:setup
npm run dev
```

`auth:configure` adds a random `SESSION_PASSWORD` and `APP_ORIGIN=http://localhost:3000` to ignored `.env`, preserves existing settings, restricts file permissions, and never prints the secret. Check existing values: the session secret needs at least 32 characters of strong random material; the origin must match the browser exactly, without a path or trailing slash.

`npm run organizer:setup` is the **one-time secure administrator bootstrap**, performed in an interactive terminal before ordinary browser use. Enter your own valid email and display name, then a hidden password of at least **15 characters**, at most 256 UTF-8 bytes, and confirm it. No default credentials or email delivery are involved. No web signup exists or is required. The MVP permits only one password-provisioned organizer per installation; do not rerun bootstrap for each login.

Open **http://localhost:3000/login** and sign in. Do not alternate `localhost` and `127.0.0.1`: origin and CSRF checks require an exact match. Sessions expire after eight hours; ten login attempts in a 15-minute window trigger throttling. If intentionally rotating an existing password:

```bash
npm run organizer:setup -- --reset-password
```

Use the existing organizer email. Rotation revokes all sessions; it is not part of normal setup.

For local HTTP use `npm run dev`. **`npm start` uses production authentication and requires HTTPS `APP_ORIGIN`**, a TLS proxy, and secure cookies. A successful production build does not make plain localhost HTTP login work in production mode.

## 4. Event and rubric

Open **Event & rubric** (`/event`). Create an event with a name, lowercase hyphen-separated slug, status (for example `open`), and prize budget in **USD dollars**, not cents: `1.00` means USD 1.00. A `0.00` budget is acceptable when only evaluating. The form explicitly uses **UTC** for its deadline. Choose a future deadline for **your test event**, for example seven days after your setup date, and enter its UTC value. The November 12, 2026 hackathon submission deadline is submission metadata, not a required test-event value; judges running later should not copy it.

Save the event, then publish a titled rubric with 1–20 criteria. Each key starts with a lowercase letter and contains only lowercase letters/numbers/underscores; keys must be unique. Each maximum is an integer from 1–100. This sample matches the four labels and 10-point maxima of the showcase's Combined Rubric v5:

| Label | Key | Maximum |
| --- | --- | --- |
| Engineering quality | `quality` | 10 |
| Functionality and implementation | `functionality` | 10 |
| Documentation clarity | `clarity` | 10 |
| Innovation and originality | `innovation` | 10 |

Select **Review publication**, inspect it, then **Publish new rubric version**. This creates your own 40-point rubric snapshot, not the showcase's stored v5 record or assessment history. Each publication creates an immutable version; jobs retain their selected version. The MVP supports one event per organizer.

## 5. Public GitHub registration

Visit **Submissions → + Register submission** (`/submissions/new`). Use a public repository your team is authorized to submit. Supply project/team names, the canonical `https://github.com/owner/repository` URL, matching GitHub owner, optional commit/branch/tag, and 1–20 explicit claims (one per line, at most 1,000 characters each). Confirm ownership authorization and register.

Registration contacts GitHub REST, rejects private repositories, and pins the resolved **40-character SHA**, repository identity, and claims. Blank ref uses the default branch's current commit. Later branch changes do not update the snapshot. Each repository can be registered once per event. Inspect the resulting immutable SHA.

Optional `GITHUB_API_TOKEN` in ignored `.env` gives app and worker server-only read access to public metadata/commits. No write permission is needed; it does not enable private submissions. Restart both processes after changes. Anonymous access can hit GitHub rate limits. Registration/evaluation need outbound GitHub access even when the app runs locally.

## 6. Gemini credentials and worker

New evaluations require an API key, quota, and model access, obtainable through [Google AI Studio](https://aistudio.google.com/). Dedicated judge access has not been arranged in these materials; see [access status](#judge-access-requirements-and-status). Use your own authorized access or a separately confirmed private arrangement. Requests may be billable; public documentation/video must contain no keys.

Privately edit ignored `.env` (replace the placeholder):

```dotenv
GEMINI_API_KEY=REPLACE_WITH_YOUR_PRIVATE_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
```

The showcase uses **Gemini 3.5 Flash Lite**. The application and `.env.example` retain a `gemini-2.5-flash` fallback, so explicitly override it. Your account needs access to the configured model; there is **no silent model fallback**. Another accessible model may produce different suggestions. Human decisions are not regenerated from AI output.

Restart the app after configuration changes. In a second terminal at the same repository root, using the same intended database/environment:

```bash
nvm use
npm run worker
```

Omit nvm with a direct Node installation. On the submission page, select a rubric version and **Queue AI evaluation**. The worker performs GitHub/Gemini requests and persists status, evidence, provenance, model/prompt versions, and a validated draft. Refresh the submission for progress/results. Ctrl-C stops after active work. The worker does not process payouts.

An alternative for intentionally processing at most one eligible job:

```bash
npm run worker -- --once
```

This takes the next eligible job, not necessarily the currently open submission, and may call providers. Do not use it just to inspect a populated environment's configuration. An offline contract description is available:

```bash
npm run gemini:contract -- --describe
```

Do not use `--live` diagnostics without separate authorization for provider calls. Queued work with no progress usually needs a worker or matching database configuration. For failed runs, inspect the sanitized UI error and check key, model, permissions, quota, and GitHub limits before retrying. HTTP 503 indicates temporary provider unavailability. Eligible failed runs offer **Retry evaluation**, capped at three manual retry children per original run, preserving failed parents and pinned inputs. Worker leases support abandoned-job recovery.

Collection is static and bounded: 16 files, 16 KiB per file, 64 KiB fetched content, 24 KiB excerpts, 20 GitHub requests, and a 25-second collection budget. Source/docs/claims are untrusted data; suspected secrets and unsupported paths are excluded. Screening is not a guarantee that arbitrary public repositories contain no secrets. Submitted code, dependency installations, and tests never execute. Citations do not prove runtime integrations.

## 7. Human review and finalization

Open **Judging** (`/judging`) and **Evidence & review** for a completed draft. Inspect the pinned SHA, rubric/model provenance, line citations, uncertainty, coverage limits, and omissions. Findings remain `UNVERIFIED`; unsupported criteria may be `NOT_EVALUATED` with no score.

For every criterion, accept an available suggestion or select **Set my own score** within its maximum. Changed or AI-unscored criteria require at least 10 characters of reasoning addressing evidence/gaps. Enter an overall reason of at least 10 characters, select **Review final decision**, inspect the preview, confirm the immutable decision, then **Finalize human assessment**. This writes a separate immutable human assessment and preserves the draft. It neither allocates an award nor authorizes a transfer.

## 8. AG Grid and AG Studio

In `/judging`, use AG Grid search, sorting, numeric filters, rubric selection, and AI/criterion column toggles. Teal represents human finals, amber AI suggestions. Missing AI criteria/totals remain blank; incomplete totals are not complete scores. Compare matching rubric versions. Ties do not select a winner.

In **Analytics** (`/analytics`), explore **Review Progress**, **Finalized leaderboard**, **Criterion comparisons**, **Project score comparison** (when data exists), and **Evidence coverage**. These are native embedded AG Studio charts/grids/KPIs. Demo events/submissions are excluded. Selections filter KPIs; the scope notice identifies this, and **Clear all filters** restores full scope across pages. Refresh resets selections. Ordinary viewing does not expose customization. Citation coverage measures collected evidence, not verified functionality.

AG Grid uses Community modules. The app permits AG Studio loopback evaluation without a key, with vendor watermarks/warnings; this does not establish entitlement for public use. Configure a valid **Studio** trial/production entitlement privately as `AG_STUDIO_LICENSE_KEY` and restart Next.js. A Grid Enterprise key does not establish Studio entitlement. Studio receives its key in the browser: do not commit/record it or assume a server variable hides it from browser users. Non-loopback analytics is gated until a key is configured. Verify host entitlement and expiry before hosting.

## 9. Optional, separately authorized PayPal sandbox test

Ordinary judge setup ends above with sending disabled. A genuine integrated **USD 0.10** sandbox payout was already verified against the recipient sandbox account, separately from the four-project showcase. **Neither that payout record nor the four-project showcase is present in a fresh installation.** The recording plan calls for redacted existing evidence; judge access to the original private accounts is not arranged. Viewing a supplied sanitized capture needs no new send. The historical spike is not the app payout path.

For a separately authorized new test, use only authorized sandbox accounts and credentials. Follow [PayPal sandbox accounts](https://developer.paypal.com/tools/sandbox/accounts/) and [Payouts prerequisites](https://developer.paypal.com/docs/payouts/standard/integrate-api/). Confirm a sandbox business sender/app with Payouts access and adequate sandbox balance, plus an actual recipient sandbox account. Verify its **exact** email privately in PayPal Developer sandbox accounts; never infer it from GitHub.

Privately configure the app server:

| Variable | Required value |
| --- | --- |
| `PAYPAL_SANDBOX_CLIENT_ID` | Authorized sender sandbox app client ID |
| `PAYPAL_SANDBOX_CLIENT_SECRET` | Its sandbox client secret |
| `PAYPAL_SANDBOX_RECIPIENT_EMAILS` | Comma-separated verified sandbox emails; exact case-sensitive matches to approved terms |
| `HACKREF_SANDBOX_PAYOUTS_ENABLED` | `true` only for the separately authorized test |

Never use live credentials or `NEXT_PUBLIC_` settings. Restart the app. The adapter fixes the host to `https://api-m.sandbox.paypal.com`; there is no live-money mode.

1. Ensure a non-demo submission has a human-finalized assessment and enough event budget. Allocated/approved awards reserve USD budget; reductions below commitments are rejected.
2. In **Awards** (`/awards`), select the assessment, title, exact dollar amount (for example `0.10`), and verified sandbox recipient. Confirm it and select **Allocate award · review next**. Allocation is immutable; inspect all terms before creation.
3. Review project, assessment, revision, amount, and recipient. Confirm and **Approve these exact award terms**. Approval is permanent and does not send.
4. Only with separate authorization, verify the account again, check both sandbox confirmation boxes, and **Send sandbox payout**. This permanently consumes the award's dispatch attempt; it is not a reusable test button.
5. **Reconcile status** contacts PayPal to check the matching individual item. Acceptance, a batch ID, or batch `SUCCESS` alone is insufficient. Success requires correlated batch/item IDs, sender identifiers, recipient, exact USD amount/currency, and individual-item `SUCCESS`. Independently verify receipt in the recipient sandbox account.
6. For pending/unclaimed/unknown outcomes, investigate the existing transfer. Do not allocate another award or resend to recover a timeout. If prompted for the original batch ID, privately recover it from original sender activity; reconciliation validates correlation before accepting it.
7. Restore the enable flag to `false` and restart afterward. Reconciliation still requires credentials and remains an explicit provider call even with sending disabled. Keep receipts, account emails, API responses, and identifiers private; show redacted captures.

Permanent database records prevent ordinary repeated requests from redispatching. This favors investigation over automatic recovery; it is not a claim of general exactly-once payment-network delivery. No live transfers, automated payout retries, webhook settlement, or refund workflow are implemented.

## 10. Fixtures, validation, and setup blockers

Do **not** seed before creating a real judging event. Optional `npm run db:seed` creates idempotent local-only demo UI fixtures for a provisioned organizer, without passwords, assessments, findings, jobs, or financial records. It refuses a non-demo event and is disabled in production/non-loopback databases. It does not recreate the four-project showcase; demo data is excluded from analytics. Use a separate fresh database to explore fixtures; there is no supported conversion/reset flow in this guide.

```bash
npm run check
npm run db:check
npm run build -- --webpack
```

`check` runs unit tests, TypeScript, and ESLint. `db:check` checks committed migration metadata consistency without connecting to or migrating a database. The production build compiles the app; it does not execute submissions or send payouts. Root checks exclude the isolated spike. Database/HTTP/browser suites require a separately prepared test database and are not ordinary setup prerequisites; never point them at showcase data.

Documentation-pass verification, November 10, 2026 (Node 22.22.0 / npm 10.9.4):

| Check | Outcome |
| --- | --- |
| `npm run check` | Passed: unit tests, TypeScript, ESLint |
| `npm run db:check` | Passed: migration-file consistency |
| `npm run build -- --webpack` | Passed after an approved rerun outside the restricted subprocess sandbox |
| Documentation links and npm script names | Passed |
| Public repository / root license | GitHub reports public visibility and recognizes MIT |
| Source/privacy review | No current private credential/recipient values or provider-token patterns found in tracked source, new docs, or reachable history; no tracked dumps, logs, or generated test artifacts found |

This validates source/build readiness, not a new live-provider test or a fresh-machine migration run. Environment files, `.next`, dependency directories, local receipts/logs, and generated test captures remain outside submitted source. Share reviewed source through Git rather than uploading a working-directory archive; the local build can contain browser-delivered Studio license material. Review/redact any screenshots and video separately.

Resolve before handoff: Docker/port access, an interactive provisioning terminal, outbound GitHub access/rate limits, Gemini key/quota/model access, Studio entitlement for non-loopback use, and authorized sandbox accounts only if testing a new payout. No shared credentials or private database dump are included. The [judge-access table](#judge-access-requirements-and-status) identifies arrangements still outstanding; there is no promised private access delivery. Resolve and confirm any required judge-only access before submission, including testing without charges. Verify the full flow from a fresh machine/browser. Keep confirmed required test access available through the judging period ending December 15, 2026, per the [official rules](https://paypalaihackathon.devpost.com/rules).

## Optional Render architecture — prerequisites only

No deployment is claimed or created. A potential architecture is a Next.js Node web service, a separate long-running Node background worker, and managed PostgreSQL in the same region/private network. The queue already uses PostgreSQL and needs no Redis. See Render's [Next.js hosting](https://render.com/docs/deploy-nextjs-app), [workers](https://render.com/docs/background-workers), and [database connections](https://render.com/docs/postgresql-creating-connecting).

Before a separately authorized deployment:

- Resolve plans/availability, backups, connection limits, and provider budgets through judging. Pin Node 22.22.0 rather than relying on Render defaults ([version selection](https://render.com/docs/node-version)). Retain `tsx` and dependencies required by worker/migration scripts; `tsx` is currently a dev dependency.
- Validate `npm ci` and `npm run build -- --webpack` in the target environment. The app needs server APIs and cannot be a static export.
- Resolve the existing `npm start` loopback binding: Render requires `0.0.0.0` and the assigned `PORT` ([port rules](https://render.com/docs/web-services)). A future start invocation must override the binding and use that port; the current script alone is insufficient. No untested launch configuration is added here.
- Set exact HTTPS `APP_ORIGIN`, a strong session secret, and private database connection. Test proxy/cookie behavior, CSRF, login/logout, and expiry through that host. Do not use local sample credentials.
- Apply committed migrations once as a controlled release task against the intended database with backup/rollback planning, then start compatible app/worker versions. Provision the organizer in a secure interactive session: the CLI rejects non-TTY passwords. Do not put provisioning, seeding, or provider calls in builds.
- Give the worker the same database and approved Gemini/GitHub settings; run `npm run worker` and validate leases/restarts, connectivity, and persistence. It needs no public port. Give the web app only settings it actually uses.
- Confirm Studio hosted entitlement and browser key exposure. Keep PayPal sending disabled and credentials/allowlist absent until separately authorized. Do not expose a public organizer password or anonymous finance controls.
- Verify secret handling, log redaction, access controls, health checks, persistence, and clean-browser reproduction before claiming hosting. Resolve operator costs, provider access, and license expiry first.

These are design prerequisites, not tested production instructions or infrastructure definitions. This documentation work creates no Render resources or deployment files.
