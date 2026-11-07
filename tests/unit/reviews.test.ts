import assert from "node:assert/strict";
import { test } from "node:test";
import { validateHumanReview } from "../../src/lib/evaluation/review-validation";
import type { DraftOutput } from "../../src/lib/evaluation/model";
import { analyticsData } from "../../src/lib/evaluation/analytics";
import type { ComparisonRow } from "../../src/lib/evaluation/comparison";

const rubric = { title: "Pinned", criteria: [{ key: "quality", label: "Quality", maxScore: 5 }] };
const draft: DraftOutput = { summary: "AI suggestion", limitations: ["Static only"], criteria: [{ key: "quality", status: "UNVERIFIED", suggestedScore: 3, rationale: "Static source", uncertainty: "Runtime unknown", citations: [], findings: [] }] };
const input = { criteria: [{ key: "quality", action: "accept", score: 3 }], rationale: "Reviewed source and limitations.", confirm: true };

test("human review accepts exact suggestions but rejects forged identity, missing confirmation, nonfinite or invalid scores", () => {
  assert.deepEqual(validateHumanReview(rubric, draft, input).scores, { quality: 3 });
  for (const score of [-1, 6, NaN, Infinity, "3", null]) assert.throws(() => validateHumanReview(rubric, draft, { ...input, criteria: [{ ...input.criteria[0], score }] }));
  assert.throws(() => validateHumanReview(rubric, draft, { ...input, finalizedBy: "forged" }));
  assert.throws(() => validateHumanReview(rubric, draft, { ...input, confirm: false }));
  assert.throws(() => validateHumanReview(rubric, draft, { ...input, criteria: [{ ...input.criteria[0], score: 4 }] }));
  assert.deepEqual(validateHumanReview(rubric, draft, { ...input, criteria: [{ key: "quality", action: "override", score: 0, reason: "Explicit zero after checking the evidence gap." }] }).scores, { quality: 0 });
});

test("Studio data excludes demo records, deduplicates progress and preserves missing scores", () => {
  const base: ComparisonRow = { id: "run", submissionId: "project", project: "Project", team: "Team", commitSha: "a".repeat(40), isDemo: false, rubricId: "rubric", rubric: "Rubric v1", criteria: rubric.criteria, aiScores: {}, finalScores: null, aiTotal: null, finalTotal: null, maximum: 5, scoredCriteria: 0, citedCriteria: 0, coveragePercent: 0, collectedFiles: 3, omittedFiles: 2, treeTruncated: true, state: "AI draft · review required", jobStatus: "completed", reviewHref: "/judging/id", assessmentId: "draft" };
  const report = analyticsData([{ ...base, id: "latest", rubricId: "new-rubric" }, base, { ...base, submissionId: "demo", isDemo: true }]);
  assert.equal(report.submissionCount, 1); assert.equal(report.humanCount, 0); assert.equal(report.aiCount, 0);
  assert.ok(!report.initialState.pages.some((p) => p.id === "Score distributions"));
  const criteria = report.data.sources.find((s) => s.id === "criteria");
  assert.ok(criteria && "data" in criteria); assert.equal(criteria.data.length, 2);
  assert.equal(criteria.data[0].aiScore, null); assert.equal(criteria.data[0].humanScore, null);
  const empty = analyticsData([{ ...base, isDemo: true }]); assert.equal(empty.submissionCount, 0); assert.equal(empty.data.sources.length, 0);
});
