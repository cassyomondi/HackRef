import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { allocationInput, approvalInput, budgetCentsInput } from "../../src/lib/awards-validation";
import { centsToUsdInput, formatUsd, maskRecipient, MAX_CENTS, usdToCents } from "../../src/lib/money";

test("USD input converts decimal text to exact bounded integer cents", () => {
  for (const [text, cents] of [["0", 0], ["0.01", 1], ["12.5", 1250], ["125.51", 12551], ["21474836.47", MAX_CENTS]] as const) {
    assert.equal(usdToCents(text), cents);
    assert.equal(usdToCents(centsToUsdInput(cents)), cents);
  }
  for (const text of ["", "-1", "+1", "1e3", "1.001", "0.009", " 1.00 ", "NaN", "Infinity", "21,000", "21474836.48", "999999999999999999999"])
    assert.throws(() => usdToCents(text));
  assert.equal(formatUsd(12551), "USD 125.51");
  assert.equal(formatUsd(MAX_CENTS), "USD 21,474,836.47");
  assert.equal(formatUsd(-1), "USD −0.01");
  assert.equal(maskRecipient("recipient+awards@example.test"), "r•••@e•••");
});

test("financial schemas require bounded cents, explicit recipient confirmation and exact USD approval", () => {
  const input = { submissionId: "00000000-0000-4000-8000-000000000001", assessmentId: "00000000-0000-4000-8000-000000000002", title: "First prize", recipientEmail: "Recipient+prize@example.test", amountCents: 12551, currency: "USD", confirmRecipient: true };
  assert.equal(allocationInput.parse(input).recipientEmail, input.recipientEmail);
  for (const amountCents of [0, -1, 1.5, "12551", NaN, Infinity, MAX_CENTS + 1]) assert.equal(allocationInput.safeParse({ ...input, amountCents }).success, false);
  for (const budget of [-1, 0.5, MAX_CENTS + 1, "100"]) assert.equal(budgetCentsInput.safeParse(budget).success, false);
  assert.equal(budgetCentsInput.parse(0), 0);
  for (const recipientEmail of ["", "bad", "x@example.test\nBcc: x@example.test", `x${"a".repeat(250)}@example.test`]) assert.equal(allocationInput.safeParse({ ...input, recipientEmail }).success, false);
  for (const patch of [{ confirmRecipient: false }, { confirmRecipient: undefined }, { title: "x".repeat(121) }, { title: "a\nb" }, { currency: "EUR" }, { revision: 2 }, { paypal: true }]) assert.equal(allocationInput.safeParse({ ...input, ...patch }).success, false);
  const { confirmRecipient: _, ...terms } = input; void _;
  assert.equal(approvalInput.safeParse({ ...terms, revision: 1, confirm: true }).success, true);
  for (const patch of [{ confirm: false }, { confirm: undefined }, { revision: 0 }, { recipientEmail: undefined }]) assert.equal(approvalInput.safeParse({ ...terms, revision: 1, confirm: true, ...patch }).success, false);
});

test("approval paths remain isolated from payout dispatch and the application has no live PayPal host", async () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
  }
  for (const file of await files("src")) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /spikes\/paypal|https:\/\/api-m[.]paypal[.]com/, file);
    if (file !== "src/lib/paypal-sandbox.ts") assert.doesNotMatch(source, /api-m[.]sandbox[.]paypal[.]com|\/v1\/payments\/payouts/, file);
  }
  for (const file of ["src/lib/awards.ts", "src/lib/award-budget.ts", "src/app/api/awards/route.ts", "src/app/api/awards/[id]/approve/route.ts"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|child_process|\.insert\(payouts\)|\.update\(payouts\)/, file);
  }
});
