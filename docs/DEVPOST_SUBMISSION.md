# HackRef — Devpost submission copy

Copy the field text below into Devpost. Add the public YouTube URL and final published source revision before submitting. No hosted application URL is claimed.

## Project name

HackRef

## Tagline

Evidence-backed AI review, human judging, and explicitly approved PayPal sandbox awards.

## Project description

HackRef helps hackathon organizers move from public GitHub submissions to explainable human judgments and traceable prize payments. It pins repositories to immutable commits, uses Gemini 3.5 Flash Lite to produce cited static draft assessments, and lets humans explicitly finalize scores. AG Grid comparison and embedded AG Studio analytics make evidence and decisions easier to explore. Exact USD awards require human allocation and approval, followed by a separate authorization to send through PayPal sandbox Payouts. The four-project judging showcase demonstrates review and analytics; a separate, previously verified integrated USD 0.10 sandbox payout demonstrates settlement and recipient-account confirmation.

## Inspiration / problem

Hackathon judging combines disconnected tasks: reading unfamiliar repositories, comparing projects against a rubric, documenting decisions, and confirming approved prizes reached their intended recipients. An AI score alone cannot establish that a project works or authorize a payment. Organizers need a workflow that preserves evidence, identifies uncertainty, and keeps people responsible for consequential decisions.

## What it does / solution

HackRef brings that workflow into one organizer workspace. Registration checks public GitHub repositories and pins commits and explicit team claims. Published rubrics are immutable snapshots. A durable PostgreSQL worker collects bounded source excerpts and requests structured Gemini assessments with line citations, uncertainty, and evidence limitations.

Humans review every criterion, accept or override suggestions with reasoning, and explicitly finalize an immutable assessment while preserving the AI draft. AG Grid supports project search, filtering, sorting, and rubric-specific comparison. Native embedded AG Studio reports show review progress, finalized scores, criterion comparisons, project score comparisons, and citation coverage, with visible filter scope and reset controls.

Organizers allocate exact USD awards against the event budget and explicitly approve the project, assessment, revision, amount, and recipient. Sending requires a separate sandbox authorization and an operator-verified recipient allowlist. Reconciliation checks the matching individual PayPal payout item, not just a batch response. AI assessments and analytics never authorize transfers or automatically select winners.

## Innovation

The core idea is traceability across evaluation and settlement: immutable source/rubric inputs, cited AI advice, preserved human reasoning, exact-term award approval, and correlated payout evidence. Uncertainty stays visible. Unsupported AI criteria remain unscored; tied human scores remain ties. Permanent dispatch records prevent ordinary repeated requests from sending an award again; ambiguous outcomes require investigation rather than automatic redispatch.

## How we built it / technology

- Next.js 16, React, TypeScript, and Tailwind CSS for the organizer workspace and server APIs.
- PostgreSQL 16 and Drizzle ORM/migrations for persistence, transactional budget safeguards, immutable records, and a durable worker queue.
- GitHub REST for public repository identity, commit resolution, and bounded static source collection.
- Google's `@google/genai` SDK with Gemini 3.5 Flash Lite for the showcase's structured, evidence-backed AI drafts.
- AG Grid Community for judging comparison; `ag-studio` and `ag-studio-react` for native embedded analytics.
- PayPal sandbox OAuth and Payouts REST APIs for separately authorized USD sends and item-level reconciliation.
- scrypt password hashing, iron-session cookies, database-backed sessions, and origin/CSRF checks for authentication.

## AI integration

The worker sends the selected rubric snapshot and collected excerpts to Gemini and validates structured output against application rules. Scored criteria/findings require valid citations into collected lines at the pinned commit. Reviews retain model/prompt provenance, uncertainty, and omissions. Findings remain `UNVERIFIED`; unsupported coverage can yield `NOT_EVALUATED` with no score. The model cannot execute code, finalize judging, approve awards, or initiate payouts.

Gemini 3.5 Flash Lite is explicitly configured for the showcase. The code retains a `gemini-2.5-flash` fallback; setup explains the override and account-access requirements. There is no silent fallback between models.

## PayPal integration

PayPal Payouts is the prototype's prize settlement path. The adapter uses the sandbox API exclusively. Allocation reserves exact USD cents within the budget; immutable approvals capture exact terms. Sending is disabled by default and requires server-side sandbox credentials, a verified recipient allowlist, and separate human confirmation. Reconciliation correlates batch/item IDs, recipient, sender identifiers, currency, amount, and individual-item success.

A genuine integrated **USD 0.10 sandbox payout** was verified against the recipient sandbox account. This is separate from the four-project judging showcase, not live-money settlement or an automatically chosen winning award. Public demo evidence is redacted; credentials and account addresses are excluded from the repository.

## AG Grid / AG Studio integration

AG Grid Community powers the comparison table: search, numeric filters, sorting, rubric selection, optional AI/criterion columns, pinned commit details, and evidence drill-down. Human finals and AI suggestions have separate visual treatment.

Embedded AG Studio uses organizer-scoped records for native KPIs/charts/grids across review progress, finalized leaderboard, criterion comparisons, project score comparison, and evidence coverage. Selecting records filters KPIs; the host shows scope and offers **Clear all filters**. Demo records are excluded. Missing values stay blank, ties stay ties, and percentage normalization does not make different rubrics equivalent. Hosted Studio use requires appropriate entitlement; no Studio Agent Framework integration is claimed.

## Demonstrated results

The existing HackRef Evaluation Pilot contains Airline Booking CLI, FundFlow, HackRef, and Project Idea Vault, with human finals of 31, 33, 31, and 33 against Combined Rubric v5, maximum 40. Full-scope highest finalized percentage is 82.5%; ties do not decide a winner. The recording plan separately shows the previously verified ten-cent sandbox payout and redacted recipient-account confirmation; this is not a payout to a showcase winner. **Fresh installations contain neither the four-project judging showcase nor the previous payout record.** No private database dump is distributed.

## Challenges and lessons

Static evidence is incomplete, and structured AI output still needs citation/score validation. Human review must address gaps without silently converting missing evidence to zero. Payment APIs introduce another uncertainty: a timeout or successful batch response does not prove receipt. HackRef addresses these through explicit evidence limits, immutable human decisions, separate payment authorization, and correlated item-level reconciliation.

## Limitations / what's next

This organizer-focused prototype provisions one organizer and one event per organizer. Submitted repositories/tests are **never executed**; runtime verification is not implemented. Collection is bounded, so AI cannot establish repository completeness or working integrations. External Gemini/GitHub availability and model access remain dependencies.

Payments are USD sandbox only. There is no live-money mode, automatic payout retry, webhook settlement, refund workflow, or award/approval correction workflow. No participant portal, multi-judge consensus, or automatic winner selection is implemented. Future work could add isolated runtime verification, richer judging roles, and explicit correction/recovery workflows, each requiring additional implementation and validation.

## Links and testing instructions

- Public source: https://github.com/cassyomondi/HackRef
- Setup in submitted source: [Judge setup](https://github.com/cassyomondi/HackRef/blob/docs/hackathon-submission/docs/JUDGE_SETUP.md).
- Recording plan: [Demo guide](https://github.com/cassyomondi/HackRef/blob/docs/hackathon-submission/docs/DEMO_GUIDE.md).
- Public license: [root MIT LICENSE](https://github.com/cassyomondi/HackRef/blob/main/LICENSE).
- **Public demo video: [TODO: paste final public YouTube URL].**
- Hosted application: **none claimed; reproduce locally using the setup guide**.

The absolute documentation URLs above target `docs/hackathon-submission` and become usable only after that branch and these files are published. Before copying into Devpost, verify them signed out and preferably replace the branch ref with the final published commit SHA. A local branch is not judge-accessible. Do not invent a deployed URL.

Judges can run the local app on Node 22 with Docker/PostgreSQL. `npm run organizer:setup` is a one-time secure administrator bootstrap in an interactive terminal, followed by normal browser login at `/login`; no web signup exists or is required. Login and event/rubric creation need no Gemini/PayPal credentials. GitHub registration requires outbound access; AI drafts and subsequent human finalization require configured Gemini access and the worker. New sandbox payments require authorized sender/recipient accounts and separate approval and send authorization.

**Judge-access status:** dedicated Gemini key/quota/model access, PayPal sandbox accounts/credentials, and a hosted judge login/service remain unarranged in these materials. Existing private developer access is not shared judge access. No credentials, accounts, or funded services are promised. Judges need their own authorized provider access or a separately confirmed private arrangement; resolving charge-free access for required integration testing remains a manual submission task. Local Studio evaluation is described in setup; hosted Studio use needs appropriate entitlement.

The [official rules](https://paypalaihackathon.devpost.com/rules) accept the local-build route; Render hosting is optional. Never put keys, passwords, recipient emails, or raw receipts in public fields. Setup includes optional Render prerequisites only; no deployment is claimed.

## Maintainer handoff — do not paste as project copy

Complete a fresh-machine run and private judge-access arrangement. GitHub reports public visibility and recognizes the root MIT license as of November 10, 2026; recheck after publishing. Review final source/video/screenshots for sensitive data. Submit reviewed source, not a working-directory archive containing ignored environment/build/log/test artifacts. Publish reviewed source/docs separately when authorized, record/upload the public video, replace placeholders with final links, complete required Devpost/team/tool fields, and verify submission receipt. Do not select Render as a used integration unless subsequently implemented and verified. If the project predates the hackathon, describe actual significant changes during the submission period without inventing a timeline.

Submit before **November 12, 2026, 12:00 PM PST / 11:00 PM Nairobi (20:00 UTC)**. Keep working judge access through the December 15, 2026 judging end and recheck the [official rules](https://paypalaihackathon.devpost.com/rules) before handoff.
