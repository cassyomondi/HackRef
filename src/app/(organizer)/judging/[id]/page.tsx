import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentReview } from "@/components/assessment-review";
import { PageHeading } from "@/components/workspace-ui";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { listReviews } from "@/lib/evaluation/reviews";
import { requirePageOrganizer } from "@/lib/session";
import { uuidInput } from "@/lib/validation";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const organizer = await requirePageOrganizer();
  const id = uuidInput.safeParse((await params).id);
  if (!id.success) notFound();
  const reviews = await listReviews(getDatabase(), organizer.id, undefined, id.data).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  if (!reviews.length) notFound();
  return <><Link href="/judging" className="mb-5 inline-block text-xs text-teal-700">← Comparison grid</Link>
    <PageHeading eyebrow="EVIDENCE & HUMAN JUDGMENT" title={reviews[0].submissionName} description="Inspect the preserved AI draft and record your own accountable decision." />
    <AssessmentReview review={reviews[0]} />
  </>;
}
