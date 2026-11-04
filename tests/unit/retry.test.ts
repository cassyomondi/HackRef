import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MAX_MANUAL_RETRIES, retryIdentity, retryKey } from "../../src/lib/evaluation/retry-identity";
import { GeminiError, providerError } from "../../src/lib/evaluation/provider-errors";
import { geminiSettings, geminiTransport, SYSTEM_INSTRUCTION } from "../../src/lib/evaluation/model";
import { providerResponseSchema } from "../../src/lib/evaluation/provider-schema";

test("durable retry identity retains the root, direct parent and bounded ordinal", () => {
  const root = randomUUID(), parent = randomUUID();
  for (let number = 1; number <= MAX_MANUAL_RETRIES; number++)
    assert.deepEqual(retryIdentity(retryKey(root, number, parent)), { rootJobId: root, parentJobId: parent, number });
  assert.equal(retryKey(root, 1, parent), retryKey(root, 1, parent));
  for (const number of [-1, 0, 1.5, 4, Infinity]) assert.throws(() => retryKey(root, number, parent));
  for (const value of ["pass2-input-validation-v1", "gemini-draft-v1:submission:sha:rubric", `gemini-draft-v1:manual-retry:${root}:1:${parent}:extra`, "gemini-draft-v1:manual-retry:fake:1:fake"])
    assert.equal(retryIdentity(value), null);
});

test("Gemini provider classifications are distinct, safe and retry only transient failures", () => {
  const raw = "sensitive-upstream-value";
  const cases: Array<{ status?: number | string; name?: string; message: string; code: string; retryable: boolean; cause?: { code: string } }> = [
    { status: 401, message: raw, code: "GEMINI_KEY_INVALID", retryable: false },
    { status: 400, message: JSON.stringify({ error: { details: [{ reason: "API_KEY_INVALID" }], message: raw } }), code: "GEMINI_KEY_INVALID", retryable: false },
    { status: 403, message: raw, code: "GEMINI_PERMISSION_DENIED", retryable: false },
    { status: 404, message: raw, code: "GEMINI_MODEL_NOT_FOUND", retryable: false },
    { status: 429, message: `Daily quota exhausted ${raw}`, code: "GEMINI_QUOTA_EXHAUSTED", retryable: false },
    { status: 429, message: `Per minute rate limit ${raw}`, code: "GEMINI_RATE_LIMITED", retryable: true },
    { status: 503, message: `API_KEY_INVALID permission denied ${raw}`, code: "GEMINI_UNAVAILABLE", retryable: true },
    { status: "503", message: raw, code: "GEMINI_UNAVAILABLE", retryable: true },
    { message: JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: raw } }), code: "GEMINI_UNAVAILABLE", retryable: true },
    { status: 504, message: raw, code: "GEMINI_TIMEOUT", retryable: true },
    { status: 408, message: raw, code: "GEMINI_TIMEOUT", retryable: true },
    { name: "TimeoutError", message: raw, code: "GEMINI_TIMEOUT", retryable: true },
    { name: "AbortError", message: raw, code: "GEMINI_TIMEOUT", retryable: true },
    { message: "fetch failed", cause: { code: "ETIMEDOUT" }, code: "GEMINI_TIMEOUT", retryable: true },
    { message: `fetch failed ${raw}`, code: "GEMINI_TRANSPORT_ERROR", retryable: true },
    { status: 400, message: raw, code: "GEMINI_INVALID_REQUEST", retryable: false },
  ];
  for (const entry of cases) {
    const error = providerError(Object.assign(new Error(entry.message), entry));
    assert.equal(error.code, entry.code); assert.equal(error.retryable, entry.retryable);
    assert.ok(!JSON.stringify(error).includes(raw)); assert.ok(!error.message.includes(raw));
    if (entry.code === "GEMINI_UNAVAILABLE") assert.doesNotMatch(error.message, /key|permission|access/i);
  }
  const previous = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.throws(geminiSettings, (error: unknown) => error instanceof GeminiError && error.code === "GEMINI_KEY_MISSING" && !error.retryable);
  } finally { if (previous !== undefined) process.env.GEMINI_API_KEY = previous; }
});

test("actual SDK HTTP 503 errors are temporary unavailability without internal retries or credential claims", async (t) => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-key-not-a-real-credential";
  try {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ error: { code: 503, status: "UNAVAILABLE", message: "sensitive upstream overload details" } }, { status: 503 });
    });
    await assert.rejects(geminiTransport({ model: "mock-model", input: "{}", responseJsonSchema: providerResponseSchema(), systemInstruction: SYSTEM_INSTRUCTION, signal: new AbortController().signal }), (error: unknown) => {
      assert.ok(error instanceof GeminiError);
      assert.equal(error.code, "GEMINI_UNAVAILABLE"); assert.equal(error.providerStatus, 503); assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /key|permission|sensitive/);
      return true;
    });
    assert.equal(calls, 1);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});
