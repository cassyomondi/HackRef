import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { evaluationRuns, rubricVersions, submissions } from "../db/schema";
import { AppError } from "./errors";
import { ownedEvent, ownedSubmission } from "./event-service";
import { resolveRepository, type GitHubFetch } from "./github";
import { queueInput, rubricInput, submissionInput } from "./validation";

export const PIPELINE_VERSION = "pass2-input-validation-v1";
export const LEASE_SECONDS = 60;

export async function queueEvaluation(
  db: Database,
  organizerId: string,
  input: unknown,
) {
  const data = queueInput.parse(input);
  const submission = await ownedSubmission(db, organizerId, data.submissionId);
  const [rubric] = await db
    .select()
    .from(rubricVersions)
    .where(
      and(
        eq(rubricVersions.id, data.rubricVersionId),
        eq(rubricVersions.eventId, submission.eventId),
      ),
    )
    .limit(1);
  if (!rubric)
    throw new AppError(404, "Rubric version not found for this event.");
  const idempotencyKey = `${PIPELINE_VERSION}:${submission.id}:${submission.commitSha}:${rubric.id}`;
  const [created] = await db
    .insert(evaluationRuns)
    .values({
      ...data,
      eventId: submission.eventId,
      idempotencyKey,
      evidenceVersion: PIPELINE_VERSION,
    })
    .onConflictDoNothing({ target: evaluationRuns.idempotencyKey })
    .returning();
  if (created) return { job: created, created: true };
  const [existing] = await db
    .select()
    .from(evaluationRuns)
    .where(eq(evaluationRuns.idempotencyKey, idempotencyKey));
  return { job: existing, created: false };
}

export async function ownedJob(
  db: Database,
  organizerId: string,
  jobId: string,
) {
  const event = await ownedEvent(db, organizerId);
  const [job] = await db
    .select()
    .from(evaluationRuns)
    .where(
      and(eq(evaluationRuns.id, jobId), eq(evaluationRuns.eventId, event.id)),
    )
    .limit(1);
  if (!job) throw new AppError(404, "Evaluation job not found.");
  return job;
}

export function publicJob(job: typeof evaluationRuns.$inferSelect) {
  return {
    id: job.id,
    submissionId: job.submissionId,
    rubricVersionId: job.rubricVersionId,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    lastError: job.lastError,
    result: job.result,
  };
}

export async function claimJob(db: Database) {
  return db.transaction(async (tx) => {
    // Exhausted abandoned jobs must become terminal even if no more work is queued.
    await tx.execute(
      sql`UPDATE evaluation_runs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, finished_at = now(), updated_at = now(), last_error = 'Worker lease expired after the final attempt.' WHERE status = 'running' AND lease_expires_at <= now() AND attempts >= max_attempts AND evidence_version = ${PIPELINE_VERSION}`,
    );
    const [candidate] = await tx
      .select()
      .from(evaluationRuns)
      .where(
        sql`${evaluationRuns.evidenceVersion} = ${PIPELINE_VERSION} AND ${evaluationRuns.attempts} < ${evaluationRuns.maxAttempts} AND ((${evaluationRuns.status} = 'queued' AND ${evaluationRuns.nextAttemptAt} <= now()) OR (${evaluationRuns.status} = 'running' AND ${evaluationRuns.leaseExpiresAt} <= now()))`,
      )
      .orderBy(evaluationRuns.nextAttemptAt, evaluationRuns.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [job] = await tx
      .update(evaluationRuns)
      .set({
        status: "running",
        attempts: candidate.attempts + 1,
        leaseToken: randomUUID(),
        leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'`,
        startedAt: sql`coalesce(${evaluationRuns.startedAt}, now())`,
        finishedAt: null,
        result: null,
      })
      .where(eq(evaluationRuns.id, candidate.id))
      .returning();
    return job;
  });
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

export async function completeJob(
  db: Database,
  job: ClaimedJob,
  result: Record<string, unknown>,
) {
  const rows = await db
    .update(evaluationRuns)
    .set({
      status: "completed",
      result,
      finishedAt: sql`now()`,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(evaluationRuns.id, job.id),
        eq(evaluationRuns.status, "running"),
        eq(evaluationRuns.leaseToken, job.leaseToken!),
        sql`${evaluationRuns.leaseExpiresAt} > now()`,
      ),
    )
    .returning({ id: evaluationRuns.id });
  return rows.length === 1;
}

export async function failJob(db: Database, job: ClaimedJob, error: unknown) {
  const retry =
    (!(error instanceof AppError) || error.retryable) &&
    job.attempts < job.maxAttempts;
  const message =
    error instanceof AppError
      ? error.message
      : "Input validation failed because a dependency was unavailable.";
  const rows = await db
    .update(evaluationRuns)
    .set({
      status: retry ? "queued" : "failed",
      lastError: message,
      finishedAt: retry ? null : sql`now()`,
      nextAttemptAt: sql`greatest(now() + ${5 * 2 ** (job.attempts - 1)} * interval '1 second', ${error instanceof AppError ? (error.retryAt?.toISOString() ?? null) : null}::timestamptz)`,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(evaluationRuns.id, job.id),
        eq(evaluationRuns.status, "running"),
        eq(evaluationRuns.leaseToken, job.leaseToken!),
        sql`${evaluationRuns.leaseExpiresAt} > now()`,
      ),
    )
    .returning({ id: evaluationRuns.id });
  return rows.length === 1;
}

export async function processJob(
  db: Database,
  job: ClaimedJob,
  fetcher?: GitHubFetch,
) {
  try {
    const [submission] = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.id, job.submissionId),
          eq(submissions.eventId, job.eventId),
        ),
      );
    const [rubric] = await db
      .select()
      .from(rubricVersions)
      .where(
        and(
          eq(rubricVersions.id, job.rubricVersionId),
          eq(rubricVersions.eventId, job.eventId),
        ),
      );
    if (!submission || !rubric)
      throw new AppError(422, "Pinned evaluation inputs are missing.");
    const validRubric = rubricInput.safeParse({
      title: rubric.title,
      criteria: rubric.criteria,
    });
    const validSubmission = submissionInput.safeParse({
      name: submission.name,
      teamName: submission.teamName,
      repositoryUrl: submission.repositoryUrl,
      repositoryOwner: submission.repositoryOwner,
      ref: "",
      claims: submission.claims,
      ownershipAttested: submission.ownershipAttested,
    });
    if (!validRubric.success || !validSubmission.success)
      throw new AppError(
        422,
        "Pinned rubric or explicit submission claims are incomplete.",
      );
    const resolved = await resolveRepository(
      submission.repositoryUrl,
      submission.commitSha,
      fetcher,
    );
    if (
      resolved.commitSha !== submission.commitSha ||
      resolved.githubRepositoryId !== submission.githubRepositoryId ||
      resolved.repositoryOwner !== submission.repositoryOwner
    )
      throw new AppError(
        422,
        "Pinned repository identity or commit no longer matches GitHub.",
      );
    return await completeJob(db, job, {
      kind: PIPELINE_VERSION,
      commitSha: submission.commitSha,
      rubricVersion: rubric.version,
      repositoryIdentity: "CONFIRMED_BY_GITHUB",
      claims: "NOT_EVALUATED",
      assessment: "NOT_EVALUATED",
      limitation:
        "Only public repository identity, commit availability and stored input structure were checked. No source code, project claims, rubric scores or AI assessments were evaluated.",
    });
  } catch (error) {
    await failJob(db, job, error);
    return false;
  }
}
