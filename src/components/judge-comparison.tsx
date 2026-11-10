"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AllCommunityModule, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { ComparisonRow } from "@/lib/evaluation/comparison";

const modules = [AllCommunityModule];
const theme = themeQuartz.withParams({ accentColor: "#0f766e", fontFamily: "inherit", fontSize: 12, headerBackgroundColor: "#f8fafc", borderColor: "#e2e8f0", wrapperBorderRadius: 8 });
const missing = ({ value }: { value: unknown }) => value == null ? "—" : String(value);
function ReviewLink({ data }: ICellRendererParams<ComparisonRow>) {
  return data ? <Link href={data.reviewHref} className="font-semibold text-teal-800 underline">{data.assessmentId ? "Evidence & review" : "Submission & jobs"}</Link> : null;
}

export function JudgeComparison({ rows }: { rows: ComparisonRow[] }) {
  const grid = useRef<AgGridReact<ComparisonRow>>(null);
  const [search, setSearch] = useState("");
  const [rubricId, setRubricId] = useState("all");
  const [showAi, setShowAi] = useState(true);
  const [showCriteria, setShowCriteria] = useState(true);
  const rubrics = useMemo(() => Array.from(new Map(rows.filter((r) => r.rubricId).map((r) => [r.rubricId!, r.rubric])).entries()), [rows]);
  const displayed = useMemo(() => rows.filter((r) => rubricId === "all" || r.rubricId === rubricId), [rows, rubricId]);
  const columnDefs = useMemo<ColDef<ComparisonRow>[]>(() => {
    const criterionColumns = Array.from(new Map(displayed.flatMap((r) => r.criteria.map((c) => [`${r.rubricId}:${c.key}`, { ...c, rubricId: r.rubricId, rubric: r.rubric }] as const))).values());
    const columns: ColDef<ComparisonRow>[] = [
      { field: "project", headerName: "Project · open review", pinned: "left", minWidth: 180, cellRenderer: ({ data }: ICellRendererParams<ComparisonRow>) => data ? <Link href={data.reviewHref} className="font-semibold text-teal-800 underline">{data.project}{data.isDemo ? " · DEMO" : ""}</Link> : null },
      { field: "finalTotal", headerName: "Human final total", filter: "agNumberColumnFilter", valueFormatter: missing, cellStyle: { color: "#115e59", backgroundColor: "#f0fdfa", fontWeight: "600" } },
      { field: "aiTotal", headerName: "AI total (suggested)", filter: "agNumberColumnFilter", hide: !showAi, valueFormatter: missing, cellStyle: { color: "#92400e", backgroundColor: "#fffbeb" }, headerTooltip: "No total for incomplete AI scores. Suggested sorting never determines winners." },
      { field: "state", headerName: "Review state", minWidth: 200, cellStyle: ({ data }) => ({ color: data?.finalScores ? "#115e59" : "#92400e", fontWeight: "600" }) },
      { field: "team", minWidth: 150 },
      { field: "rubric", minWidth: 200 },
      { field: "commitSha", headerName: "Pinned SHA", minWidth: 160, tooltip: true },
      { field: "maximum", headerName: "Rubric maximum", filter: "agNumberColumnFilter", valueFormatter: missing },
      ...criterionColumns.flatMap((c): ColDef<ComparisonRow>[] => [
        { colId: `ai:${c.rubricId}:${c.key}`, headerName: `AI · ${c.label} / ${c.maxScore}`, headerTooltip: c.rubric, hide: !showAi || !showCriteria, filter: "agNumberColumnFilter", valueGetter: ({ data }) => data?.rubricId === c.rubricId ? data.aiScores[c.key] ?? null : null, valueFormatter: missing, cellStyle: { color: "#92400e", backgroundColor: "#fffbeb" } },
        { colId: `human:${c.rubricId}:${c.key}`, headerName: `Human · ${c.label} / ${c.maxScore}`, headerTooltip: c.rubric, hide: !showCriteria, filter: "agNumberColumnFilter", valueGetter: ({ data }) => data?.rubricId === c.rubricId ? data.finalScores?.[c.key] ?? null : null, valueFormatter: missing, cellStyle: { color: "#115e59", backgroundColor: "#f0fdfa" } },
      ]),
      { field: "coveragePercent", headerName: "Criteria with citations %", filter: "agNumberColumnFilter", valueFormatter: missing, headerTooltip: "Criteria with at least one collected citation / rubric criteria. Citations remain unverified static evidence, not proof of functionality or repository completeness." },
      { field: "scoredCriteria", headerName: "AI scored criteria", filter: "agNumberColumnFilter", valueFormatter: missing },
      { field: "collectedFiles", headerName: "Collected files", filter: "agNumberColumnFilter", valueFormatter: missing },
      { field: "omittedFiles", headerName: "Omitted files", filter: "agNumberColumnFilter", valueFormatter: missing },
      { field: "treeTruncated", headerName: "Tree truncated", valueFormatter: missing },
      { field: "jobStatus", headerName: "Evaluation" },
      { colId: "review", headerName: "Drill down", minWidth: 175, sortable: false, filter: false, cellRenderer: ReviewLink },
    ];
    return columns;
  }, [displayed, showAi, showCriteria]);
  return <div className="space-y-4 p-5 text-xs text-slate-600">
    <div className="flex flex-wrap items-end gap-4">
      <label className="min-w-48 flex-1">Search projects, teams or SHA<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" type="search" /></label>
      <label>Rubric snapshot<select value={rubricId} onChange={(e) => setRubricId(e.target.value)} className="mt-1 block max-w-72 rounded-lg border border-slate-300 p-2"><option value="all">All rubric versions</option>{rubrics.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} />AI suggestions</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={showCriteria} onChange={(e) => setShowCriteria(e.target.checked)} />Criterion columns</label>
      <button className="rounded border border-slate-300 px-3 py-2" onClick={() => { setSearch(""); setRubricId("all"); setShowAi(true); setShowCriteria(true); grid.current?.api.resetColumnState(); grid.current?.api.setFilterModel(null); }}>Reset view</button>
    </div>
    <p><span className="font-semibold text-amber-800">Amber: AI suggestions</span> · <span className="font-semibold text-teal-800">Teal: human-finalized scores</span>. A dash means unscored or unavailable. Sorting is exploratory and never selects an official winner. Compare totals within the same rubric snapshot.</p>
    <p>One row per project and rubric, using the latest AI run (including manual retries). Resize or drag headers, use column menus to filter, and Shift-click headers to sort by multiple columns. Horizontal scrolling keeps every criterion available on smaller screens.</p>
    <div className="h-[620px] min-w-0" aria-label="Judge comparison grid">
      <AgGridProvider modules={modules}><AgGridReact ref={grid} theme={theme} rowData={displayed} columnDefs={columnDefs} defaultColDef={{ sortable: true, filter: true, floatingFilter: true, resizable: true, minWidth: 140, flex: 1 }} quickFilterText={search} getRowId={({ data }) => data.id} pagination paginationPageSize={20} paginationPageSizeSelector={[20, 50, 100]} enableCellTextSelection tooltipShowDelay={250} /></AgGridProvider>
    </div>
    <details><summary className="cursor-pointer font-semibold text-teal-800">Accessible assessment links ({displayed.length})</summary><ul className="mt-2 space-y-2">{displayed.map((r) => <li key={r.id}><Link href={r.reviewHref} className="text-teal-800 underline">{r.project} · {r.rubric} · {r.state}</Link></li>)}</ul></details>
  </div>;
}
