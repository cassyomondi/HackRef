# PayPal Payouts sandbox feasibility spike

Isolated Node.js 22 / TypeScript CLI. No application scaffold, runtime dependencies, SDK, or live-money mode. Real sandbox access has **not yet been verified**.

## Setup

From this directory:

```bash
npm ci
cp .env.example .env
npm test
```

Edit `.env` locally. Use a PayPal Developer sandbox Merchant REST app associated with a sandbox business sender, plus an existing sandbox personal recipient account. The sender needs sandbox balance for the amount and fees. Obtain the recipient email from that sandbox account; the CLI cannot establish that an arbitrary email belongs to a sandbox account. Never use live credentials or a real recipient.

Set the client ID, client secret, recipient, amount, and both sender IDs. Choose the IDs once and preserve them; the CLI never generates replacement IDs. Amounts are restricted to USD 0.01–5.00. Existing shell environment variables take precedence over `.env`. No credentials belong in chat, logs, screenshots, or Git.

Installation, compilation, and tests never submit payouts. Tests use injected mock HTTP responses and temporary local files, and require no credentials. There are no install or startup hooks.

## Read-only verification

```bash
npm run verify
```

This performs OAuth client-credentials authentication against the fixed sandbox host. It creates an access token but does not create or modify a payout. OAuth success alone does not establish Payouts permissions, sufficient balance, or recipient payment.

If `PAYPAL_PAYOUT_BATCH_ID` is set, it retrieves that batch's status and individual item statuses. Otherwise it uses the batch ID in the local dispatch receipt when available. Set `PAYPAL_PAYOUT_ITEM_ID` to query an individual item directly. Output contains only identifiers and normalized statuses, never full provider responses or recipient details.

## Explicit sandbox payout execution

**Run only after the organizer explicitly authorizes this sandbox transfer.** This command initiates a financial workflow in PayPal's sandbox; it is separate from verification:

```bash
npm run execute -- --confirm-sandbox-payout
```

It sends one payout item, once, using the configured sender IDs. A fixed package-local `.local/dispatch.json` guard is exclusively created and flushed before dispatch. Repeated or concurrent invocations are blocked even if environment IDs change. The guard stores no credentials or recipient email. It is ignored by Git and must be retained across restarts.

An accepted response reports `recipientPaid: false`: acceptance is not recipient payment. Run `npm run verify` afterward. Only an individual item's `SUCCESS` reports observed recipient payment. Batch `SUCCESS`, missing items, `PENDING`, `UNCLAIMED`, `FAILED`, `ONHOLD`, `BLOCKED`, `RETURNED`, `REFUNDED`, and `REVERSED` do not. Results are observations at query time, not guarantees against later reversal.

## Errors and reconciliation

- **REJECTED:** PayPal returned a definitive API rejection. Check sandbox configuration, permissions, and balance privately. No automatic retry occurs.
- **DUPLICATE:** PayPal recognized the sender batch ID. A safe original batch ID is saved if supplied in a sandbox API link. Verify that batch; never submit with new IDs to bypass the duplicate.
- **UNKNOWN:** A timeout, server error, malformed response, or missing batch ID leaves payment outcome uncertain. Do not resend or rotate IDs. Inspect sender sandbox activity and recover the PayPal batch ID, then set `PAYPAL_PAYOUT_BATCH_ID` and run verification.
- **DISPATCHING / unreadable guard:** A process may have stopped before or after contacting PayPal. Treat it as unknown until reconciled.

The CLI deliberately has no retry or guard-reset command. Preserve the guard after every outcome, including rejection. This conservative spike supports one local dispatch attempt; additional experiments require a separately reviewed recovery decision. A duplicate response and its original ID do not prove payment or that original award details match this request.

PayPal documents a 30-day duplicate window for `sender_batch_id`; it is not permanent protection. The local guard adds protection in this checkout but is not a database, cross-machine lock, or production settlement ledger. Copying the repository or losing local state removes that protection. Production integration requires transactional persistence and explicit award approval.

All requests have a 15-second timeout, reject redirects, use the hard-coded `https://api-m.sandbox.paypal.com` host, and have no automatic retries. Transport/provider error bodies are never printed. A command failure exits nonzero; inspect configuration and the guard locally rather than enabling verbose HTTP logging.

## API references

- [Sandbox account and app setup](https://developer.paypal.com/payouts/use-payouts/set-up)
- [Create payout and duplicate-batch behavior](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-post/)
- [Read batch details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-get/)
- [Read item details](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-item-get/)
