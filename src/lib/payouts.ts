import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { assessments, auditEvents, awardApprovals, awards, hackathonEvents, payouts } from "../db/schema";
import { committedAwardCents } from "./award-budget";
import { AppError } from "./errors";
import { centsToUsdInput } from "./money";
import { PayPalError, PayPalSandbox, type ItemEvidence, type PayoutTerms } from "./paypal-sandbox";
import { reconciliationInput, sandboxSendInput } from "./payout-validation";
import { uuidInput } from "./validation";

type Options = { env?: Record<string, string | undefined>; fetcher?: typeof fetch };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Payout = typeof payouts.$inferSelect;

export function sandboxReadiness(recipient: string, env: Record<string, string | undefined> = process.env) {
  if (env.HACKREF_SANDBOX_PAYOUTS_ENABLED !== "true") return "Sandbox sending is disabled by the operator.";
  if (!env.PAYPAL_SANDBOX_CLIENT_ID?.trim() || !env.PAYPAL_SANDBOX_CLIENT_SECRET?.trim()) return "The operator must configure server-side PayPal sandbox credentials.";
  if (!/^[\x21-\x7e]{1,127}$/.test(recipient)) return "This recipient does not meet PayPal's email format limits. Operator investigation is required.";
  // Exact matching deliberately preserves the approved address, including case.
  if (!(env.PAYPAL_SANDBOX_RECIPIENT_EMAILS ?? "").split(",").map(s => s.trim()).includes(recipient))
    return "The operator must verify this exact recipient in PayPal Developer sandbox accounts and add it to the server-side sandbox allowlist.";
  return null;
}
function provider(options: Options) {
  const env = options.env ?? process.env;
  if (!env.PAYPAL_SANDBOX_CLIENT_ID?.trim() || !env.PAYPAL_SANDBOX_CLIENT_SECRET?.trim())
    throw new AppError(409, "Configure server-side PayPal sandbox credentials before reconciliation.");
  return new PayPalSandbox({ clientId: env.PAYPAL_SANDBOX_CLIENT_ID, secret: env.PAYPAL_SANDBOX_CLIENT_SECRET }, options.fetcher);
}
async function scope(tx: Transaction, organizerId: string, awardId: string) {
  const [event] = await tx.select().from(hackathonEvents).where(eq(hackathonEvents.organizerId, organizerId)).for("update");
  if (!event) throw new AppError(404, "Award not found.");
  const [award] = await tx.select().from(awards).where(and(eq(awards.id, awardId), eq(awards.eventId, event.id))).for("update");
  if (!award) throw new AppError(404, "Award not found.");
  return { event, award };
}
async function existing(tx: Transaction, awardId: string) {
  const [payout] = await tx.select().from(payouts).where(eq(payouts.awardId, awardId)).for("update");
  return payout;
}
async function audit(tx: Transaction, eventId: string, actorId: string, payout: Payout, action: string, metadata: Record<string, unknown> = {}) {
  await tx.insert(auditEvents).values({ eventId, actorId, action, entityType: "payout", entityId: payout.id,
    metadata: { environment: "sandbox", awardId: payout.awardId, approvalId: payout.approvalId, ...metadata } });
}
// Every state change and its sanitized audit commit together. Version fencing
// prevents an older in-flight dispatch/reconciliation result replacing a newer one.
async function finish(db: Database, organizerId: string, awardId: string, version: number, patch: Partial<Payout>, action: string, metadata: Record<string, unknown>) {
  return db.transaction(async tx => {
    const { event } = await scope(tx, organizerId, awardId);
    const current = await existing(tx, awardId);
    if (!current) throw new AppError(404, "Payout not found.");
    if (current.stateVersion !== version) return current;
    const [saved] = await tx.update(payouts).set({ ...patch, stateVersion: current.stateVersion + 1 }).where(eq(payouts.id, current.id)).returning();
    await audit(tx, event.id, organizerId, saved, action, { from: current.status, to: saved.status, stateVersion: saved.stateVersion, ...metadata });
    return saved;
  });
}
export async function sendSandboxPayout(db: Database, organizerId: string, awardId: string, input: unknown, options: Options = {}) {
  uuidInput.parse(awardId);
  const data = sandboxSendInput.parse(input);
  const prepared = await db.transaction(async tx => {
    const { event, award } = await scope(tx, organizerId, awardId);
    for (const key of ["revision", "title", "submissionId", "assessmentId", "amountCents", "currency", "recipientEmail"] as const)
      if (data[key] !== award[key]) throw new AppError(409, "The payout confirmation differs from the approved award. Refresh and review every term.");
    const [approval] = await tx.select().from(awardApprovals).where(and(eq(awardApprovals.id, data.approvalId), eq(awardApprovals.awardId, award.id))).for("share");
    if (!approval || approval.approvedBy !== organizerId || approval.awardRevision !== award.revision || approval.assessmentId !== award.assessmentId || approval.amountCents !== award.amountCents || approval.currency !== "USD" || approval.recipientEmail !== award.recipientEmail)
      throw new AppError(409, "An organizer's exact-term approval is required before sending.");
    const prior = await existing(tx, award.id);
    if (prior) return { payout: prior, created: false };
    const [assessment] = await tx.select().from(assessments).where(and(eq(assessments.id, award.assessmentId), eq(assessments.eventId, event.id), eq(assessments.submissionId, award.submissionId))).for("share");
    if (!assessment || assessment.status !== "finalized" || assessment.finalizedBy !== organizerId || !assessment.finalizedAt)
      throw new AppError(409, "A matching human-finalized assessment is required.");
    if (event.currency !== "USD" || await committedAwardCents(tx, event.id) > event.budgetCents)
      throw new AppError(409, "The approved awards exceed the event's USD budget.");
    const reason = sandboxReadiness(award.recipientEmail, options.env);
    if (reason) throw new AppError(409, reason);
    const payoutId = randomUUID(), now = new Date();
    const [payout] = await tx.insert(payouts).values({ id: payoutId, awardId: award.id, approvalId: approval.id,
      environment: "sandbox", dispatchState: "prepared", authorizedBy: organizerId, authorizedAt: now, recipientVerifiedAt: now,
      senderBatchId: `hrb_${payoutId}`, senderItemId: `hri_${payoutId}` }).returning();
    await audit(tx, event.id, organizerId, payout, "payout.authorized", { revision: award.revision, assessmentId: award.assessmentId,
      amountCents: award.amountCents, currency: "USD", budgetCents: event.budgetCents, recipientVerification: "organizer_and_server_allowlist",
      senderBatchId: payout.senderBatchId, senderItemId: payout.senderItemId });
    return { payout, created: true };
  });
  // Only the request that created the intent may continue. All replays,
  // including prepared intents left by a crash, return the existing record.
  if (!prepared.created) return prepared;
  const client = provider(options);
  try { await client.authenticate(); }
  catch (error) {
    const outcome = error instanceof PayPalError ? error.outcome : "UNKNOWN";
    const payout = await finish(db, organizerId, awardId, 0, { lastOutcome: `PREFLIGHT_${outcome}` }, "payout.preflight_failed", { outcome });
    return { payout, created: true };
  }
  const claimed = await db.transaction(async tx => {
    const { event } = await scope(tx, organizerId, awardId);
    const payout = await existing(tx, awardId);
    if (!payout || payout.dispatchState !== "prepared" || payout.stateVersion !== 0) return null;
    const [saved] = await tx.update(payouts).set({ dispatchState: "started", dispatchClaim: randomUUID(), dispatchStartedAt: new Date(),
      status: "unknown", lastOutcome: "DISPATCH_STARTED", stateVersion: 1 }).where(eq(payouts.id, payout.id)).returning();
    await audit(tx, event.id, organizerId, saved, "payout.dispatch_started", { senderBatchId: saved.senderBatchId, senderItemId: saved.senderItemId });
    return saved;
  });
  if (!claimed) return prepared;
  let patch: Partial<Payout>;
  try {
    const accepted = await client.submit({ senderBatchId: claimed.senderBatchId, senderItemId: claimed.senderItemId, recipientEmail: data.recipientEmail, amountCents: data.amountCents });
    patch = { paypalBatchId: accepted.batchId, status: "pending", lastOutcome: "ACCEPTED" };
  } catch (error) {
    const outcome = error instanceof PayPalError ? error.outcome : "UNKNOWN";
    patch = { status: outcome === "REJECTED" ? "failed" : "unknown", lastOutcome: outcome,
      // A duplicate ID is a lookup candidate, not evidence that the terms match.
      paypalBatchId: error instanceof PayPalError ? error.originalBatchId : undefined };
  }
  // A failed commit here leaves the durable started/unknown claim intact.
  const payout = await finish(db, organizerId, awardId, claimed.stateVersion, patch, "payout.dispatch_result", { outcome: patch.lastOutcome, batchId: patch.paypalBatchId ?? null });
  return { payout, created: true };
}
function matches(item: ItemEvidence, terms: PayoutTerms, batchId: string, itemId?: string) {
  return !!item.itemId && (!itemId || item.itemId === itemId) && item.senderItemId === terms.senderItemId &&
    item.recipientType === "EMAIL" && item.recipientEmail === terms.recipientEmail && item.amount === centsToUsdInput(terms.amountCents) && item.currency === "USD" &&
    // Batch item entries may omit these; the direct item response must supply them.
    (!item.batchId || item.batchId === batchId) && (!item.senderBatchId || item.senderBatchId === terms.senderBatchId);
}
function statusFor(status: string): Payout["status"] {
  switch (status) {
    case "SUCCESS": return "succeeded";
    case "PENDING": return "pending";
    case "UNCLAIMED": return "unclaimed";
    case "FAILED": return "failed";
    case "RETURNED": case "REFUNDED": case "REVERSED": return "returned";
    default: return "unknown";
  }
}
export async function reconcileSandboxPayout(db: Database, organizerId: string, awardId: string, input: unknown, options: Options = {}) {
  uuidInput.parse(awardId);
  const data = reconciliationInput.parse(input);
  const snapshot = await db.transaction(async tx => {
    const { event, award } = await scope(tx, organizerId, awardId);
    const payout = await existing(tx, awardId);
    if (!payout) throw new AppError(404, "Payout not found.");
    if (payout.dispatchState === "prepared") throw new AppError(409, "No payout request was started. Preserve this intent and ask the operator to investigate; it cannot be resent.");
    if (data.batchId && payout.paypalBatchId && data.batchId !== payout.paypalBatchId) throw new AppError(409, "Use the original PayPal batch identifier.");
    const batchId = payout.paypalBatchId ?? data.batchId;
    if (!batchId) throw new AppError(409, "Delivery is uncertain. The operator must locate the original batch in PayPal sandbox activity and provide its ID. Never send again.");
    const [saved] = await tx.update(payouts).set({ stateVersion: payout.stateVersion + 1 }).where(eq(payouts.id, payout.id)).returning();
    await audit(tx, event.id, organizerId, saved, "payout.reconciliation_requested", { batchId, stateVersion: saved.stateVersion });
    return { payout: saved, award, batchId };
  });
  const { payout, award, batchId } = snapshot;
  const terms = { ...payout, recipientEmail: award.recipientEmail, amountCents: award.amountCents };
  let patch: Partial<Payout>, metadata: Record<string, unknown>;
  try {
    const client = provider(options); await client.authenticate();
    const batch = await client.batch(batchId);
    if (batch.batchId !== batchId || batch.senderBatchId !== payout.senderBatchId || batch.items.length !== 1 || !matches(batch.items[0], terms, batchId, payout.paypalItemId ?? undefined))
      throw new AppError(409, "Correlation mismatch.");
    const detail = await client.item(batch.items[0].itemId!);
    if (!matches(detail, terms, batchId, batch.items[0].itemId) || detail.batchId !== batchId || detail.senderBatchId !== payout.senderBatchId)
      throw new AppError(409, "Correlation mismatch.");
    const evidence = { batchId, itemId: detail.itemId!, senderBatchId: payout.senderBatchId, senderItemId: payout.senderItemId,
      batchStatus: batch.status, itemStatus: detail.status, amount: centsToUsdInput(award.amountCents), currency: "USD" as const, recipientMatched: true as const };
    const observedAt = new Date();
    patch = { paypalBatchId: batchId, paypalItemId: detail.itemId, itemStatus: detail.status, status: statusFor(detail.status),
      evidence, reconciledAt: observedAt, lastOutcome: "RECONCILED" };
    metadata = { ...evidence, observedAt: observedAt.toISOString() };
  } catch (error) {
    // Failed lookups cannot erase the last correlated observation or imply failure.
    patch = { lastOutcome: error instanceof AppError && error.status === 409 ? "CORRELATION_MISMATCH" : "RECONCILIATION_UNAVAILABLE" };
    metadata = { outcome: patch.lastOutcome };
  }
  return finish(db, organizerId, awardId, payout.stateVersion, patch,
    patch.evidence ? "payout.reconciled" : "payout.reconciliation_failed", metadata);
}
