// Test-process-only HTTP injection. Never imported by application source or a
// normal startup command. Real PayPal/Gemini calls are forbidden in this process.
import { appendFileSync, readFileSync } from "node:fs";
const database = new URL(process.env.DATABASE_URL);
if (!/^\/[A-Za-z0-9_]+_test$/.test(database.pathname) ||
    !/^\-c search_path=hackref_test_[a-f0-9]+$/.test(database.searchParams.get("options") ?? "") ||
    !process.env.HACKREF_MOCK_PAYPAL_LOG || !process.env.HACKREF_MOCK_PAYPAL_CONTROL)
  throw new Error("PayPal HTTP mock requires a disposable test schema and fixture files.");
const original = globalThis.fetch;
const batches = new Map();
let sequence = 0;
const control = () => JSON.parse(readFileSync(process.env.HACKREF_MOCK_PAYPAL_CONTROL, "utf8"));
const record = (value) => appendFileSync(process.env.HACKREF_MOCK_PAYPAL_LOG, `${JSON.stringify(value)}\n`);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (/generativelanguage\.googleapis\.com$/.test(url.hostname)) throw new Error("Real model calls forbidden by test fixture.");
  if (url.hostname === "api.github.com") {
    const match = /^\/repos\/example\/(alpha|beta)(\/commits\/[^/]+)?$/.exec(url.pathname);
    const repository = match && control().githubRepositories?.[match[1]];
    if (!repository) throw new Error("Unexpected GitHub request forbidden by test fixture.");
    return match[2] ? new Response(repository.commitSha) : Response.json({ id: repository.id, private: false, visibility: "public", full_name: `example/${match[1]}`, owner: { login: "example" }, default_branch: "main" });
  }
  if (!/paypal\.com$/.test(url.hostname)) return original(input, init);
  if (url.origin !== "https://api-m.sandbox.paypal.com") throw new Error("Non-sandbox PayPal host forbidden.");
  const method = init?.method ?? "GET", path = url.pathname;
  record({ method, path });
  if (path === "/v1/oauth2/token" && method === "POST") return Response.json({ access_token: "http-fixture-token" });
  if (path === "/v1/payments/payouts" && method === "POST") {
    const data = JSON.parse(String(init.body)), id = `fixture-batch-${++sequence}`, itemId = `fixture-item-${sequence}`;
    batches.set(id, { data, itemId });
    record({ createdBatchId: id });
    if (control().submitOutcome === "timeout") throw new Error("Injected transport timeout.");
    return Response.json({ batch_header: { payout_batch_id: id, sender_batch_header: data.sender_batch_header, batch_status: "PENDING" } }, { status: 201 });
  }
  const match = /^\/v1\/payments\/payouts\/(fixture-batch-\d+)$/.exec(path);
  const itemMatch = /^\/v1\/payments\/payouts-item\/(fixture-item-\d+)$/.exec(path);
  function item(batchId, stored) {
    const settings = control();
    return { payout_batch_id: batchId, payout_item_id: stored.itemId, sender_batch_id: stored.data.sender_batch_header.sender_batch_id,
      transaction_status: settings.status ?? "PENDING", payout_item: { ...stored.data.items[0], ...(settings.mismatch ? { receiver: "mismatch@example.test" } : {}) } };
  }
  if (method === "GET" && match && batches.has(match[1])) {
    const stored = batches.get(match[1]);
    return Response.json({ batch_header: { payout_batch_id: match[1], sender_batch_header: stored.data.sender_batch_header,
      batch_status: control().batchStatus ?? "SUCCESS" }, items: [item(match[1], stored)] });
  }
  if (method === "GET" && itemMatch) {
    for (const [batchId, stored] of batches) if (stored.itemId === itemMatch[1]) return Response.json(item(batchId, stored));
  }
  return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
};
