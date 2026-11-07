import assert from "node:assert/strict";
import { test } from "node:test";
import { criterionErrors, criterionKey, eventSlug, rubricPayload, slugError } from "../../src/lib/management-validation";
import { eventInput, rubricInput } from "../../src/lib/validation";

test("generated slugs and criterion keys meet the existing backend contract", () => {
  for (const name of ["Café & Code: 2026!", "  A---B___C  ", "2026 Quality", "x".repeat(160)]) {
    assert.ok(eventInput.shape.slug.safeParse(eventSlug(name)).success);
    assert.ok(rubricInput.shape.criteria.element.shape.key.safeParse(criterionKey(name)).success);
  }
  assert.equal(eventSlug("Café & Code: 2026!"), "cafe-code-2026");
  assert.equal(criterionKey("2026 Quality"), "criterion_2026_quality");
  assert.equal(eventSlug("!!!"), "");
  assert.equal(criterionKey("!!!"), "");
});

test("slug feedback covers missing values, characters, separators and the 80-character limit", () => {
  assert.match(slugError(""), /Enter an event slug/);
  for (const slug of ["Upper", "a_b", "a b", "-a", "a-", "a--b", " a", "a ", "é"]) assert.match(slugError(slug), /lowercase/);
  assert.match(slugError("a".repeat(81)), /80 characters/);
  assert.equal(slugError("a".repeat(80)), "");
  assert.equal(slugError("hackref-2026"), "");
});

test("rubric validation identifies duplicate keys and row-level label, key and score errors", () => {
  const row = { label: "Quality", key: "quality", maxScore: "10" };
  assert.deepEqual(criterionErrors(row, [row]), { label: "", key: "", maxScore: "" });
  assert.match(criterionErrors(row, [row, { ...row }]).key, /already used/);
  for (const key of ["", "Upper", "1quality", "key-with-hyphens", "x".repeat(41)]) assert.match(criterionErrors({ ...row, key }, []).key, /1–40 characters/);
  for (const label of ["", "  ", "x".repeat(121)]) assert.match(criterionErrors({ ...row, label }, []).label, /1–120/);
  for (const maxScore of ["", "0", "101", "1.5", "NaN", "Infinity"]) assert.match(criterionErrors({ ...row, maxScore }, []).maxScore, /whole number from 1 to 100/);
  for (const maxScore of ["1", "100"]) assert.equal(criterionErrors({ ...row, maxScore }, []).maxScore, "");
});

test("one publication payload contains all four ordered criteria and honors backend count bounds", () => {
  const rows = ["Quality", "Clarity", "Usability", "Originality"].map((label) => ({ label, key: criterionKey(label), maxScore: "10" }));
  const payload = rubricInput.parse(rubricPayload("Complete rubric", rows));
  assert.deepEqual(payload.criteria.map((c) => c.key), ["quality", "clarity", "usability", "originality"]);
  assert.equal(payload.criteria.reduce((sum, c) => sum + c.maxScore, 0), 40);
  assert.equal(rubricInput.safeParse(rubricPayload("Rubric", [])).success, false);
  const twenty = Array.from({ length: 20 }, (_, i) => ({ label: `Criterion ${i}`, key: `criterion_${i}`, maxScore: "100" }));
  assert.equal(rubricInput.safeParse(rubricPayload("Rubric", twenty)).success, true);
  assert.equal(rubricInput.safeParse(rubricPayload("Rubric", [...twenty, { label: "Extra", key: "extra", maxScore: "1" }])).success, false);
});
