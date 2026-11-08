export function payoutExplanation(payout: { dispatchState: string; status: string; lastOutcome: string | null; itemStatus: string | null }) {
  if (payout.dispatchState === "prepared") return "Prepared · no payout request started. This intent is preserved and cannot be sent again through the app. Ask the operator to investigate.";
  if (payout.lastOutcome === "CORRELATION_MISMATCH") return "The provider details did not match this approved award. The last verified observation is retained. Ask the operator to investigate; do not send again.";
  if (payout.lastOutcome === "RECONCILIATION_UNAVAILABLE") return "The latest status could not be checked. Any previous item observation below is historical. Check again or ask the operator to investigate; do not send again.";
  if (payout.itemStatus === "SUCCESS" && payout.status === "succeeded") return "Reconciled · the matching individual item reports SUCCESS. Recipient payment was observed in SANDBOX at the timestamp below; later returns or reversals remain possible.";
  if (payout.itemStatus === "UNCLAIMED") return "The sandbox recipient has not claimed this payout. No recipient payment is confirmed. Reconcile again after the recipient checks their sandbox account.";
  if (payout.itemStatus === "PENDING") return "The individual item is pending. PayPal has not confirmed recipient payment. Reconcile again later.";
  if (["FAILED", "RETURNED", "REFUNDED", "REVERSED"].includes(payout.itemStatus ?? "")) return "The individual item reports a failure, return or reversal. Review the exact item status below with the operator. This award cannot be sent again.";
  if (payout.itemStatus === "ONHOLD" || payout.itemStatus === "BLOCKED") return "PayPal has held or blocked this individual item. Recipient payment is not confirmed. Ask the operator to investigate and reconcile again.";
  if (payout.lastOutcome === "REJECTED") return "PayPal rejected the payout request. No recipient payment is confirmed. The permanent dispatch claim remains; ask the operator to investigate.";
  if (payout.lastOutcome === "ACCEPTED") return "Submitted · PayPal accepted the batch. Recipient payment is unconfirmed until the matching individual item is reconciled.";
  return "Unknown · delivery or individual item status is uncertain. Do not send again or change sender IDs. Reconcile the original batch or ask the operator to investigate.";
}
