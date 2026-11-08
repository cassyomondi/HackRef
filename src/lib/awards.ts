import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db/connection";
import { assessments, auditEvents, awardApprovals, awards, evaluationRuns, hackathonEvents, organizerUsers, payouts, rubricVersions, submissions } from "../db/schema";
import { allocationInput, approvalInput } from "./awards-validation";
import { committedAwardCents } from "./award-budget";
import { AppError } from "./errors";
import { maskRecipient } from "./money";
import { uuidInput } from "./validation";

type Reader = Pick<Database, "select">;

async function lockEvent(db: Reader, organizerId: string) {
  const [event] = await db.select().from(hackathonEvents)
    .where(eq(hackathonEvents.organizerId, organizerId)).for("update");
  if (!event) throw new AppError(404, "Set up your event first.");
  return event;
}

async function checkAssessment(db: Reader, organizerId: string, eventId: string, assessmentId: string, submissionId: string) {
  const [assessment] = await db.select().from(assessments).where(and(
    eq(assessments.id, assessmentId), eq(assessments.eventId, eventId), eq(assessments.submissionId, submissionId),
  )).for("share");
  if (!assessment) throw new AppError(404, "Assessment not found for this project and event.");
  if (assessment.status !== "finalized" || assessment.finalizedBy !== organizerId || !assessment.finalizedAt)
    throw new AppError(409, "Allocate only from an assessment finalized by this event's organizer.");
  return assessment;
}

export async function allocateAward(db: Database, organizerId: string, input: unknown) {
  const data = allocationInput.parse(input);
  return db.transaction(async (tx) => {
    // All budget writers take this same row lock before reading totals.
    const event = await lockEvent(tx, organizerId);
    await checkAssessment(tx, organizerId, event.id, data.assessmentId, data.submissionId);
    const existing = await tx.select().from(awards).where(eq(awards.eventId, event.id));
    if (existing.some((award) => award.submissionId === data.submissionId || award.title.toLowerCase() === data.title.toLowerCase()))
      throw new AppError(409, "An award already uses this project or title. Open the existing award; allocation does not replace it.");
    if (await committedAwardCents(tx, event.id) + data.amountCents > event.budgetCents)
      throw new AppError(409, "Insufficient unallocated prize budget. Update the event budget or reduce the amount before allocating.");
    const { confirmRecipient: _, ...terms } = data;
    void _;
    const [award] = await tx.insert(awards).values({ ...terms, eventId: event.id }).returning();
    await tx.insert(auditEvents).values({
      eventId: event.id, actorId: organizerId, action: "award.allocated", entityType: "award", entityId: award.id,
      metadata: { assessmentId: award.assessmentId, submissionId: award.submissionId, revision: award.revision, amountCents: award.amountCents, currency: award.currency },
    });
    return award;
  });
}

export async function approveAward(db: Database, organizerId: string, awardId: string, input: unknown) {
  uuidInput.parse(awardId);
  const data = approvalInput.parse(input);
  return db.transaction(async (tx) => {
    const event = await lockEvent(tx, organizerId);
    const [award] = await tx.select().from(awards).where(and(eq(awards.id, awardId), eq(awards.eventId, event.id))).for("update");
    if (!award) throw new AppError(404, "Award not found.");
    for (const key of ["revision", "title", "submissionId", "assessmentId", "amountCents", "currency", "recipientEmail"] as const) {
      if (award[key] !== data[key]) throw new AppError(409, "The confirmation does not match the immutable award terms. Refresh and review the award.");
    }
    await checkAssessment(tx, organizerId, event.id, award.assessmentId, award.submissionId);
    const total = await committedAwardCents(tx, event.id);
    if (total > event.budgetCents) throw new AppError(409, "The reserved award total exceeds the event budget. Increase the budget before approving.");
    const [existing] = await tx.select().from(awardApprovals).where(and(eq(awardApprovals.awardId, award.id), eq(awardApprovals.awardRevision, award.revision)));
    if (existing) {
      if (existing.approvedBy !== organizerId || existing.assessmentId !== data.assessmentId || existing.amountCents !== data.amountCents || existing.currency !== data.currency || existing.recipientEmail !== data.recipientEmail)
        throw new AppError(409, "This revision already has a different approval.");
      return { approval: existing, created: false };
    }
    const [approval] = await tx.insert(awardApprovals).values({
      awardId: award.id, awardRevision: award.revision, assessmentId: award.assessmentId,
      amountCents: award.amountCents, currency: award.currency, recipientEmail: award.recipientEmail, approvedBy: organizerId,
    }).returning();
    await tx.insert(auditEvents).values({
      eventId: event.id, actorId: organizerId, action: "award.approved", entityType: "award", entityId: award.id,
      // Recipient and free text never enter financial audit metadata.
      metadata: { approvalId: approval.id, revision: award.revision, assessmentId: award.assessmentId, submissionId: award.submissionId, amountCents: award.amountCents, currency: award.currency, budgetCents: event.budgetCents, reservedCents: total },
    });
    return { approval, created: true };
  });
}

export async function eligibleAssessments(db: Reader, organizerId: string, eventId: string) {
  const rows = await db.select({
    id: assessments.id, submissionId: submissions.id, project: submissions.name, team: submissions.teamName,
    scores: assessments.scores, version: assessments.version, sourceDraftId: assessments.sourceDraftId,
    finalizedAt: assessments.finalizedAt, reviewer: organizerUsers.displayName,
    rubricTitle: rubricVersions.title, rubricVersion: rubricVersions.version, criteria: rubricVersions.criteria,
    runId: evaluationRuns.id, modelVersion: evaluationRuns.modelVersion, commitSha: submissions.commitSha,
  }).from(assessments)
    .innerJoin(hackathonEvents, eq(hackathonEvents.id, assessments.eventId))
    .innerJoin(submissions, and(eq(submissions.id, assessments.submissionId), eq(submissions.eventId, assessments.eventId)))
    .innerJoin(evaluationRuns, eq(evaluationRuns.id, assessments.evaluationRunId))
    .innerJoin(rubricVersions, eq(rubricVersions.id, evaluationRuns.rubricVersionId))
    .innerJoin(organizerUsers, eq(organizerUsers.id, assessments.finalizedBy))
    .where(and(eq(assessments.eventId, eventId), eq(hackathonEvents.organizerId, organizerId), eq(assessments.status, "finalized"), eq(assessments.finalizedBy, organizerId), isNotNull(assessments.finalizedAt)))
    .orderBy(asc(submissions.name), asc(assessments.createdAt));
  return rows.map(({ scores, criteria, ...row }) => ({ ...row, finalScore: Object.values(scores).reduce((sum, value) => sum + value, 0), maxScore: criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) }));
}

export async function awardsWorkspace(db: Database, organizerId: string) {
  const [event] = await db.select().from(hackathonEvents).where(eq(hackathonEvents.organizerId, organizerId));
  if (!event) return null;
  const [eligible, rows] = await Promise.all([
    eligibleAssessments(db, organizerId, event.id),
    db.select({ award: awards, project: submissions.name, approvalId: awardApprovals.id, approvedAt: awardApprovals.approvedAt, payoutStatus: payouts.status })
      .from(awards).innerJoin(submissions, eq(submissions.id, awards.submissionId))
      .leftJoin(awardApprovals, and(eq(awardApprovals.awardId, awards.id), eq(awardApprovals.awardRevision, awards.revision)))
      .leftJoin(payouts, eq(payouts.awardId, awards.id))
      .where(eq(awards.eventId, event.id)).orderBy(asc(awards.createdAt)),
  ]);
  const register = rows.map(({ award: { recipientEmail, ...award }, ...rest }) => ({ ...award, ...rest, recipient: maskRecipient(recipientEmail) }));
  return { event, eligible, register, reservedCents: register.reduce((sum, row) => sum + row.amountCents, 0), approvedCents: register.reduce((sum, row) => sum + (row.approvalId ? row.amountCents : 0), 0) };
}

export async function awardPreview(db: Database, organizerId: string, awardId: string) {
  uuidInput.parse(awardId);
  const [row] = await db.select({ award: awards, event: hackathonEvents, project: submissions.name, approval: awardApprovals, approver: organizerUsers.displayName, payoutStatus: payouts.status, payout: payouts })
    .from(awards).innerJoin(hackathonEvents, eq(hackathonEvents.id, awards.eventId))
    .innerJoin(submissions, eq(submissions.id, awards.submissionId))
    .leftJoin(awardApprovals, and(eq(awardApprovals.awardId, awards.id), eq(awardApprovals.awardRevision, awards.revision)))
    .leftJoin(organizerUsers, eq(organizerUsers.id, awardApprovals.approvedBy))
    .leftJoin(payouts, eq(payouts.awardId, awards.id))
    .where(and(eq(awards.id, awardId), eq(hackathonEvents.organizerId, organizerId)));
  if (!row) throw new AppError(404, "Award not found.");
  const eligible = await eligibleAssessments(db, organizerId, row.event.id);
  const assessment = eligible.find((item) => item.id === row.award.assessmentId);
  const reservedCents = await committedAwardCents(db, row.event.id);
  return { ...row, assessment: assessment ?? null, reservedCents };
}
