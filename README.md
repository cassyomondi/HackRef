# HackRef

**AI evaluation engine.** The Next.js organizer workspace supports secure login, one event, immutable rubric versions, public GitHub submissions and durable evaluation jobs. New jobs collect bounded source excerpts at the stored commit, request a structured Gemini review, validate citations and persist a DRAFT assessment. Submission details and Judging show real evidence, provisional scores and limitations for human review. Historical PASS 2 jobs still validate inputs only. Analytics, awards and overview metrics remain previews. The isolated [PayPal Payouts sandbox spike](spikes/paypal-payouts/README.md) remains separate and unchanged. Live Gemini account/model access has not been verified; automated integration tests use mocked providers.

HackRef is an AI-assisted hackathon evaluation and approved prize-settlement platform. It connects software submission evidence to judging criteria, explainable assessments, human decisions, and PayPal payout records.

## Planned workflow

1. Register a public GitHub submission and pin its commit.
2. Collect source and supporting evidence without executing the repository.
3. Produce structured AI assessments with evidence references and explicit verification limits.
4. Review findings and compare submissions using AG Grid and AG Studio.
5. Finalize judging, allocate prizes, and explicitly approve each award.
6. Initiate PayPal Payouts sandbox transfers and reconcile their actual item-level results.

AI recommendations never authorize transfers. Every payout must remain traceable to its evidence, assessment, and organizer approval.

## Architecture decisions

- Next.js and TypeScript for the web application and server APIs.
- PostgreSQL and Drizzle for persistence, migrations, and transactional safeguards.
- A durable evaluation worker backed by PostgreSQL.
- GitHub static analysis as the default; optional runtime verification only in a separate isolated environment.
- AG Grid for interactive judging and AG Studio for comparison and prize analytics.
- Structured AI assessments validated by the application.
- PayPal Payouts sandbox for approved prize settlement; no live-money transfers in the MVP.

See [MVP scope](docs/MVP_SCOPE.md) for boundaries, evidence statuses, and non-goals.

## Local setup

Run these commands at the repository root in WSL Ubuntu, using Node **22.22.0** and npm **10.9.4**:

```bash
nvm use
npm ci
cp -n .env.example .env
npm run db:up
npm run db:migrate
npm run auth:configure
npm run organizer:setup
# Optional, before creating a real event:
npm run db:seed
npm run dev
```

Open **http://localhost:3000/login** using the exact origin in `APP_ORIGIN`. `auth:configure` generates a random cookie secret in ignored `.env` without printing it. `organizer:setup` prompts for an email, name and hidden password; there are no default credentials or public registration. If you do not use nvm, install Node 22.22.0 first and omit `nvm use`. In another terminal, run `npm run worker` to process evaluations. See [PASS 2 operations and report](docs/PASS2_REPORT.md) for password rotation, seed behavior, endpoints, worker recovery, verification and limitations.

Optional: set **`GITHUB_API_TOKEN`** in your ignored `.env` or server environment, then restart both the app and worker. Both use this server-only token for GitHub REST requests; leaving it unset preserves anonymous access. See [GitHub API authentication and rate limits](docs/PASS2_REPORT.md#github-api-authentication-and-rate-limits). No write permissions are needed, and repositories must still be public.

For AI evaluations, supply **`GEMINI_API_KEY`** to the worker through ignored server environment configuration. **`GEMINI_MODEL`** defaults to `gemini-2.5-flash`; choose an accessible model for your account. Restart the worker after configuration changes. Open a submission, select its rubric version and choose **Queue AI evaluation**. Run `npm run worker` and review the resulting draft in the submission or Judging page. See the [evaluation engine report](docs/EVALUATION_ENGINE_REPORT.md) for exact sample commands, evidence budgets, verification and limitations. Source code and submitted tests are never executed; AI assertions cannot verify working integrations.

Failed AI evaluations now offer **Retry evaluation**. Each original evaluation allows up to three manual retry runs; each preserves its failed parent and uses the same pinned submission/rubric. Repeating a retry request returns its existing child. See the [retry and provider-error report](docs/EVALUATION_RETRY_REPORT.md) for eligibility, concurrency guarantees and exact commands. HTTP 503 is treated as temporary Gemini unavailability, separately from authentication, permission and missing-model failures.

Before spending a retry on a provider-contract failure, inspect the [Gemini contract investigation](docs/GEMINI_CONTRACT_REPORT.md). `npm run gemini:contract -- --describe` is offline. The explicit `npm run gemini:contract -- --live` makes one potentially billable request with the production schema/settings and synthetic evidence; it never accesses jobs, databases or real repositories. A passing contract test validates the generated output through the full server checks.

For serving failures, use the [controlled A/B/C diagnostic](docs/GEMINI_DIAGNOSTIC_REPORT.md). Offline descriptions now read the worker's environment configuration and show the selected model. `--compare --describe` previews all three requests without calling Gemini; `--compare --live` explicitly opts into at most three bounded calls. A single-case diagnostic and diagnostic-only token-budget control are also available. HTTP 503 remains a serving-unavailability result.

## Local PostgreSQL

Requires Docker Engine with the Compose plugin, accessible to your WSL user. PostgreSQL is pinned to `16.15-alpine`, persists in a named volume and binds only to `127.0.0.1:5433` by default.

```bash
# Run once; do not overwrite an existing .env.
cp -n .env.example .env
npm run db:up
npm run db:migrate
```

The sample database password is for local development only. If port 5433 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env`. `npm run db:down` stops the database without removing its volume. No reset command is provided. Demo seed data is optional, reproducible and clearly labeled; it never creates an organizer password.

```bash
npm test
npm run db:test:setup
npm run test:db
npm run typecheck
npm run lint
npm run db:check
npm run build
npm run test:http
```

Production authentication requires an HTTPS `APP_ORIGIN`; serve `npm start` behind a TLS reverse proxy. Local functional verification uses `npm run dev` and loopback HTTP. If Turbopack cannot bind its internal port in a restricted environment, use `npm run build -- --webpack`; the supported Webpack build and production HTTP suite were verified for PASS 2. Root installation, builds and tests exclude `spikes/paypal-payouts/`; it retains its own dependencies and lockfile. No root command dispatches payouts or accesses PayPal.

See the [evaluation engine report](docs/EVALUATION_ENGINE_REPORT.md) for current evaluation behavior and [PASS 2 operations and report](docs/PASS2_REPORT.md) for the retained organizer foundation. The [foundation development notes](docs/DEVELOPMENT.md), [database design](docs/DATABASE.md), and [PASS 1 report](docs/FOUNDATION_REPORT.md) are preserved as history. AG Grid / AG Studio, final judging decisions, awards and application PayPal execution remain deferred.

## License

[MIT](LICENSE), copyright 2026 Cassy Omondi. Third-party services and dependencies retain their own licenses and terms.
