# HackRef

**Evidence-backed AI review, human judging, and explicitly approved PayPal sandbox awards.**

Hackathon organizers must compare unfamiliar repositories, explain their scores, and track prize payments. HackRef connects those steps in one organizer workspace, keeping evidence, human decisions, award approvals, and payment outcomes traceable.

## What works

1. Configure an event, its USD prize budget, and immutable rubric versions.
2. Register public GitHub repositories with explicit claims and ownership attestation. Branches and tags resolve to immutable commit SHAs.
3. Queue durable PostgreSQL jobs. A separate worker collects bounded source excerpts and asks Gemini for structured, cited draft assessments. The submission showcase uses **Gemini 3.5 Flash Lite**.
4. Inspect citations, uncertainty, omissions, and unscored criteria. Humans accept or override suggestions with reasoning and explicitly finalize immutable scores; the AI draft is preserved.
5. Compare projects with **AG Grid Community** and explore native embedded **AG Studio** reports for progress, final scores, criterion comparisons, and evidence coverage.
6. Allocate exact USD awards against the budget, explicitly approve their terms, then separately authorize **PayPal sandbox Payouts**. Reconciliation checks the matching individual item, recipient, currency, amount, and sender identifiers.

A genuine integrated **USD 0.10 sandbox payout was previously verified against the recipient sandbox account**. This is sandbox money. The four-project judging showcase and that separate payment verification are described in the [demo guide](docs/DEMO_GUIDE.md).

## Architecture and integrations

```text
Organizer browser → Next.js 16 / React / TypeScript
                       ├─ authenticated APIs → PostgreSQL / Drizzle
                       ├─ registration → GitHub REST (public repo + pinned SHA)
                       ├─ AG Grid comparison + embedded AG Studio analytics
                       └─ explicit send/reconcile → PayPal sandbox Payouts REST
PostgreSQL job queue → Node worker → GitHub excerpts → Gemini → AI draft
Human review → immutable final → allocation → approval → separate send
```

PostgreSQL transactions and triggers protect immutable inputs, final decisions, budget reservations, approvals, and permanent payout dispatch records. Authentication uses a provisioned organizer, scrypt password hashing, encrypted HttpOnly cookies, database-backed sessions, and origin/CSRF checks. There are no default credentials or public signup.

**AI assists evaluation; it never selects winners or authorizes transfers.** AG Grid/Studio provide comparison and analytics. PayPal is the settlement integration. Render is an optional future hosting choice; no Render deployment is claimed.

## Run locally

Requirements: Node **22.22.0** (supported range `>=22.22.0 <23`), npm **10.9.4**, Docker Engine with Compose, and an interactive terminal. On a fresh checkout, at the repository root:

```bash
nvm install
nvm use
npm ci
cp -n .env.example .env
npm run db:up
npm run db:migrate
npm run auth:configure
npm run organizer:setup
npm run dev
```

With a direct Node installation, omit the two nvm commands. `npm run organizer:setup` is a **one-time secure administrator bootstrap in an interactive terminal**. Afterward, use normal browser login at **http://localhost:3000/login**, matching `APP_ORIGIN` exactly. No web signup exists or is required. Review the [judge Quick Start](docs/JUDGE_SETUP.md#quick-start) before running database setup against an existing installation.

For evaluations, privately configure `GEMINI_API_KEY` and **`GEMINI_MODEL=gemini-3.5-flash-lite`**, then run `npm run worker` in a second terminal at the same repository root. Registration/evaluation require network access; Gemini calls may incur charges. The code's fallback remains `gemini-2.5-flash`, so set the showcase model explicitly. PayPal sending stays disabled by default and is a separate, optional, authorized test.

The [judge setup](docs/JUDGE_SETUP.md) covers authentication, event/rubric creation, registration, finalization, Studio licensing, PayPal safeguards, troubleshooting, and optional Render prerequisites. **Fresh installations contain neither the four-project judging showcase nor the prior PayPal payout record.** The optional local seed is an offline UI fixture and does not recreate them. Local login and event/rubric setup need no Gemini/PayPal credentials; generating AI drafts and testing payouts do. Dedicated judge Gemini access and PayPal test accounts/credentials remain unarranged in these materials; see [judge-access requirements and status](docs/JUDGE_SETUP.md#judge-access-requirements-and-status).

## Boundaries

- **Submitted repositories and their tests are never executed.** Runtime verification is not implemented. Static evidence cannot prove working software, passing tests, or successful integrations.
- Source collection is bounded: at most 16 files, 16 KiB per file, 64 KiB fetched content and 24 KiB excerpts, with request/time limits and exclusions. Missing evidence remains unknown; AI findings remain `UNVERIFIED`, and unsupported criteria may be `NOT_EVALUATED`.
- The MVP provisions one organizer and one event per organizer. No participant portal, multi-judge consensus, appeals/correction workflow, or automatic winner selection is implemented.
- Awards and approvals are immutable. USD sandbox payouts only; no live-money mode, automatic redispatch, webhook settlement, or refund workflow. A timeout or batch success is not proof of recipient payment.
- Demo fixtures are excluded from analytics. Compare matching rubric versions; equal scores remain ties and missing scores remain blank. Studio selections filter KPIs; **Clear all filters** restores full scope.
- Gemini/GitHub availability, model access, and third-party entitlements remain external dependencies. Studio local evaluation may show vendor watermarks; hosted use requires appropriate Studio entitlement.

## Judge materials and validation

- [Complete clean-room setup](docs/JUDGE_SETUP.md)
- [Under-three-minute demo script and shot list](docs/DEMO_GUIDE.md)
- [Ready-to-copy Devpost submission](docs/DEVPOST_SUBMISSION.md)

**Public demo video: [TODO: paste final public YouTube URL].**

```bash
npm run check
npm run db:check
npm run build -- --webpack
```

These run unit tests, TypeScript, ESLint, migration-file consistency validation, and the Webpack production build. They do not apply migrations or send payments. `db:check` does not validate a running database. Production login requires HTTPS; use `npm run dev` for loopback HTTP reproduction.

A reproducible local working build satisfies the functional-demo requirement; hosting is optional under the [official submission rules](https://paypalaihackathon.devpost.com/rules). No deployed HackRef URL is claimed. Provide a public YouTube demo under three minutes, the final source revision, and private test-access arrangements in Devpost. Deadline: **November 12, 2026, 12:00 PM PST / 11:00 PM Nairobi (20:00 UTC)**.

## License

HackRef source and documentation are public under the root **[MIT License](LICENSE)**, copyright 2026 Cassy Omondi. Third-party dependencies/services retain their own licenses and terms; HackRef's license does not grant AG Studio entitlement. Historical implementation reports remain in `docs/`; the three judge documents above describe the submission workflow.
