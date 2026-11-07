import "server-only";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { assessments, auditEvents, evaluationRuns, rubricVersions } from "../../db/schema";
import { ownedEvent } from "../event-service";
import { AppError } from "../errors";
import { rubricInput, uuidInput } from "../validation";
import { draftSchema } from "./model";
import { validateHumanReview } from "./review-validation";
import { AI_PIPELINE_VERSION } from "./versions";

export async function finalizeReview(db: Database, organizerId: string, draftId: string, input: unknown) {
  uuidInput.parse(draftId);
  const event = await ownedEvent(db, organizerId);
  return db.transaction(async (tx) => {
    // One lock per source draft serializes both conflicting and identical requests.
    const [draft] = await tx.select().from(assessments).where(and(eq(assessments.id, draftId), eq(assessments.eventId, event.id))).for("update");
    if (!draft) throw new AppError(404, "Assessment not found.");
    const [job] = await tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, draft.evaluationRunId)).for("share");
    if (draft.status !== "draft" || !job || job.status !== "completed" || job.evidenceVersion !== AI_PIPELINE_VERSION || job.result?.assessmentId !== draft.id)
      throw new AppError(409, "Only a persisted, completed AI draft can be reviewed.");
    const [rubric] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, job.rubricVersionId));
    const ai = draftSchema.safeParse(job.result?.draft);
    if (!rubric || !ai.success) throw new AppError(409, "The draft or rubric is unavailable for review.");
    const decision = validateHumanReview(rubricInput.parse({ title: rubric.title, criteria: rubric.criteria }), ai.data, input);
    const [existing] = await tx.select().from(assessments).where(eq(assessments.sourceDraftId, draft.id));
    if (existing) {
      if (existing.finalizedBy === organizerId && isDeepStrictEqual(existing.scores, decision.scores) && isDeepStrictEqual(existing.criterionDecisions, decision.criterionDecisions) && existing.rationale === decision.rationale)
        return { assessment: existing, created: false };
      throw new AppError(409, "This draft already has an immutable human decision. Refresh to see it.");
    }
    const [assessment] = await tx.insert(assessments).values({
      eventId: draft.eventId, submissionId: draft.submissionId, evaluationRunId: draft.evaluationRunId,
      version: draft.version + 1, status: "finalized", sourceDraftId: draft.id, ...decision,
      finalizedBy: organizerId, finalizedAt: new Date(),
    }).returning();
    await tx.insert(auditEvents).values({
      eventId: event.id, actorId: organizerId, action: "assessment.finalized", entityType: "assessment", entityId: assessment.id,
      metadata: { sourceDraftId: draft.id, evaluationRunId: job.id, rubricVersionId: rubric.id, version: assessment.version, ...decision },
    });
    return { assessment, created: true };
  });
}
