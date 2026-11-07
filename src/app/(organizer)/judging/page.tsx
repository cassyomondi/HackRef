import type { Metadata } from "next";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { JudgeComparison } from "@/components/judge-comparison";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { listComparison } from "@/lib/evaluation/comparison";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Judging" };
export default async function Judging() {
  const organizer = await requirePageOrganizer();
  const rows = await listComparison(getDatabase(), organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return [];
    throw error;
  });
  return <>
    <PageHeading eyebrow="ASSESS & REVIEW" title="Judging" description="Compare pinned projects, inspect cited AI drafts and finalize your human assessment." />
    <Card title="Judge comparison" subtitle="AG Grid · Organizer-scoped records · Refresh for the latest decisions">
      {rows.length ? <JudgeComparison rows={rows} /> :
        <EmptyState icon="scale" title="Nothing ready for review" description="Queue an AI evaluation from a submission and start the worker. Completed draft assessments will appear here with citations and coverage limits." href="/submissions" linkLabel="View submissions" />}
    </Card>
  </>;
}
