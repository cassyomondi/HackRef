import type { AgBarChartFormat, AgDataSourcesDefinition, AgFieldDefinition, AgPageState, AgReportState, AgTitle, AgValueWidget } from "ag-studio";
import type { ComparisonRow } from "./comparison";

const widgetTitle = (text: string): AgTitle => ({ text, enabled: true, wrapping: true, typography: { fontSize: 15, fontWeight: "bold" }, color: "#0f172a" });
const gridStyle = { columnAutoSize: true, headerRow: { wrapText: true }, grandTotalRow: { enabled: false }, theme: { rowHeight: 40 } };
const chartFormat = (title: string, axis: string, showLegend = false): AgBarChartFormat => ({
  title: widgetTitle(title),
  style: { theme: { common: { legend: { enabled: showLegend, position: "bottom" } } }, custom: { categoryAxis: { label: { fontSize: 12, color: "#475569" } }, valueAxis: { title: { enabled: true, text: axis, fontSize: 11 }, label: { fontSize: 11, color: "#64748b" }, gridLine: { enabled: true, style: { stroke: "#edf2f4", strokeWidth: 1 } } } } },
});
const kpi = (title: string, field: string, aggregation: "sum" | "max"): AgValueWidget => ({
  type: "value", format: { crossFilter: "filter", title: widgetTitle(title), style: { typography: { fontSize: 32, fontWeight: "bold" }, color: "#115e59", verticalAlign: "center" } },
  dataMapping: { value: [{ id: `submissions.${field}`, aggregation }] },
});
const textFields = (fields: string[][]): AgFieldDefinition[] => fields.map(([id, name]) => ({ id, name, format: "textFormat" }));
const numberFields = (fields: string[][]): AgFieldDefinition[] => fields.map(([id, name]) => ({ id, name, format: "decimalFormat", blankValue: "—", formatOptions: { format: "0.#" } }));

// Only persisted, non-demo records enter Studio. Missing scores stay null.
export function analyticsData(rows: ComparisonRow[]) {
  const real = rows.filter((r) => !r.isDemo);
  const latest = Array.from(new Map(real.toReversed().map((r) => [r.submissionId, r])).values());
  const submissions = latest.map((r) => {
    const versions = real.filter((v) => v.submissionId === r.submissionId);
    const finals = versions.flatMap((v) => v.finalTotal == null || !v.maximum ? [] : [100 * v.finalTotal / v.maximum]);
    return { project: r.project, team: r.team, submissionId: r.submissionId, status: r.jobStatus, reviewState: r.state, count: 1,
      completed: versions.filter((v) => v.jobStatus === "completed").length,
      finalized: versions.filter((v) => v.finalTotal !== null).length,
      highest: finals.length ? Math.max(...finals) : null };
  });
  const coverage = real.filter((r) => r.coveragePercent !== null).map((r) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, citationPercent: r.coveragePercent, collectedFiles: r.collectedFiles, omittedFiles: r.omittedFiles, treeTruncated: String(r.treeTruncated) }));
  const criteria = real.flatMap((r) => r.criteria.map((c) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, criterion: `${r.rubric} · ${c.label}`, criterionLabel: c.label, aiScore: r.aiScores[c.key] ?? null, humanScore: r.finalScores?.[c.key] ?? null, maximum: c.maxScore, aiPercent: r.aiScores[c.key] == null ? null : 100 * r.aiScores[c.key] / c.maxScore, humanPercent: r.finalScores?.[c.key] == null ? null : 100 * r.finalScores[c.key] / c.maxScore })));
  const totals = real.map((r) => ({ project: r.project, rubric: r.rubric, rubricId: r.rubricId, aiPercent: r.aiTotal == null || !r.maximum ? null : 100 * r.aiTotal / r.maximum, humanPercent: r.finalTotal == null || !r.maximum ? null : 100 * r.finalTotal / r.maximum }));
  const humanTotals = totals.filter((r) => r.humanPercent !== null);
  const aiTotals = totals.filter((r) => r.aiPercent !== null);
  const data: AgDataSourcesDefinition = { sources: [
    { id: "submissions", name: "Projects · latest run per rubric", data: submissions, fields: [
      ...textFields([["project", "Project"], ["team", "Team"], ["submissionId", "Submission ID"], ["status", "Latest evaluation"], ["reviewState", "Latest human review"]]),
      ...numberFields([["count", "Registered projects"], ["completed", "Completed evaluations"], ["finalized", "Human-finalized reviews"], ["highest", "Highest finalized score (%)"]]),
    ] },
    { id: "coverage", name: "Static citation coverage · per rubric", data: coverage, fields: [
      ...textFields([["project", "Project"], ["rubric", "Rubric version"], ["rubricId", "Rubric ID"], ["treeTruncated", "Tree truncated"]]),
      ...numberFields([["citationPercent", "Criteria with citations (%)"], ["collectedFiles", "Collected files"], ["omittedFiles", "Omitted files"]]),
    ] },
    { id: "criteria", name: "Rubric criteria · AI and human separate", data: criteria, fields: [
      ...textFields([["project", "Project"], ["rubric", "Rubric version"], ["rubricId", "Rubric ID"], ["criterion", "Criterion · rubric version"], ["criterionLabel", "Criterion"]]),
      ...numberFields([["aiScore", "AI suggestion"], ["humanScore", "Human final"], ["maximum", "Maximum"], ["aiPercent", "AI suggestion (%)"], ["humanPercent", "Human final (%)"]]),
    ] },
    ...([{ id: "humanTotals", name: "Human-finalized totals", data: humanTotals }, { id: "totals", name: "Project scores · AI and human separate", data: totals.filter((r) => r.humanPercent !== null || r.aiPercent !== null) }]).map((source) => ({
      ...source, fields: [
        ...textFields([["project", "Project"], ["rubric", "Rubric version"], ["rubricId", "Rubric ID"]]),
        ...numberFields([["humanPercent", "Human final (%)"], ["aiPercent", "AI suggestion (%)"]]),
      ],
    })),
  ].filter((source) => source.data.length > 0) };
  const progress: AgPageState = {
    id: "Review progress",
    widgets: {
      registered: kpi("Registered projects", "count", "sum"),
      completed: kpi("Completed evaluations", "completed", "sum"),
      finalized: kpi("Human-finalized reviews", "finalized", "sum"),
      highest: kpi("Highest finalized score (%)", "highest", "max"),
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Submissions · select rows to filter") }, dataMapping: { cols: [{ id: "submissions.project" }, { id: "submissions.team" }, { id: "submissions.reviewState" }, { id: "submissions.status" }] } },
    },
    widgetLayout: { registered: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 5 }, completed: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 5 }, finalized: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 5 }, highest: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 5 }, records: { xTrack: 0, yTrack: 5, xSpan: 24, ySpan: 9 } },
  };
  // A status chart adds information only when projects have different review states.
  if (new Set(submissions.map((r) => r.reviewState)).size > 1) {
    progress.widgets!.progress = { type: "bar-chart-grouped", format: chartFormat("Reviews by status", "Projects"), dataMapping: { categoryKey: [{ id: "submissions.reviewState" }], valueKey: [{ id: "submissions.count", aggregation: "sum" }] } };
    progress.widgetLayout!.progress = { xTrack: 0, yTrack: 5, xSpan: 24, ySpan: 10 };
    progress.widgetLayout!.records = { xTrack: 0, yTrack: 15, xSpan: 24, ySpan: 9 };
  }
  const pages: AgPageState[] = [progress];
  if (humanTotals.length) pages.push({
    id: "Finalized leaderboard", widgets: {
      leaderboard: { type: "bar-chart-grouped", format: chartFormat("Finalized project scores · equal scores remain ties", "Human final · % of rubric maximum"), dataMapping: { categoryKey: [{ id: "humanTotals.project" }, { id: "humanTotals.rubric" }], valueKey: [{ id: "humanTotals.humanPercent", aggregation: "max" }] }, sort: [{ field: { id: "humanTotals.humanPercent", aggregation: "max" }, direction: "desc" }] },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Finalized scores by rubric · no automatic winners") }, dataMapping: { cols: [{ id: "humanTotals.project" }, { id: "humanTotals.rubric" }, { id: "humanTotals.humanPercent", aggregation: "max" }] }, sort: [{ field: { id: "humanTotals.humanPercent", aggregation: "max" }, direction: "desc" }] },
    }, widgetLayout: { leaderboard: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: Math.max(12, Math.min(24, humanTotals.length * 2 + 5)) }, records: { xTrack: 0, yTrack: Math.max(12, Math.min(24, humanTotals.length * 2 + 5)), xSpan: 24, ySpan: 9 } },
  });
  const leaderboard = pages.find((page) => page.id === "Finalized leaderboard")?.widgets?.leaderboard;
  if (leaderboard?.type === "bar-chart-grouped") leaderboard.format!.style!.theme!.bar = { series: { width: 28, label: { enabled: true, fontSize: 12 } } };
  if (criteria.some((r) => r.aiScore !== null || r.humanScore !== null)) pages.push({
    id: "Criterion comparisons", widgets: {
      comparison: { type: "bar-chart-grouped", format: chartFormat("Mean criterion score (%)", "Score · % of criterion maximum", true), dataMapping: { categoryKey: [{ id: "criteria.criterionLabel" }, { id: "criteria.rubric" }], valueKey: [{ id: "criteria.humanPercent", aggregation: "avg" }, { id: "criteria.aiPercent", aggregation: "avg" }] } },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Criterion scores · blanks are unscored") }, dataMapping: { cols: [{ id: "criteria.project" }, { id: "criteria.criterion" }, { id: "criteria.humanScore", aggregation: "avg" }, { id: "criteria.aiScore", aggregation: "avg" }, { id: "criteria.maximum", aggregation: "max" }] } },
    }, widgetLayout: { comparison: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: Math.max(14, new Set(criteria.map((r) => r.criterion)).size * 2 + 4) }, records: { xTrack: 0, yTrack: Math.max(14, new Set(criteria.map((r) => r.criterion)).size * 2 + 4), xSpan: 24, ySpan: 10 } },
  });
  // Categorical comparisons remain meaningful even with a single scored project.
  if (humanTotals.length || aiTotals.length) {
    pages.push({ id: "Project score comparison", widgets: {
      comparison: { type: "bar-chart-grouped", format: chartFormat("Project scores · human final and AI suggestion (%)", "Score · % of rubric maximum", true), dataMapping: { categoryKey: [{ id: "totals.project" }, { id: "totals.rubric" }], valueKey: [{ id: "totals.humanPercent", aggregation: "max" }, { id: "totals.aiPercent", aggregation: "max" }] }, sort: [{ field: { id: "totals.humanPercent", aggregation: "max" }, direction: "desc" }] },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Project score details · missing totals stay blank") }, dataMapping: { cols: [{ id: "totals.project" }, { id: "totals.rubric" }, { id: "totals.humanPercent", aggregation: "max" }, { id: "totals.aiPercent", aggregation: "max" }] } },
    }, widgetLayout: { comparison: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 14 }, records: { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 9 } } });
  }
  if (coverage.length) pages.push({
    id: "Evidence coverage", widgets: {
      coverage: { type: "bar-chart-grouped", format: chartFormat("Citation presence by project (%)", "Criteria with collected citations · %"), dataMapping: { categoryKey: [{ id: "coverage.project" }, { id: "coverage.rubric" }], valueKey: [{ id: "coverage.citationPercent", aggregation: "avg" }] } },
      records: { type: "grid", format: { style: gridStyle, title: widgetTitle("Collected evidence and omissions") }, dataMapping: { cols: [{ id: "coverage.project" }, { id: "coverage.rubric" }, { id: "coverage.citationPercent", aggregation: "avg" }, { id: "coverage.collectedFiles", aggregation: "max" }, { id: "coverage.omittedFiles", aggregation: "max" }, { id: "coverage.treeTruncated" }] } },
    }, widgetLayout: { coverage: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 }, records: { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 9 } },
  });
  for (const page of pages) page.layout = { minWidth: 0, columns: 24, rowHeight: 28, pagePadding: 16, widgetPadding: 20, widgetBorderEnabled: true, widgetBorderRadius: 12, widgetBorderColor: "#e2e8f0", widgetBorderWidth: 1, backgroundColor: "#f4f8f8", widgetBackgroundColor: "#ffffff" };
  const initialState: AgReportState = { pages, selectedPageId: pages[0].id, panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } } };
  return { data, initialState, submissionCount: submissions.length, humanCount: humanTotals.length, completedCount: real.filter((r) => r.jobStatus === "completed").length, scoredCriterionCount: criteria.filter((r) => r.aiScore !== null || r.humanScore !== null).length, aiCount: aiTotals.length, coverageCount: coverage.length };
}
export type AnalyticsData = ReturnType<typeof analyticsData>;
