"use client";

import dynamic from "next/dynamic";
import type { AnalyticsData } from "@/lib/evaluation/analytics";

const Studio = dynamic(() => import("./analytics-studio-runtime"), { ssr: false, loading: () => <p role="status" className="p-6 text-sm text-slate-500">Loading AG Studio editor…</p> });

export function AnalyticsStudio({ report, licenseKey }: { report: AnalyticsData; licenseKey?: string }) {
  return <Studio report={report} licenseKey={licenseKey} />;
}
