import assert from "node:assert/strict";
import type { PayoutTerms } from "../../src/lib/paypal-sandbox";

export const sandboxEnv = {
  HACKREF_SANDBOX_PAYOUTS_ENABLED: "true",
  PAYPAL_SANDBOX_CLIENT_ID: "fixture-client",
  PAYPAL_SANDBOX_CLIENT_SECRET: "fixture-secret",
  PAYPAL_SANDBOX_RECIPIENT_EMAILS: "Recipient+prize@example.test",
};
export function paypalFixture() {
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  let terms: PayoutTerms | undefined;
  let providerItemId = "provider-item";
  let status = "SUCCESS";
  let batchStatus = "SUCCESS";
  let patch: Record<string, unknown> = {};
  let directPatch: Record<string, unknown> = {};
  let submitResponse: Response | Error | undefined;
  let authResponse: Response | Error | undefined;
  const item = () => ({ payout_item_id: providerItemId, payout_batch_id: "provider-batch", sender_batch_id: terms!.senderBatchId,
    transaction_status: status, payout_item: { sender_item_id: terms!.senderItemId, recipient_type: "EMAIL", receiver: terms!.recipientEmail,
      amount: { value: `${Math.floor(terms!.amountCents / 100)}.${String(terms!.amountCents % 100).padStart(2, "0")}`, currency: "USD" } }, ...patch });
  const fetcher: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://api-m.sandbox.paypal.com");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    requests.push({ path: parsed.pathname, method: init!.method!, body: init?.body ? String(init.body) : undefined });
    if (parsed.pathname === "/v1/oauth2/token") {
      if (authResponse instanceof Error) throw authResponse;
      return authResponse ?? Response.json({ access_token: "fixture-token" });
    }
    if (init?.method === "POST" && parsed.pathname === "/v1/payments/payouts") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.items.length, 1);
      const i = body.items[0];
      terms = { senderBatchId: body.sender_batch_header.sender_batch_id, senderItemId: i.sender_item_id, recipientEmail: i.receiver,
        amountCents: Number(i.amount.value.replace(".", "")) };
      if (submitResponse instanceof Error) throw submitResponse;
      return submitResponse ?? Response.json({ batch_header: { payout_batch_id: "provider-batch", sender_batch_header: { sender_batch_id: terms.senderBatchId } } }, { status: 201 });
    }
    assert.ok(terms, "Set original terms for read-only recovery");
    if (parsed.pathname === "/v1/payments/payouts/provider-batch") return Response.json({
      batch_header: { payout_batch_id: "provider-batch", sender_batch_header: { sender_batch_id: terms.senderBatchId }, batch_status: batchStatus }, items: [item()] });
    if (parsed.pathname === `/v1/payments/payouts-item/${providerItemId}`) return Response.json({ ...item(), ...directPatch });
    assert.fail("Unexpected sandbox path");
  };
  return { requests, fetcher, setItemId(value: string) { providerItemId = value; }, setTerms(value: PayoutTerms) { terms = value; }, setStatus(value: string) { status = value; },
    setBatchStatus(value: string) { batchStatus = value; }, setPatch(value: Record<string, unknown>) { patch = value; }, setDirectPatch(value: Record<string, unknown>) { directPatch = value; },
    setSubmitResponse(value: Response | Error) { submitResponse = value; }, setAuthResponse(value: Response | Error) { authResponse = value; },
    get dispatches() { return requests.filter(r => r.path === "/v1/payments/payouts" && r.method === "POST").length; } };
}
