# Development: PASS 1

> Historical PASS 1 notes, preserved for reference. PASS 2 now requires organizer authentication and a database. Use [PASS 2 operations and report](PASS2_REPORT.md) for current setup, migrations, tests, seed data and worker commands. PostgreSQL 16.15 in the existing Docker container was reachable and used for PASS 2 verification.

## Runtime and project layout

Use WSL Ubuntu, Node 22.22.0 (`.nvmrc`) and npm 10.9.4. Keep the checkout on the Linux filesystem for good file watching. Open it with VS Code's WSL extension. Run all commands in the root directory. Dependencies are pinned in `package.json`; use `npm ci` for a reproducible installation from `package-lock.json`.

- `src/app/`: Next.js App Router pages, layout, global Tailwind CSS and application icon.
- `src/components/`: responsive shell, navigation and shared placeholder components.
- `src/db/schema.ts`: initial relational schema; `src/db/client.ts`: lazy, server-only PostgreSQL pool.
- `src/lib/env*.ts`: environment validation and server-only boundary.
- `drizzle/`: generated SQL migrations, snapshots and migration journal; keep all of these in version control.
- `scripts/migrate.ts`: migration runner with sanitized errors and connection cleanup.
- `tests/unit/`, `tests/database/`: Node test runner tests through `tsx`.
- `spikes/paypal-payouts/`: preserved isolated experiment, excluded from root TypeScript, lint and test commands. Do not move its credentials into the root application.

The app uses system fonts and local SVG icons. Builds do not fetch remote fonts, query the database or call integration APIs. Navigation is functional; all business data is explicitly a placeholder. Development and production scripts bind to loopback because authentication is not implemented. Next.js automatic agent-file generation is disabled so starting development does not rewrite repository guidance.

## Environment

The shell works with no environment variables. For database commands, copy `.env.example` to `.env` once using `cp -n .env.example .env`; review the existing file if it already exists. Never copy the spike's environment file. `.env` and environment variants are ignored; only `.env.example` is tracked.

Next.js and CLI commands use the same `@next/env` loading convention (`.env.local` can override `.env`). Compose reads `.env`, not `.env.local`; use `.env` for the documented local setup. Already exported variables take precedence. `DATABASE_URL` must use `postgres:` or `postgresql:` with a database name. Server database imports are guarded by `server-only`. Validation happens lazily at database use rather than at build time, and errors omit credentials. Never prefix secrets with `NEXT_PUBLIC_`. There are no Gemini, AG Studio, authentication or PayPal credentials in this pass.

Compose's sample password is a local development value. If changed after the volume is initialized, PostgreSQL does not automatically change its existing role password. Update it intentionally in PostgreSQL and update the URL, rather than removing a volume with data you need.

## Database lifecycle and migrations

Install a working Docker Engine / Docker Desktop WSL integration and Compose plugin first. `docker info` and `docker compose version` must work from your WSL account. Do not change socket permissions to make Docker world writable. This checkout's validation environment had Compose installed but no permission to connect to the Docker socket; container startup was therefore not tested. SQL migrations and constraints were tested using the locally installed PostgreSQL 16 server instead. The official PostgreSQL image lists the pinned [16.15 Alpine tag](https://hub.docker.com/_/postgres).

```bash
npm run db:up
npm run db:migrate
npm run db:logs
# Stop log streaming with Ctrl+C.
npm run db:down
```

The named volume survives `db:down`; avoid `down -v` unless you intentionally want to destroy local database data. No database reset script is supplied.

When changing the schema:

```bash
npm run db:generate -- --name=describe_change
# Review the generated SQL before applying it.
npm run db:check
npm run db:migrate
```

Generation and migration checks need no connection. Migration application requires `DATABASE_URL` and executes only checked-in SQL, not participant code. Applied migrations are recorded in Drizzle's journal table, so rerunning `db:migrate` is safe. Never edit already-applied migrations. `npm run db:studio` opens a local database editing tool; it is not AG Studio and is not part of the UI. There is intentionally no `db:push` shortcut or automatic migration during build/start.

This project uses the documented [Drizzle PostgreSQL migration workflow](https://orm.drizzle.team/docs/get-started/postgresql-new) and the [Next.js ESLint CLI setup](https://nextjs.org/docs/app/getting-started/installation).

## Checks and integration tests

```bash
npm test                 # Environment validation; no database or network required
npm run typecheck
npm run lint
npm run db:check         # Migration snapshot consistency
npm run build           # Production compilation and prerendering
```

For PostgreSQL invariant tests, create a dedicated local test database. With the documented Compose defaults:

```bash
docker compose exec postgres createdb -U hackref hackref_test
# Run createdb only once; an existing database is not overwritten.
TEST_DATABASE_URL=postgresql://hackref:hackref_local_only@127.0.0.1:5433/hackref_test npm run test:db
```

If you changed the local credentials, adjust the test URL accordingly or set `TEST_DATABASE_URL` in your ignored `.env`. Do not point tests at a production database. Tests fail with a clear instruction when the URL is absent; they do not silently skip. The database account needs permission to create a schema. The suite applies the checked-in migrations into a uniquely named schema inside a transaction, tests actual PostgreSQL constraint failures with savepoints, then rolls back all fixtures and schema changes. It makes no external API requests. No tests execute submitted repositories.

Critical checks cover event/rubric consistency, pinned commits, evidence provenance, email uniqueness, award amounts, finalized assessments, exact approval terms, approval-required sandbox payout records and duplicate payout intents. The production migration runner is separately checked by applying migrations twice to an empty local database.

## Scope and remaining verification

PASS 1 supplies layout, schema and development tooling. There are no authentication handlers, evaluation workers, AI calls, AG dependencies, repository execution/fetching or payout endpoints. Database entities describe future workflows, not implemented services. Do not expose this unauthenticated preview as a production organizer application.

Docker image startup and a visual browser check require a working local Docker/browser environment. HTTP route checks and production builds can verify rendering, but do not substitute for visual checks at mobile and desktop widths. Review the UI locally before the next pass. See `FOUNDATION_REPORT.md` for this implementation's exact validation results.

## Dependency maintenance notes

ESLint is pinned to 9.39.5 because the current `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y` versions used by `eslint-config-next` declare ESLint 9 peer support but not ESLint 10. npm marks ESLint 9 as out of support. Upgrading to ESLint 10 produced peer override warnings, so the foundation keeps a compatible pinned set rather than suppressing those warnings. Revisit when the plugins declare compatible support.

The final install reports 20 moderate advisories in development-tool dependency paths: older `minimatch` in the ESLint ecosystem and older `esbuild` under Drizzle Kit's deprecated `@esbuild-kit` loader. The audit reports no production advisories (`npm audit --omit=dev`). These remain documented upstream tooling issues; no forced downgrades, prerelease Drizzle versions or incompatible transitive overrides were applied. Check them again before deployment and do not expose development tooling servers publicly.
