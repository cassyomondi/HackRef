import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { assessments, evaluationRuns, submissions } from "../../db/schema";
import { AppError } from "../errors";
import { ownedEvent } from "../event-service";
import { uuidInput } from "../validation";
import { MAX_MANUAL_RETRIES, retryIdentity, retryKey } from "./retry-identity";
import { AI_PIPELINE_VERSION } from "./versions";

export async function retryEvaluation(db: Database, organizerId: string, input: unknown) {
  const jobId = uuidInput.parse(input);
  const event = await ownedEvent(db, organizerId);
  return db.transaction(async (tx) => {
    // Serialize clicks on this parent. Never reset it or change its diagnostics.
    const [parent] = await tx.select().from(evaluationRuns)
      .where(and(eq(evaluationRuns.id, jobId), eq(evaluationRuns.eventId, event.id)))
      .for("update");
    if (!parent) throw new AppError(404, "Evaluation job not found.");
    if (parent.evidenceVersion !== AI_PIPELINE_VERSION || parent.status !== "failed" ||
        !parent.finishedAt || parent.leaseToken || parent.leaseExpiresAt)
      throw new AppError(409, "Only terminal failed AI evaluations can be retried.");
    const [assessment] = await tx.select({ id: assessments.id }).from(assessments)
      .where(eq(assessments.evaluationRunId, parent.id)).limit(1);
    if (assessment || parent.result?.assessment === "DRAFT" || parent.result?.assessmentId)
      throw new AppError(409, "This evaluation already published an assessment and cannot be retried.");

    const lineage = retryIdentity(parent.idempotencyKey);
    const rootJobId = lineage?.rootJobId ?? parent.id;
    const number = (lineage?.number ?? 0) + 1;
    if (number > MAX_MANUAL_RETRIES)
      throw new AppError(409, `The limit of ${MAX_MANUAL_RETRIES} manual retries for this evaluation has been reached.`);

    // Validate the bounded chain, including the original commit-bound identity.
    // No new repository resolution, moving reference or current rubric is used.
    let ancestor = parent;
    let remaining = number - 1;
    while (remaining > 0) {
      const link = retryIdentity(ancestor.idempotencyKey);
      if (!link || link.rootJobId !== rootJobId || link.number !== remaining)
        throw new AppError(409, "Evaluation retry history is inconsistent.");
      const [previous] = await tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, link.parentJobId));
      if (!previous || previous.eventId !== parent.eventId || previous.submissionId !== parent.submissionId ||
          previous.rubricVersionId !== parent.rubricVersionId || previous.evidenceVersion !== AI_PIPELINE_VERSION)
        throw new AppError(409, "Evaluation retry history is inconsistent.");
      ancestor = previous;
      remaining--;
    }
    const [snapshot] = await tx.select().from(submissions).where(and(eq(submissions.id, parent.submissionId), eq(submissions.eventId, parent.eventId)));
    if (!snapshot || ancestor.id !== rootJobId ||
        ancestor.idempotencyKey !== `${AI_PIPELINE_VERSION}:${parent.submissionId}:${snapshot.commitSha}:${parent.rubricVersionId}`)
      throw new AppError(409, "The original pinned evaluation identity is inconsistent.");

    const idempotencyKey = retryKey(rootJobId, number, parent.id);
    const [created] = await tx.insert(evaluationRuns).values({
      eventId: parent.eventId, submissionId: parent.submissionId, rubricVersionId: parent.rubricVersionId,
      evidenceVersion: AI_PIPELINE_VERSION, idempotencyKey,
      maxAttempts: parent.maxAttempts,
    }).onConflictDoNothing({ target: evaluationRuns.idempotencyKey }).returning();
    if (created) return { job: created, created: true };
    const [existing] = await tx.select().from(evaluationRuns).where(eq(evaluationRuns.idempotencyKey, idempotencyKey));
    return { job: existing, created: false };
  });
}
