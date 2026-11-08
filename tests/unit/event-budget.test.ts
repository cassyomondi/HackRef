import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, apiRequest } from "../../src/lib/api-client";
import { AppError, appErrorResponse } from "../../src/lib/errors";
import { centsToUsdInput, usdToCents } from "../../src/lib/money";
import { eventInput, validationFields } from "../../src/lib/validation";

const event = { name: "Budget contract", slug: "budget-contract", status: "draft", deadlineAt: "2026-11-12T20:59:59Z" };

test("event's strict API contract accepts exact cents from whole and decimal USD input", () => {
  for (const [input, normalized, cents] of [["1", "1.00", 100], ["1.5", "1.50", 150], ["1.00", "1.00", 100], ["0.10", "0.10", 10]] as const) {
    assert.equal(usdToCents(input), cents);
    assert.equal(centsToUsdInput(cents), normalized);
    assert.equal(eventInput.parse({ ...event, budgetCents: cents }).budgetCents, cents);
  }
  assert.equal(Object.hasOwn(eventInput.parse(event), "budgetCents"), false, "Omission must not introduce a zero default on existing event updates");
  assert.equal(eventInput.parse({ ...event, budgetCents: 0 }).budgetCents, 0);
});

test("USD input errors identify missing, negative, precision, syntax and range problems without rounding", () => {
  assert.throws(() => usdToCents(""), /Enter a USD amount/);
  for (const input of ["-1", "-0.10", "-0"]) assert.throws(() => usdToCents(input), /cannot be negative/);
  for (const input of ["1.001", "0.009", "1.000"]) assert.throws(() => usdToCents(input), /at most two decimal places/);
  for (const input of ["1.", ".5", "abc", "1e2", "1,00", " 1 ", "+1", "NaN"]) assert.throws(() => usdToCents(input), /digits and an optional decimal point/);
  for (const input of ["21474836.48", "21474837", "9".repeat(64)]) assert.throws(() => usdToCents(input), /maximum is USD 21,474,836.47/);
  assert.equal(usdToCents("0001.5"), 150);
});

test("API budget validation supplies named field errors and sanitizes unknown keys", () => {
  for (const [value, message] of [["1.00", /number of integer USD cents/], [1.5, /whole number/], [-1, /cannot be negative/], [2147483648, /maximum budget/], [null, /number of integer USD cents/]] as const) {
    const parsed = eventInput.safeParse({ ...event, budgetCents: value }); assert.ok(!parsed.success);
    const fields = validationFields(parsed.error);
    assert.equal(fields[0].field, "budgetCents"); assert.match(fields[0].message, message);
  }
  const parsed = eventInput.safeParse({ ...event, secret_input_key: "private-value" }); assert.ok(!parsed.success);
  assert.deepEqual(validationFields(parsed.error), [{ field: "request", message: "Remove unsupported fields from this request." }]);
  assert.ok(!JSON.stringify(validationFields(parsed.error)).includes("secret_input_key"));
});

test("API reservation conflict and client errors retain structured budget feedback", async () => {
  const fields = [{ field: "budgetCents", message: "The budget cannot be below reserved awards." }];
  const response = appErrorResponse(new AppError(409, "Budget conflict.", false, undefined, fields));
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).fields, fields);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).endsWith("/api/auth/csrf")
    ? Response.json({ csrf: "test-only" })
    : Response.json({ error: "Budget conflict.", fields }, { status: 409 });
  try {
    await assert.rejects(apiRequest("/api/event", "PUT", { ...event, budgetCents: 0 }), (error: unknown) => {
      assert.ok(error instanceof ApiError); assert.equal(error.status, 409); assert.deepEqual(error.fields, fields); return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
