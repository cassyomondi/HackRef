import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Card, PageHeading } from "@/components/workspace-ui";
import { JobPanel } from "@/components/job-panel";
import { getDatabase } from "@/db/client";
import { evaluationRuns, rubricVersions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ownedSubmission } from "@/lib/event-service";
import { publicJob } from "@/lib/jobs";
import { requirePageOrganizer } from "@/lib/session";
import { uuidInput } from "@/lib/validation";
import { listReviews } from "@/lib/evaluation/reviews";

export const metadata: Metadata = { title: "Submission details" };
export default async function SubmissionDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const organizer = await requirePageOrganizer();
  const id = uuidInput.safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDatabase();
  const submission = await ownedSubmission(db, organizer.id, id.data).catch(
    (error) => {
      if (error instanceof AppError && error.status === 404) notFound();
      throw error;
    },
  );
  const rubrics = await db
    .select()
    .from(rubricVersions)
    .where(eq(rubricVersions.eventId, submission.eventId))
    .orderBy(desc(rubricVersions.version));
  const jobs = await db
    .select()
    .from(evaluationRuns)
    .where(
      and(
        eq(evaluationRuns.submissionId, submission.id),
        eq(evaluationRuns.eventId, submission.eventId),
      ),
    )
    .orderBy(desc(evaluationRuns.createdAt))
    .limit(200);
  return (
    <>
      <Link
        href="/submissions"
        className="mb-5 inline-block text-xs text-teal-700"
      >
        ← All submissions
      </Link>
      <PageHeading
        eyebrow={submission.isDemo ? "DEMO SUBMISSION" : "PINNED SUBMISSION"}
        title={submission.name}
        description={`Submitted by ${submission.teamName}`}
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card title="Repository snapshot">
            <dl className="space-y-4 p-5 text-xs text-slate-600">
              <div>
                <dt className="mb-1 text-slate-400">Public repository</dt>
                <dd className="break-all">
                  <a
                    href={submission.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-teal-700 underline"
                  >
                    {submission.repositoryUrl}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-slate-400">Immutable commit</dt>
                <dd className="break-all">
                  <a
                    href={`${submission.repositoryUrl}/commit/${submission.commitSha}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-teal-700 underline"
                  >
                    {submission.commitSha}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-slate-400">
                  GitHub owner / repository ID
                </dt>
                <dd>
                  {submission.repositoryOwner ?? "Not recorded"} /{" "}
                  {submission.githubRepositoryId ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-slate-400">Submission authority</dt>
                <dd>
                  {submission.isDemo
                    ? "Demo fixture; no real submission authority is asserted."
                    : submission.ownershipAttested
                      ? "Organizer attested; GitHub account ownership was not independently verified."
                      : "No attestation recorded."}
                </dd>
              </div>
            </dl>
          </Card>
          <Card
            title="Explicit project claims"
            subtitle="Team statements · not evaluated"
          >
            <ol className="list-decimal space-y-3 py-5 pr-5 pl-10 text-xs leading-6 whitespace-pre-wrap text-slate-600">
              {submission.claims.map((claim, i) => (
                <li key={i}>{claim}</li>
              ))}
            </ol>
          </Card>
        </div>
        <Card
          title="Evaluation jobs"
          subtitle="Durable queue · status refreshes every 5 seconds"
        >
          <JobPanel
            submissionId={submission.id}
            rubrics={rubrics.map(({ id, title, version }) => ({
              id,
              title,
              version,
            }))}
            initialJobs={jobs.map(publicJob)}
            initialReviews={await listReviews(db, organizer.id, submission.id)}
          />
        </Card>
      </div>
    </>
  );
}
