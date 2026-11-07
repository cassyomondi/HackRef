"use client";

import { useRef, useState } from "react";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { enableStudioDevValidations, singleColumnLayout, studioTheme, type AgResponsiveLayoutBreakpoint, type AgStudioApi, type AgStudioMode } from "ag-studio";
import type { AnalyticsData } from "@/lib/evaluation/analytics";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();
const theme = studioTheme.withParams({
  accentColor: "#0f766e", fontFamily: "Arial, sans-serif", studioMinWidth: 0, studioMinHeight: 0,
  studioCanvasMinWidth: 0, studioWidgetTitleFontSize: 14, studioWidgetTitleFontWeight: 600,
  studioWrapperBorderRadius: 10, studioCanvasBackgroundColor: "#f8fafb",
  chartPaletteFills1Color: "#0f766e", chartPaletteStrokes1Color: "#115e59",
  chartPaletteFills2Color: "#d97706", chartPaletteStrokes2Color: "#92400e",
});
const responsiveLayoutBreakpoints: AgResponsiveLayoutBreakpoint[] = [{ maxWidth: 767, layout: singleColumnLayout }];

export default function AnalyticsStudioRuntime({ report, licenseKey }: { report: AnalyticsData; licenseKey?: string }) {
  const studio = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [ready, setReady] = useState(false);
  const [selectedPage, setSelectedPage] = useState(report.initialState.selectedPageId);
  const [error, setError] = useState(false);
  return <div className="space-y-4 p-3 sm:p-5">
    <div role="group" aria-label="Analytics reports" className="flex flex-wrap gap-2">{report.initialState.pages.map((page) => <button key={page.id} aria-pressed={selectedPage === page.id} disabled={!ready} onClick={() => {
      const api = studio.current;
      if (api) api.setState({ ...api.getState(), selectedPageId: page.id });
    }} className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${selectedPage === page.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-600"}`}>{page.id}</button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600"><p>Select chart bars or table rows to filter related widgets. Switch to edit mode to arrange widgets and add fields. Report edits stay in this browser session.</p>
      <label>Studio mode<select className="ml-2 rounded border border-slate-300 bg-white p-2" value={mode} onChange={(e) => setMode(e.target.value as AgStudioMode)}><option value="edit">Edit report</option><option value="view">View & filter</option></select></label>
    </div>
    {error && <p role="alert" className="text-xs text-red-700">AG Studio could not render part of this report. Refresh to reload the saved database records.</p>}
    <p className="text-xs leading-5 text-slate-500">{selectedPage === "Criterion comparisons" ? "AI suggestions and human-finalized scores are separate series. Blank scores have not been assigned." : selectedPage === "Evidence coverage" ? "Citations describe collected static evidence. They do not verify functionality or complete repository coverage." : selectedPage === "Score distributions" ? "Distributions require at least two scored assessments of the same kind. Compare like rubric versions." : "Latest evaluation run per submission. Human review is required before any final decision."}</p>
    {mode === "edit" && <p className="text-xs text-slate-500">On narrow screens, scroll horizontally inside the editor to reach the canvas and field panels.</p>}
    <div className="h-[70dvh] max-h-[820px] min-h-[360px] min-w-0 overflow-auto rounded-xl border border-slate-200" role="region" tabIndex={0} aria-label="AG Studio embedded analytics">
      <div className={`h-full ${mode === "edit" ? "min-w-[900px]" : "min-w-0"}`}><AgStudioProvider licenseKey={licenseKey}><AgStudio style={{ width: "100%", height: "100%" }} theme={theme} responsiveLayoutBreakpoints={responsiveLayoutBreakpoints} data={report.data} initialState={report.initialState} mode={mode} onApiReady={({ api }) => { studio.current = api; }} onStudioReady={() => setReady(true)} onStateUpdated={({ api }) => setSelectedPage(api.getState().selectedPageId)} onErrorRaised={() => setError(true)} /></AgStudioProvider></div>
    </div>
  </div>;
}
