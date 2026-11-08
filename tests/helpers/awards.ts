import type { Database } from "../../src/db/connection";
import { addRubric, registerSubmission } from "../../src/lib/event-service";
import { finalizeReview } from "../../src/lib/evaluation/finalize";
import { listReviews } from "../../src/lib/evaluation/reviews";
import { AI_PIPELINE_VERSION } from "../../src/lib/evaluation/versions";
import { claimJob, processJob, queueEvaluation } from "../../src/lib/jobs";
import { submissionFixture } from "./github";
import type { GitHubFetch } from "../../src/lib/github";
import { modelOptions } from "./model";
import { sourceFixture } from "./source";

export async function finalizedAwardProject(db: Database, organizerId: string, suffix: string) {
  const source = sourceFixture();
  const fetcher: GitHubFetch = async (input, init) => {
    if (new URL(String(input)).pathname === `/repos/octocat/award-${suffix}`)
      return Response.json({ id: 1296269, private: false, visibility: "public", full_name: `octocat/award-${suffix}`, owner: { login: "octocat" }, default_branch: "master" });
    return source(input, init);
  };
  const submission = await registerSubmission(db, organizerId, { ...submissionFixture, name: `Award project ${suffix}`, repositoryUrl: `https://github.com/octocat/award-${suffix}` }, fetcher);
  const rubric = await addRubric(db, organizerId, { title: `Award rubric ${suffix}`, criteria: [{ key: "quality", label: "Quality", maxScore: 10 }, { key: "clarity", label: "Clarity", maxScore: 5 }] });
  await queueEvaluation(db, organizerId, { submissionId: submission.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION);
  const job = await claimJob(db);
  if (!job) throw new Error("Expected fixture job.");
  await processJob(db, job, fetcher, modelOptions);
  const draft = (await listReviews(db, organizerId)).find((review) => review.jobId === job.id)!;
  const final = await finalizeReview(db, organizerId, draft.id, { criteria: [{ key: "quality", action: "accept", score: 4, reason: "" }, { key: "clarity", action: "override", score: 3, reason: "Human review of documentation establishes this explicit score." }], rationale: "I reviewed the pinned evidence and its static analysis limitations.", confirm: true });
  return { submission, draft, final: final.assessment };
}

export function allocationFor(project: Awaited<ReturnType<typeof finalizedAwardProject>>, title: string, amountCents = 12551) {
  return { submissionId: project.submission.id, assessmentId: project.final.id, title, amountCents, currency: "USD", recipientEmail: "Recipient+prize@example.test", confirmRecipient: true };
}

export function approvalFor(award: { submissionId: string; assessmentId: string; title: string; amountCents: number; currency: string; recipientEmail: string; revision: number }) {
  const { submissionId, assessmentId, title, amountCents, currency, recipientEmail, revision } = award;
  return { submissionId, assessmentId, title, amountCents, currency, recipientEmail, revision, confirm: true };
}
