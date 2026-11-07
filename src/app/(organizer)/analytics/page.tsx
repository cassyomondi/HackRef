import type { Metadata } from "next";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { AnalyticsStudio } from "@/components/analytics-studio";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { analyticsData } from "@/lib/evaluation/analytics";
import { listComparison } from "@/lib/evaluation/comparison";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics() {
  const organizer = await requirePageOrganizer();
  const rows = await listComparison(getDatabase(), organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return [];
    throw error;
  });
  const report = analyticsData(rows);
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim() || undefined;
  const hostname = new URL(process.env.APP_ORIGIN || "http://localhost:3000").hostname;
  const localTrial = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return <>
    <PageHeading eyebrow="COMPARE & UNDERSTAND" title="Analytics" description="Explore real submissions, human decisions and static evidence using AG Studio." />
    <div className="mb-5 grid gap-3 sm:grid-cols-3">{[
      ["Eligible submissions", report.submissionCount], ["Human-finalized assessments", report.humanCount], ["Complete AI suggestions", report.aiCount],
    ].map(([label, count]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-5 py-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{count}</p></div>)}</div>
    <div className="mb-5 space-y-2 rounded-xl border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-600">
      <p>Progress uses the latest run per real submission. Scores and evidence use the latest run for each project and immutable rubric snapshot. Demo fixtures are excluded. Compare like rubric versions; AI suggestions and human decisions remain separate.</p>
      {!report.scoredCriterionCount && <p>No criterion scores yet. Scores stay blank until an evaluation or human review assigns them.</p>}
      {!report.humanCount && <p>No human-finalized assessments yet. Complete human review in Judging to record final scores.</p>}
      {report.humanCount < 2 && <p>The human score distribution needs at least two human-finalized assessments.</p>}
      {report.aiCount < 2 && <p>The AI score distribution needs at least two complete AI drafts.</p>}
      {report.submissionCount === 1 && <p>Your one eligible submission is available in the report below.</p>}
      {!report.coverageCount && <p>No citation coverage records yet. Collected evidence will appear after an evaluation completes.</p>}
      <p>Evidence coverage measures criteria with citations, not verified functionality. Analytics never selects winners or initiates payments.</p>
      {!licenseKey && <p>AG Studio trial key is not configured. Local evaluation retains the vendor watermark and licence warnings. A Grid Enterprise key does not establish Studio entitlement.</p>}
    </div>
    <Card title="AG Studio · embedded analytics" subtitle="Interactive report editor · cross-filtering · real organizer-scoped data">
      {!report.submissionCount ? <EmptyState icon="chart" title="No real submission data yet" description="Register actual projects and run evaluations to explore your records here. Demo fixtures and fabricated scores are excluded." href="/submissions" linkLabel="View submissions" /> :
        !licenseKey && !localTrial ? <EmptyState icon="chart" title="AG Studio licence configuration required" description="Configure an AG Studio trial or production licence in the local AG_STUDIO_LICENSE_KEY environment setting, or use a loopback APP_ORIGIN for local evaluation. See docs/JUDGING_ANALYTICS_REPORT.md." /> :
        <AnalyticsStudio report={report} licenseKey={licenseKey} />}
    </Card>
  </>;
}
