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
  for (const reason of ["", "123456789", " ".repeat(10), "x".repeat(1201)])
    assert.throws(() => validateHumanReview(rubric, draft, { ...input, criteria: [{ key: "quality", action: "override", score: 4, reason }] }));
  for (const rationale of ["123456789", "x".repeat(4001)])
    assert.throws(() => validateHumanReview(rubric, draft, { ...input, rationale }));
  const unscored: DraftOutput = { ...draft, criteria: [{ ...draft.criteria[0], status: "NOT_EVALUATED", suggestedScore: null }] };
  assert.throws(() => validateHumanReview(rubric, unscored, { ...input, criteria: [{ key: "quality", action: "accept", score: 0 }] }));
  assert.throws(() => validateHumanReview(rubric, unscored, { ...input, criteria: [{ key: "quality", action: "override", score: 2, reason: "Too short" }] }));
  assert.deepEqual(validateHumanReview(rubric, unscored, { ...input, criteria: [{ key: "quality", action: "override", score: 2, reason: "Reviewed the evidence gap and assigned a limited score." }] }).scores, { quality: 2 });
});

test("Studio data excludes demo records, deduplicates progress and preserves missing scores", () => {
  const base: ComparisonRow = { id: "run", submissionId: "project", project: "Project", team: "Team", commitSha: "a".repeat(40), isDemo: false, rubricId: "rubric", rubric: "Rubric v1", criteria: rubric.criteria, aiScores: {}, finalScores: null, aiTotal: null, finalTotal: null, maximum: 5, scoredCriteria: 0, citedCriteria: 0, coveragePercent: 0, collectedFiles: 3, omittedFiles: 2, treeTruncated: true, state: "AI draft · review required", jobStatus: "completed", reviewHref: "/judging/id", assessmentId: "draft" };
  const report = analyticsData([{ ...base, id: "latest", rubricId: "new-rubric" }, base, { ...base, submissionId: "demo", isDemo: true }]);
  assert.equal(report.submissionCount, 1); assert.equal(report.humanCount, 0); assert.equal(report.aiCount, 0);
  assert.ok(!report.initialState.pages.some((p) => p.id === "Score distributions"));
  const criteria = report.data.sources.find((s) => s.id === "criteria");
  assert.ok(criteria && "data" in criteria); assert.equal(criteria.data.length, 2);
  assert.equal(criteria.data[0].aiScore, null); assert.equal(criteria.data[0].humanScore, null);
  assert.equal(criteria.data[0].aiPercent, null); assert.equal(criteria.data[0].humanPercent, null);
  const progress = report.initialState.pages[0];
  assert.equal(Object.values(progress.widgets!).filter((w) => w?.type === "value").length, 4);
  assert.ok(!Object.values(progress.widgets!).some((w) => w?.type === "bar-chart-grouped"), "A single review state needs no status bar chart");
  const empty = analyticsData([{ ...base, isDemo: true }]); assert.equal(empty.submissionCount, 0); assert.equal(empty.data.sources.length, 0);
});

test("Studio KPIs count projects once across rubric versions and tied finals remain equal without winners", () => {
  const base: ComparisonRow = { id: "run", submissionId: "one", project: "One", team: "Team", commitSha: "a".repeat(40), isDemo: false, rubricId: "v1", rubric: "Rubric v1", criteria: rubric.criteria, aiScores: {}, finalScores: { quality: 4 }, aiTotal: null, finalTotal: 4, maximum: 5, scoredCriteria: 0, citedCriteria: 0, coveragePercent: 0, collectedFiles: 3, omittedFiles: 2, treeTruncated: false, state: "Human finalized", jobStatus: "completed", reviewHref: "/judging/id", assessmentId: "draft" };
  const report = analyticsData([base, { ...base, id: "older-version", rubricId: "v0", rubric: "Rubric v0", aiScores: { quality: 0 }, aiTotal: 0 }, { ...base, id: "two", submissionId: "two", project: "Two" }, { ...base, id: "demo", submissionId: "demo", isDemo: true, finalTotal: 5 }]);
  assert.equal(report.submissionCount, 2); assert.equal(report.completedCount, 3); assert.equal(report.humanCount, 3);
  const projects = report.data.sources.find((s) => s.id === "submissions");
  assert.ok(projects && "data" in projects);
  assert.equal(projects.data.reduce((sum, r) => sum + r.finalized, 0), 3);
  assert.equal(Math.max(...projects.data.map((r) => r.highest)), 80);
  const finals = report.data.sources.find((s) => s.id === "humanTotals");
  assert.ok(finals && "data" in finals);
  assert.deepEqual(finals.data.map((r) => r.humanPercent), [80, 80, 80]);
  assert.deepEqual(finals.data.map((r) => r.rubricId), ["v1", "v0", "v1"]);
  assert.ok(finals.data.every((r) => !("winner" in r) && !("rank" in r)));
  const totals = report.data.sources.find((s) => s.id === "totals");
  assert.ok(totals && "data" in totals);
  assert.equal(totals.data[0].aiPercent, null); assert.equal(totals.data[1].aiPercent, 0, "Explicit zero remains a valid assigned score");
  const leaderboard = report.initialState.pages.find((p) => p.id === "Finalized leaderboard")!.widgets!.leaderboard!;
  assert.equal(leaderboard.type, "bar-chart-grouped");
  assert.deepEqual(leaderboard.sort, [{ field: { id: "humanTotals.humanPercent", aggregation: "max" }, direction: "desc" }]);
  assert.ok(report.initialState.pages.every((p) => Object.values(p.widgets!).every((w) => w?.type !== "histogram-chart")));
});
