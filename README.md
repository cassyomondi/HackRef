# HackRef

**Under development.** HackRef is being built for the PayPal AI Hackathon 2026, with a submission deadline of November 12, 2026. The full application is not implemented. An isolated [PayPal Payouts sandbox spike](spikes/paypal-payouts/README.md) is available; real sandbox access has not yet been verified.

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

See [MVP scope](docs/MVP_SCOPE.md) for boundaries, evidence statuses, and non-goals. Setup and demo instructions will be added when implementation exists.

## License

[MIT](LICENSE), copyright 2026 Cassy Omondi. Third-party services and dependencies retain their own licenses and terms.
