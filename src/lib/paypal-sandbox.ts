import "server-only";
import { centsToUsdInput, MAX_CENTS } from "./money";
import { paypalId } from "./payout-validation";

const BASE = "https://api-m.sandbox.paypal.com";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown) => paypalId.safeParse(value).success ? value as string : undefined;
const statuses = new Set(["SUCCESS", "PENDING", "UNCLAIMED", "FAILED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"]);
export function itemStatus(value: unknown) { return typeof value === "string" && statuses.has(value) ? value : "UNKNOWN"; }

export class PayPalError extends Error {
  constructor(public outcome: "REJECTED" | "DUPLICATE" | "UNKNOWN", public httpStatus?: number, public originalBatchId?: string) {
    super(`PayPal sandbox request ${outcome.toLowerCase()}.`);
  }
}
export type PayoutTerms = { senderBatchId: string; senderItemId: string; recipientEmail: string; amountCents: number };
export type ItemEvidence = {
  batchId?: string; itemId?: string; senderBatchId?: string; senderItemId?: string;
  recipientEmail?: string; amount?: string; currency?: string; recipientType?: string; status: string;
};
function item(value: unknown): ItemEvidence {
  const body = object(value), payout = object(body.payout_item), amount = object(payout.amount);
  return { batchId: identifier(body.payout_batch_id), itemId: identifier(body.payout_item_id),
    senderBatchId: identifier(body.sender_batch_id), senderItemId: identifier(payout.sender_item_id),
    recipientEmail: typeof payout.receiver === "string" ? payout.receiver : undefined,
    amount: typeof amount.value === "string" ? amount.value : undefined,
    currency: typeof amount.currency === "string" ? amount.currency : undefined,
    recipientType: typeof payout.recipient_type === "string" ? payout.recipient_type : undefined,
    status: itemStatus(body.transaction_status) };
}
function duplicateBatch(body: Record<string, unknown>) {
  const details = Array.isArray(body.details) ? body.details : [];
  for (const entry of [body, ...details]) {
    const links = object(entry).links;
    for (const link of Array.isArray(links) ? links : []) {
      try {
        const url = new URL(String(object(link).href));
        if (url.origin !== BASE || url.search || url.hash || url.username || url.password) continue;
        const match = /^\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
        const id = identifier(match?.[1]); if (id) return id;
      } catch { /* Provider URLs are never followed. */ }
    }
  }
}
export class PayPalSandbox {
  private token?: string;
  constructor(private credentials: { clientId: string; secret: string }, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, init: RequestInit, submitting = false) {
    let response: Response, body: Record<string, unknown>;
    try {
      response = await this.fetcher(`${BASE}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      body = object(await response.json());
    } catch { throw new PayPalError("UNKNOWN"); }
    if (!response.ok) {
      const duplicate = body.name === "DUPLICATE_BATCH_ID" || (Array.isArray(body.details) && body.details.some(d => object(d).issue === "DUPLICATE_BATCH_ID"));
      throw new PayPalError(duplicate ? "DUPLICATE" : submitting && (response.status >= 500 || response.status === 408) ? "UNKNOWN" : "REJECTED", response.status, duplicate ? duplicateBatch(body) : undefined);
    }
    return body;
  }
  async authenticate() {
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.secret}`).toString("base64");
    const body = await this.request("/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    if (typeof body.access_token !== "string" || !body.access_token) throw new PayPalError("UNKNOWN");
    this.token = body.access_token;
  }
  private headers() {
    if (!this.token) throw new PayPalError("REJECTED");
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }
  async submit(terms: PayoutTerms) {
    if (!identifier(terms.senderBatchId) || !identifier(terms.senderItemId) || terms.senderItemId.length > 63 || !Number.isSafeInteger(terms.amountCents) || terms.amountCents <= 0 || terms.amountCents > MAX_CENTS || !/^[\x21-\x7e]{1,127}$/.test(terms.recipientEmail)) throw new PayPalError("REJECTED");
    const body = await this.request("/v1/payments/payouts", { method: "POST", headers: this.headers(), body: JSON.stringify({
      sender_batch_header: { sender_batch_id: terms.senderBatchId, email_subject: "HackRef SANDBOX award" },
      items: [{ recipient_type: "EMAIL", receiver: terms.recipientEmail, sender_item_id: terms.senderItemId,
        amount: { value: centsToUsdInput(terms.amountCents), currency: "USD" } }],
    }) }, true);
    const header = object(body.batch_header), batchId = identifier(header.payout_batch_id);
    if (!batchId || object(header.sender_batch_header).sender_batch_id !== terms.senderBatchId) throw new PayPalError("UNKNOWN");
    return { batchId };
  }
  async batch(batchId: string) {
    if (!identifier(batchId)) throw new PayPalError("UNKNOWN");
    const body = await this.request(`/v1/payments/payouts/${batchId}?page_size=1000`, { method: "GET", headers: this.headers() });
    const header = object(body.batch_header);
    const knownBatch = new Set(["DENIED", "PENDING", "PROCESSING", "SUCCESS", "CANCELED"]);
    return { batchId: identifier(header.payout_batch_id), senderBatchId: identifier(object(header.sender_batch_header).sender_batch_id),
      status: typeof header.batch_status === "string" && knownBatch.has(header.batch_status) ? header.batch_status : "UNKNOWN",
      items: Array.isArray(body.items) ? body.items.map(item) : [] };
  }
  async item(itemId: string) {
    if (!identifier(itemId)) throw new PayPalError("UNKNOWN");
    return item(await this.request(`/v1/payments/payouts-item/${itemId}`, { method: "GET", headers: this.headers() }));
  }
}
