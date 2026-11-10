"use client";

import { useRef, useState } from "react";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { enableStudioDevValidations, singleColumnLayout, studioTheme, type AgResponsiveLayoutBreakpoint, type AgStudioApi, type AgStudioMode } from "ag-studio";
import type { AnalyticsData } from "@/lib/evaluation/analytics";
import { clearAnalyticsFilters, hasAnalyticsFilters } from "@/lib/evaluation/analytics-state";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();
const theme = studioTheme.withParams({
  accentColor: "#0f766e", fontFamily: "Arial, sans-serif", studioMinWidth: 0, studioMinHeight: 0,
  studioCanvasMinWidth: 0, studioWidgetTitleFontSize: 15, studioWidgetTitleFontWeight: 600,
  studioWrapperBorderRadius: 12, studioCanvasBackgroundColor: "#f4f8f8",
  chartFontSize: 12, chartAxisLabelFontSize: 12, chartTextColor: "#334155",
  chartAxisLabelColor: "#475569", chartGridLineColor: "#edf2f4",
  chartPaletteFills1Color: "#0f766e", chartPaletteStrokes1Color: "#115e59",
  chartPaletteFills2Color: "#d97706", chartPaletteStrokes2Color: "#92400e",
  chartPaletteFills3Color: "#64748b", chartPaletteStrokes3Color: "#475569",
  chartPaletteFills4Color: "#5b8fa3", chartPaletteStrokes4Color: "#3b6575",
});
const responsiveLayoutBreakpoints: AgResponsiveLayoutBreakpoint[] = [{ maxWidth: 767, layout: singleColumnLayout }];

export default function AnalyticsStudioRuntime({ report, licenseKey, allowCustomization = false }: { report: AnalyticsData; licenseKey?: string; allowCustomization?: boolean }) {
  const studio = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [ready, setReady] = useState(false);
  const [selectedPage, setSelectedPage] = useState(report.initialState.selectedPageId);
  const [error, setError] = useState(false);
  const [filtered, setFiltered] = useState(() => hasAnalyticsFilters(report.initialState));
  return <div className="space-y-4 p-3 sm:p-5">
    <div role="group" aria-label="Analytics reports" className="flex flex-wrap gap-2">{report.initialState.pages.map((page) => <button key={page.id} aria-pressed={selectedPage === page.id} disabled={!ready} onClick={() => {
      const api = studio.current;
      if (api) api.setState({ ...api.getState(), selectedPageId: page.id });
    }} className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${selectedPage === page.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-600"}`}>{page.id}</button>)}</div>
    <p className="text-xs text-slate-600">Select chart bars or project rows to filter this report.</p>
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${filtered ? "border-amber-200 bg-amber-50 text-amber-900" : "border-teal-100 bg-teal-50/40 text-teal-900"}`}>
      <p role="status" aria-label="Analytics scope">{filtered ? "Filtered view · values reflect selected data, not all projects." : `All eligible projects · ${report.submissionCount} registered`}</p>
      <button type="button" disabled={!ready} onClick={() => { if (studio.current) studio.current.setState(clearAnalyticsFilters(studio.current.getState())); }} className="rounded-lg border border-current bg-white px-3 py-2 font-semibold disabled:opacity-50">Clear all filters</button>
      {allowCustomization && <button type="button" aria-pressed={mode === "edit"} disabled={!ready} onClick={() => setMode(mode === "view" ? "edit" : "view")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-teal-800 disabled:opacity-50">{mode === "view" ? "Customize report" : "Done customizing"}</button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-700">AG Studio could not render part of this report. Refresh to reload the saved database records.</p>}
    {mode === "edit" && <p className="text-xs text-slate-500">Open Compose or Data to add fields, or drag widgets to rearrange the report. Changes affect only this session and never alter judging records. On narrow screens, scroll horizontally to reach the editor panels.</p>}
    <div className={`h-[76dvh] max-h-[1000px] min-h-[560px] min-w-0 rounded-xl border border-slate-200 ${mode === "edit" ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"}`} role="region" tabIndex={0} aria-label="AG Studio embedded analytics">
      <div className={`h-full ${mode === "edit" ? "min-w-[900px]" : "min-w-0"}`}><AgStudioProvider licenseKey={licenseKey}><AgStudio style={{ width: "100%", height: "100%" }} theme={theme} responsiveLayoutBreakpoints={responsiveLayoutBreakpoints} data={report.data} initialState={report.initialState} mode={mode} onApiReady={({ api }) => { studio.current = api; }} onStudioReady={() => setReady(true)} onStateUpdated={({ api }) => { const state = api.getState(); setSelectedPage(state.selectedPageId); setFiltered(hasAnalyticsFilters(state)); }} onErrorRaised={() => setError(true)} /></AgStudioProvider></div>
    </div>
  </div>;
}
