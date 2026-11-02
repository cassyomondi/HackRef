# HackRef MVP scope

Status: planned and under development. Target submission: November 12, 2026.

## MVP

Support one organizer-led hackathon with 3–5 representative public GitHub submissions. Trace each award from a pinned repository commit and supporting evidence through rubric-based assessment, human judging, explicit approval, and a PayPal sandbox payout record.

- Collect bounded source snapshots, claims, and supporting evidence with provenance.
- Produce structured AI findings and suggested rubric scores with evidence references and coverage limits.
- Let an organizer review findings, explain overrides, and finalize scores.
- Use AG Grid for judging and comparison; use AG Studio for interactive assessment and prize-distribution analytics.
- Allocate USD prizes within a configured budget, approve exact award details, and initiate sandbox payouts separately.
- Persist approvals and payout identifiers, prevent duplicate payouts, and reconcile actual item-level statuses.
- Include automated checks for critical business and security rules, reproducible setup/demo instructions, and genuine AI and PayPal sandbox workflows in the final demo.

## Architecture decisions

- **Next.js / TypeScript:** one application for UI and server APIs.
- **PostgreSQL / Drizzle:** persistent evidence, versioned assessments, approvals, payout records, migrations, and transactional constraints.
- **Durable evaluation worker:** PostgreSQL-backed jobs with bounded retries and restart recovery; no request-lifetime background promises.
- **GitHub static analysis:** fetch bounded text at immutable commit SHAs without cloning, installing, building, or executing submissions.
- **Optional isolated runtime verification:** deferred from the required MVP. Any future execution must use a separately provisioned, disposable environment with resource and network limits, no developer credentials, and recorded provenance. A local container alone is not sufficient authorization to execute unknown code.
- **AG Grid / AG Studio:** interactive judging and analytics backed by application data; confirm compatible versions and applicable licenses.
- **Structured AI assessments:** validate schema, scores, and evidence references server-side; preserve model, prompt, rubric, and evidence versions. AI outputs are recommendations.
- **PayPal Payouts sandbox:** server-side credentials, durable payout intents, stable sender IDs, and reconciliation. Integration access must be proven with an actual sandbox payout.

## Evidence statuses

| Status | Meaning |
| --- | --- |
| `VERIFIED` | The specific statement has evidence appropriate to its scope, accepted by a reviewer or established by a deterministic verifier. |
| `UNVERIFIED` | Available evidence is insufficient to establish the statement. |
| `FAILED` | A defined check ran and produced a negative result. |
| `NOT_EVALUATED` | The check was skipped, unsupported, or outside the evaluated scope. |

Record the evidence method separately: static analysis, external CI metadata, organizer attestation, or trusted API observation. A declared dependency does not prove a working integration. Missing evidence is not automatically a failed check. AI claims alone do not establish verification.

## Security boundaries

- Never execute arbitrary submissions on the developer machine or application host. Do not trigger submitted workflows.
- Treat repository content and supplied evidence as untrusted data, including prompt-injection attempts. Give the evaluator no financial tools or credentials.
- Restrict automated fetching to approved GitHub API resources; cap files, bytes, requests, runtime, and AI tokens. Report incomplete collection.
- Escape rendered content, validate inputs and model outputs, and protect organizer mutations with authentication and request-forgery defenses.
- Keep secrets server-side and outside Git; redact logs and minimize stored personal data.
- Bind approval to the exact recipient, amount, currency, award revision, and finalized assessment. Changes invalidate approval.
- Require explicit organizer approval and a separate payout action. Enforce budget and duplicate protections in the database, not only the UI.
- Persist payout intent before dispatch. An ambiguous timeout requires reconciliation, not a new payout identifier. PayPal's duplicate window does not replace permanent local safeguards.
- Show paid only for an actual PayPal item-level success; retain pending, failed, unclaimed, returned, and unknown outcomes accurately. Never fabricate financial success.

## Non-goals

No full hackathon hosting, public registration, team management, multi-tenancy, autonomous financial authorization, live-money transfers, multiple currencies, team prize splitting, replacement payout workflows, plagiarism detection, vector database, or multi-provider AI orchestration.

Arbitrary runtime execution, browser automation against unknown apps, video analysis, webhooks, and dashboard chat are outside the required MVP. Hosting is optional if complete local run instructions provide a functional demo. Commercial integrations remain subject to their own access and licensing requirements.
