import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { AnalyticsStudio } from "@/components/analytics-studio";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { ownedEvent } from "@/lib/event-service";
import { analyticsData } from "@/lib/evaluation/analytics";
import { listComparison } from "@/lib/evaluation/comparison";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics() {
  const organizer = await requirePageOrganizer();
  const db = getDatabase();
  const event = await ownedEvent(db, organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  const rows = event ? await listComparison(db, organizer.id) : [];
  const report = analyticsData(rows);
  // A changed event or data snapshot starts a fresh Studio instance; no stale selections carry over.
  const reportKey = createHash("sha256").update(JSON.stringify([organizer.id, event?.id, report.data])).digest("hex");
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim() || undefined;
  const hostname = new URL(process.env.APP_ORIGIN || "http://localhost:3000").hostname;
  const localTrial = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return <>
    <PageHeading eyebrow="JUDGING INSIGHTS" title="Analytics" description="Review progress, final scores and collected evidence for your event." />
    <details className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs leading-6 text-slate-600">
      <summary className="cursor-pointer font-semibold text-teal-900">How metrics are calculated</summary>
      <div className="mt-3 space-y-2">
      <p>Registered projects are counted once in your organizer-owned event. Demo events and demo submissions are excluded; the registry labels and includes them. The registry shows the latest 200 projects with its full count; analytics uses all eligible projects.</p>
      <p>Completed evaluations and human-finalized reviews use the latest evaluation run for each project and immutable rubric version, including retries. Historical attempts are not counted separately.</p>
      <p>Scores are percentages of their rubric maximum. Compare matching rubric versions; normalization does not make different rubrics equivalent. Equal scores remain ties. The highest finalized score is unavailable until a human review is complete.</p>
      <p>Teal means human-finalized scores; amber means AI suggestions. Criterion means exclude missing scores. Missing AI criteria remain unscored, never zero; incomplete AI totals are excluded.</p>
      <p>Chart and row selections filter the current report, including KPIs. A filtered-view notice identifies this scope; Clear all filters removes selections and page or widget filters on every report page. Filter state is session-only and is not restored from browser storage.</p>
      {!report.scoredCriterionCount && <p>No criterion scores yet. Scores stay blank until an evaluation or human review assigns them.</p>}
      {!report.humanCount && <p>No human-finalized assessments yet. Complete human review in Judging to record final scores.</p>}
      {!report.coverageCount && <p>No citation coverage records yet. Collected evidence will appear after an evaluation completes.</p>}
      <p>Evidence coverage measures criteria with citations, not verified functionality. Analytics never selects winners or initiates payments.</p>
      {!licenseKey && <p>AG Studio trial key is not configured. Local evaluation retains the vendor watermark and licence warnings. A Grid Enterprise key does not establish Studio entitlement.</p>}
      </div>
    </details>
    <Card title="Explore judging reports" subtitle={event ? `${event.name} · AG Studio · ${report.submissionCount} eligible projects` : "Native AG Studio analytics"}>
      {!report.submissionCount ? <EmptyState icon="chart" title="No real submission data yet" description="Register actual projects and run evaluations to explore your records here. Demo fixtures and fabricated scores are excluded." href="/submissions" linkLabel="View submissions" /> :
        !licenseKey && !localTrial ? <EmptyState icon="chart" title="AG Studio licence configuration required" description="Configure an AG Studio trial or production licence in the local AG_STUDIO_LICENSE_KEY environment setting, or use a loopback APP_ORIGIN for local evaluation. See docs/JUDGING_ANALYTICS_REPORT.md." /> :
        <AnalyticsStudio key={reportKey} report={report} licenseKey={licenseKey} />}
    </Card>
  </>;
}
