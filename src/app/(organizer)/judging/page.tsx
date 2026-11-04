import type { Metadata } from "next";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { AssessmentReview } from "@/components/assessment-review";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { listReviews } from "@/lib/evaluation/reviews";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Judging" };
export default async function Judging() {
  const organizer = await requirePageOrganizer();
  const reviews = await listReviews(getDatabase(), organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return [];
    throw error;
  });
  return <>
    <PageHeading eyebrow="ASSESS & REVIEW" title="Judging" description="Versioned criteria, cited evidence and provisional scores for human review." />
    <Card title="Draft assessments" subtitle="Latest 30 drafts · Refresh to load new assessments · No finalization or award actions">
      {reviews.length ? <div className="space-y-5 p-5">{reviews.map((review) => <AssessmentReview key={review.id} review={review} />)}</div> :
        <EmptyState icon="scale" title="Nothing ready for review" description="Queue an AI evaluation from a submission and start the worker. Completed draft assessments will appear here with citations and coverage limits." href="/submissions" linkLabel="View submissions" />}
    </Card>
  </>;
}
