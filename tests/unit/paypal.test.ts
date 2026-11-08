import assert from "node:assert/strict";
import { test } from "node:test";
import { PayPalError, PayPalSandbox, itemStatus } from "../../src/lib/paypal-sandbox";
import { sandboxReadiness } from "../../src/lib/payouts";
import { sandboxEnv, paypalFixture } from "../helpers/paypal";
const terms = { senderBatchId: "stable-batch", senderItemId: "stable-item", recipientEmail: "Recipient+prize@example.test", amountCents: 10 };
const credentials = { clientId: "fixture-client", secret: "fixture-secret" };

test("sandbox adapter sends exact money and fixed endpoints with timeout and redirect protection", async () => {
  const fixture = paypalFixture(); const client = new PayPalSandbox(credentials, fixture.fetcher);
  await client.authenticate(); assert.deepEqual(await client.submit(terms), { batchId: "provider-batch" });
  const body = JSON.parse(fixture.requests[1].body!);
  assert.deepEqual(body.items[0].amount, { value: "0.10", currency: "USD" });
  assert.equal(body.items[0].sender_item_id, terms.senderItemId);
  assert.equal(body.sender_batch_header.sender_batch_id, terms.senderBatchId);
  await client.batch("provider-batch"); await client.item("provider-item");
  assert.deepEqual(fixture.requests.map(r => r.method), ["POST", "POST", "GET", "GET"]);
  await assert.rejects(client.batch("https://evil.example")); await assert.rejects(client.item("../other"));
  assert.equal(fixture.requests.length, 4);
});
for (const cents of [1, 10, 100, 12551, 2147483647]) test(`exact USD serialization: ${cents} cents`, async () => {
  const f = paypalFixture(), c = new PayPalSandbox(credentials, f.fetcher); await c.authenticate(); await c.submit({ ...terms, amountCents: cents });
  assert.equal(JSON.parse(f.requests[1].body!).items[0].amount.value, `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
});
for (const [name, response, outcome] of [
  ["timeout", new Error("secret Recipient+prize@example.test"), "UNKNOWN"],
  ["server error", Response.json({ private: "secret" }, { status: 500 }), "UNKNOWN"],
  ["HTTP 408", Response.json({}, { status: 408 }), "UNKNOWN"],
  ["rejection", Response.json({ private: "secret" }, { status: 422 }), "REJECTED"],
  ["malformed success", new Response("not json", { status: 201 }), "UNKNOWN"],
  ["missing ID", Response.json({ batch_header: {} }), "UNKNOWN"],
  ["mismatched sender", Response.json({ batch_header: { payout_batch_id: "batch", sender_batch_header: { sender_batch_id: "wrong" } } }), "UNKNOWN"],
] as const) test(`sandbox ${name} is sanitized and never retried`, async () => {
  const f = paypalFixture(); f.setSubmitResponse(response); const c = new PayPalSandbox(credentials, f.fetcher); await c.authenticate();
  await assert.rejects(c.submit(terms), error => error instanceof PayPalError && error.outcome === outcome && !String(error).includes("secret") && !String(error).includes(terms.recipientEmail));
  assert.equal(f.dispatches, 1);
});
test("invalid credentials are sanitized and cannot reach payout POST", async () => {
  const f = paypalFixture(); f.setAuthResponse(Response.json({ error_description: "fixture-secret" }, { status: 401 }));
  await assert.rejects(new PayPalSandbox(credentials, f.fetcher).authenticate(), e => e instanceof PayPalError && e.outcome === "REJECTED" && e.httpStatus === 401 && !String(e).includes("fixture-secret"));
  assert.equal(f.dispatches, 0);
});
for (const origin of ["https://api-m.sandbox.paypal.com", "https://evil.example", "https://api-m.paypal.com"]) test(`duplicate link extraction: ${origin}`, async () => {
  const f = paypalFixture(); f.setSubmitResponse(Response.json({ details: [{ issue: "DUPLICATE_BATCH_ID", links: [{ href: `${origin}/v1/payments/payouts/original-batch` }] }] }, { status: 400 }));
  const c = new PayPalSandbox(credentials, f.fetcher); await c.authenticate();
  await assert.rejects(c.submit(terms), e => e instanceof PayPalError && e.outcome === "DUPLICATE" && e.originalBatchId === (origin.includes("sandbox") ? "original-batch" : undefined));
  assert.equal(f.dispatches, 1); assert.equal(f.requests.length, 2);
});
test("only recognized individual SUCCESS is payment evidence; unknowns stay unknown", () => {
  assert.equal(itemStatus("SUCCESS"), "SUCCESS");
  for (const status of [null, undefined, "success", "NEW_PROVIDER_STATUS", { status: "SUCCESS" }]) assert.equal(itemStatus(status), "UNKNOWN");
  for (const status of ["PENDING", "UNCLAIMED", "FAILED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"]) assert.equal(itemStatus(status), status);
});
test("sending is opt-in, server configured, and requires exact operator-verified allowlist", () => {
  assert.equal(sandboxReadiness(terms.recipientEmail, sandboxEnv), null);
  assert.ok(sandboxReadiness(terms.recipientEmail, {}));
  assert.ok(sandboxReadiness("unverified@example.test", sandboxEnv));
  assert.ok(sandboxReadiness(terms.recipientEmail.toLowerCase(), sandboxEnv));
  assert.ok(sandboxReadiness(terms.recipientEmail, { ...sandboxEnv, PAYPAL_SANDBOX_CLIENT_SECRET: "" }));
});
