"use client";

import dynamic from "next/dynamic";
import type { AnalyticsData } from "@/lib/evaluation/analytics";

const Studio = dynamic(() => import("./analytics-studio-runtime"), { ssr: false, loading: () => <p role="status" className="p-6 text-sm text-slate-500">Loading interactive reports…</p> });

export function AnalyticsStudio({ report, licenseKey, allowCustomization = false }: { report: AnalyticsData; licenseKey?: string; allowCustomization?: boolean }) {
  return <Studio report={report} licenseKey={licenseKey} allowCustomization={allowCustomization} />;
}
