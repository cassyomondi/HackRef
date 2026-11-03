# HackRef

**PASS 1 foundation.** HackRef is being built for the PayPal AI Hackathon 2026, with a submission deadline of November 12, 2026. This repository contains a Next.js organizer workspace and an initial PostgreSQL schema. The UI is a clearly labeled placeholder preview; it does not load database records or run integrations. The isolated [PayPal Payouts sandbox spike](spikes/paypal-payouts/README.md) was tested successfully and merged before this pass. It remains separate from the application.

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

## Local preview

Run these commands at the repository root in WSL Ubuntu, using Node **22.22.0** and npm **10.9.4**:

```bash
nvm use
npm ci
npm run dev
```

Open **http://localhost:3000**. If you do not use nvm, install Node 22.22.0 first and omit `nvm use`. The shell needs no environment file or database. Overview, Submissions, Judging, Analytics and Awards are navigable; editing and integrations are deliberately unavailable.

## Local PostgreSQL

Requires Docker Engine with the Compose plugin, accessible to your WSL user. PostgreSQL is pinned to `16.15-alpine`, persists in a named volume and binds only to `127.0.0.1:5433` by default.

```bash
# Run once; do not overwrite an existing .env.
cp -n .env.example .env
npm run db:up
npm run db:migrate
```

The sample password is for local development only. If port 5433 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env`. `npm run db:down` stops the database without removing its volume. The application shell remains a preview after migration; there are no data mutation endpoints or seed records.

```bash
npm test
npm run typecheck
npm run lint
npm run db:check
npm run build
npm start
```

`npm start` serves the production build at **http://localhost:3000**. Stop an existing development server first. Root installation, builds and tests exclude `spikes/paypal-payouts/`; it retains its own dependencies and lockfile. No root command dispatches payouts or accesses PayPal.

See [development instructions](docs/DEVELOPMENT.md) for database tests, migrations, environment handling and WSL requirements, and [database design](docs/DATABASE.md) for constraints and deferred safeguards. Authentication, Gemini, AG Grid / AG Studio, evaluation workers and application PayPal integration are outside PASS 1.

## License

[MIT](LICENSE), copyright 2026 Cassy Omondi. Third-party services and dependencies retain their own licenses and terms.
