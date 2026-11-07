import type { AgDataSourcesDefinition, AgFieldDefinition, AgPageState, AgReportState, AgTitle } from "ag-studio";
import type { ComparisonRow } from "./comparison";

const widgetTitle = (text: string): AgTitle => ({ text, enabled: true, wrapping: true, typography: { fontSize: 14, fontWeight: "bold" }, color: "#0f172a" });
const gridStyle = { columnAutoSize: true, headerRow: { wrapText: true }, theme: { rowHeight: 38 } };

// Only persisted, non-demo records enter Studio. Missing scores stay null.
export function analyticsData(rows: ComparisonRow[]) {
  const real = rows.filter((r) => !r.isDemo);
  const latest = Array.from(new Map(real.toReversed().map((r) => [r.submissionId, r])).values());
  const submissions = latest.map((r) => ({ project: r.project, team: r.team, submissionId: r.submissionId, status: r.jobStatus, reviewState: r.state, count: 1 }));
  const coverage = real.filter((r) => r.coveragePercent !== null).map((r) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, citationPercent: r.coveragePercent, collectedFiles: r.collectedFiles, omittedFiles: r.omittedFiles, treeTruncated: String(r.treeTruncated) }));
  const criteria = real.flatMap((r) => r.criteria.map((c) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, criterion: `${r.rubric} · ${c.label}`, aiScore: r.aiScores[c.key] ?? null, humanScore: r.finalScores?.[c.key] ?? null, maximum: c.maxScore, aiPercent: r.aiScores[c.key] == null ? null : 100 * r.aiScores[c.key] / c.maxScore, humanPercent: r.finalScores?.[c.key] == null ? null : 100 * r.finalScores[c.key] / c.maxScore })));
  const totals = real.map((r) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, aiPercent: r.aiTotal == null || !r.maximum ? null : 100 * r.aiTotal / r.maximum, humanPercent: r.finalTotal == null || !r.maximum ? null : 100 * r.finalTotal / r.maximum }));
  const humanTotals = totals.filter((r) => r.humanPercent !== null);
  const aiTotals = totals.filter((r) => r.aiPercent !== null);
  const data: AgDataSourcesDefinition = { sources: [
    { id: "submissions", name: "Submissions · latest AI run", data: submissions, fields: [
      ...[["project", "Project"], ["team", "Team"], ["submissionId", "Submission ID"], ["status", "Evaluation status"], ["reviewState", "Human review"]].map(([id, name]): AgFieldDefinition => ({ id, name, format: "textFormat" })),
      { id: "count", name: "Submissions", format: "decimalFormat" as const },
    ] },
    { id: "coverage", name: "Static citation coverage · per rubric", data: coverage, fields: [
      ...[["project", "Project"], ["rubric", "Rubric version"], ["rubricId", "Rubric ID"], ["treeTruncated", "Tree truncated"]].map(([id, name]): AgFieldDefinition => ({ id, name, format: "textFormat" })),
      ...[["citationPercent", "Criteria with citations (%)"], ["collectedFiles", "Collected files"], ["omittedFiles", "Omitted files"]].map(([id, name]): AgFieldDefinition => ({ id, name, format: "decimalFormat" })),
    ] },
    { id: "criteria", name: "Rubric criteria · AI and human separate", data: criteria, fields: [
      ...[["project", "Project"], ["rubric", "Rubric version"], ["rubricId", "Rubric ID"], ["criterion", "Criterion · rubric version"]].map(([id, name]): AgFieldDefinition => ({ id, name, format: "textFormat" })),
      ...[["aiScore", "AI suggestion"], ["humanScore", "Human final"], ["maximum", "Maximum"], ["aiPercent", "AI suggestion (%)"], ["humanPercent", "Human final (%)"]].map(([id, name]): AgFieldDefinition => ({ id, name, format: "decimalFormat" })),
    ] },
    { id: "humanTotals", name: "Human-finalized totals · percent of rubric", data: humanTotals },
    { id: "aiTotals", name: "Complete AI suggestions · percent of rubric", data: aiTotals },
  ].filter((source) => source.data.length > 0) };
  const pages: AgPageState[] = [{
    id: "Review progress",
    widgets: {
      progress: { type: "column-chart-grouped", format: { title: widgetTitle("Human review progress") }, dataMapping: { categoryKey: [{ id: "submissions.reviewState" }], valueKey: [{ id: "submissions.count", aggregation: "sum" }] } },
      status: { type: "column-chart-grouped", format: { title: widgetTitle("Evaluation status") }, dataMapping: { categoryKey: [{ id: "submissions.status" }], valueKey: [{ id: "submissions.count", aggregation: "sum" }] } },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Submissions · select rows to filter") }, dataMapping: { cols: [{ id: "submissions.project" }, { id: "submissions.team" }, { id: "submissions.reviewState" }, { id: "submissions.status" }] } },
    },
    widgetLayout: { progress: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 12 }, status: { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 12 }, records: { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 8 } },
  }];
  if (criteria.some((r) => r.aiScore !== null || r.humanScore !== null)) pages.push({
    id: "Criterion comparisons", widgets: {
      comparison: { type: "column-chart-grouped", format: { title: widgetTitle("Mean criterion score (%)") }, dataMapping: { categoryKey: [{ id: "criteria.criterion" }], valueKey: [{ id: "criteria.aiPercent", aggregation: "avg" }, { id: "criteria.humanPercent", aggregation: "avg" }] } },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Criterion scores · blanks are unscored") }, dataMapping: { cols: [{ id: "criteria.project" }, { id: "criteria.criterion" }, { id: "criteria.aiScore", aggregation: "avg" }, { id: "criteria.humanScore", aggregation: "avg" }, { id: "criteria.maximum", aggregation: "max" }] } },
    }, widgetLayout: { comparison: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 }, records: { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 8 } },
  });
  if (humanTotals.length >= 2 || aiTotals.length >= 2) {
    const widgets: NonNullable<AgPageState["widgets"]> = {};
    const widgetLayout: NonNullable<AgPageState["widgetLayout"]> = {};
    for (const [id, source, field, label] of [
      ["human", "humanTotals", "humanPercent", "Human-finalized scores (%)"],
      ["ai", "aiTotals", "aiPercent", "AI suggestions (%) · provisional"],
    ]) {
      if ((id === "human" ? humanTotals : aiTotals).length < 2) continue;
      widgets[id] = { type: "histogram-chart", format: { title: widgetTitle(label) }, dataMapping: { categoryKey: [{ id: `${source}.${field}` }] } };
      widgetLayout[id] = { xTrack: 0, yTrack: Object.keys(widgetLayout).length * 12, xSpan: 24, ySpan: 12 };
    }
    pages.push({ id: "Score distributions", widgets, widgetLayout });
  }
  if (coverage.length) pages.push({
    id: "Evidence coverage", widgets: {
      coverage: { type: "column-chart-grouped", format: { title: widgetTitle("Criteria with citations (%)") }, dataMapping: { categoryKey: [{ id: "coverage.project" }, { id: "coverage.rubric" }], valueKey: [{ id: "coverage.citationPercent", aggregation: "avg" }] } },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Collected evidence and omissions") }, dataMapping: { cols: [{ id: "coverage.project" }, { id: "coverage.rubric" }, { id: "coverage.collectedFiles", aggregation: "max" }, { id: "coverage.omittedFiles", aggregation: "max" }, { id: "coverage.treeTruncated" }] } },
    }, widgetLayout: { coverage: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 }, records: { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 8 } },
  });
  // Explicit track sizes keep titles and plots readable; native responsive layout stacks them in view mode.
  for (const page of pages) page.layout = { minWidth: 0, columns: 24, rowHeight: 28, pagePadding: 12, widgetPadding: 16, widgetBorderEnabled: true, widgetBorderRadius: 10, widgetBorderColor: "#e2e8f0", widgetBorderWidth: 1, backgroundColor: "#f8fafb", widgetBackgroundColor: "#ffffff" };
  const initialState: AgReportState = { pages, selectedPageId: pages[0].id, panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } } };
  return { data, initialState, submissionCount: submissions.length, humanCount: humanTotals.length, scoredCriterionCount: criteria.filter((r) => r.aiScore !== null || r.humanScore !== null).length, aiCount: aiTotals.length, coverageCount: coverage.length };
}
export type AnalyticsData = ReturnType<typeof analyticsData>;
