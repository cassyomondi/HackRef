import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { assessments, evaluationRuns, evidence, findings, rubricVersions, submissions } from "../../db/schema";
import { AppError } from "../errors";
import type { GitHubFetch } from "../github";
import { failJob, LEASE_SECONDS, type ClaimedJob } from "../jobs";
import { rubricInput, submissionInput } from "../validation";
import { AI_PIPELINE_VERSION, assessSource, geminiSettings, PROMPT_VERSION, type ModelTransport } from "./model";
import { collectSource, SOURCE_BUDGET, type SourceBundle } from "./source";
import { GeminiError } from "./provider-errors";
import { PROVIDER_SCHEMA_VERSION } from "./provider-schema";

function activeLease(job: ClaimedJob) {
  return and(eq(evaluationRuns.id, job.id), eq(evaluationRuns.evidenceVersion, AI_PIPELINE_VERSION), eq(evaluationRuns.status, "running"), eq(evaluationRuns.leaseToken, job.leaseToken!), sql`${evaluationRuns.leaseExpiresAt} > clock_timestamp()`);
}
export async function renewLease(db: Database, job: ClaimedJob) {
  const rows = await db.update(evaluationRuns).set({ leaseExpiresAt: sql`clock_timestamp() + ${LEASE_SECONDS} * interval '1 second'` }).where(activeLease(job)).returning({ id: evaluationRuns.id });
  return rows.length === 1;
}

// Publication is one short transaction. Row locking serializes publication with
// recovery, and the final clock/token predicate rolls back every artifact on loss.
export async function persistDraft(db: Database, job: ClaimedJob, source: SourceBundle, result: Awaited<ReturnType<typeof assessSource>>) {
  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(activeLease(job)).for("update");
      if (!locked) return false;
      if (source.runId !== job.id || source.files.some((f) => f.runId !== job.id || f.commitSha !== source.commitSha)) throw new AppError(422, "Source provenance does not match this evaluation run.");
      await tx.insert(evidence).values(source.files.map((file) => ({
        id: file.id, evaluationRunId: job.id, sourceUri: `${file.sourceUri}#L${file.startLine}-L${file.endLine}`,
        sourcePath: file.path, contentHash: file.contentHash, excerpt: file.excerpt,
        method: "static_analysis" as const, status: "UNVERIFIED" as const,
        limitations: `Commit ${file.commitSha}; blob ${file.blobSha}; collected lines ${file.startLine}-${file.endLine}; excerpt truncated: ${file.truncated}. Content provenance checked; functionality unverified.`,
      })));
      const rows = result.draft.criteria.flatMap((criterion) => criterion.findings.map((finding) => ({
        evaluationRunId: job.id, evidenceId: finding.citation.evidenceId, criterionKey: criterion.key,
        summary: `${finding.summary}\nCitation: ${finding.citation.path}:${finding.citation.startLine}-${finding.citation.endLine} at ${source.commitSha}.`,
        status: "UNVERIFIED" as const,
      })));
      if (rows.length) await tx.insert(findings).values(rows);
      const scores = Object.fromEntries(result.draft.criteria.filter((c) => c.suggestedScore !== null).map((c) => [c.key, c.suggestedScore! ]));
      const [assessment] = await tx.insert(assessments).values({
        evaluationRunId: job.id, eventId: job.eventId, submissionId: job.submissionId,
        version: 1, status: "draft", scores, rationale: result.draft.summary,
      }).returning({ id: assessments.id });
      const done = await tx.update(evaluationRuns).set({
        status: "completed", leaseToken: null, leaseExpiresAt: null, lastError: null,
        modelVersion: result.modelVersion, promptVersion: PROMPT_VERSION,
        finishedAt: sql`clock_timestamp()`,
        result: {
          kind: AI_PIPELINE_VERSION, assessment: "DRAFT", assessmentId: assessment.id,
          commitSha: source.commitSha, rubricVersionId: job.rubricVersionId,
          evidenceVersion: source.version, promptVersion: PROMPT_VERSION,
          modelVersion: result.modelVersion, requestedModel: result.requestedModel,
          providerSchemaVersion: result.providerSchemaVersion,
          inputHash: result.inputHash, inputBytes: result.inputBytes,
          sourceBudget: SOURCE_BUDGET, source, draft: result.draft,
          limitation: "Provisional static AI review for organizer review. No submitted code or tests were executed; no award or payment was authorized.",
        },
      }).where(activeLease(job)).returning({ id: evaluationRuns.id });
      if (!done.length) throw new AppError(409, "Worker lease expired before draft publication.");
      return true;
    });
  } catch (error) { if (error instanceof AppError && error.status === 409) return false; throw error; }
}

export async function processAiJob(
  db: Database, job: ClaimedJob, fetcher?: GitHubFetch,
  modelOptions?: { transport: ModelTransport; model: string },
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
  let renewing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let source: SourceBundle | undefined;
  let requestedModel: string | undefined;
  try {
    if (!await renewLease(db, job)) return false;
    timer = setInterval(() => {
      if (renewing) return;
      renewing = renewLease(db, job).then((ok) => { if (!ok) controller.abort(); }).catch(() => controller.abort()).finally(() => { renewing = undefined; });
    }, 10_000);
    const [submission] = await db.select().from(submissions).where(and(eq(submissions.id, job.submissionId), eq(submissions.eventId, job.eventId)));
    const [rubric] = await db.select().from(rubricVersions).where(and(eq(rubricVersions.id, job.rubricVersionId), eq(rubricVersions.eventId, job.eventId)));
    if (!submission || !rubric) throw new AppError(422, "Pinned evaluation inputs are missing.");
    const validRubric = rubricInput.safeParse({ title: rubric.title, criteria: rubric.criteria });
    const validSubmission = submissionInput.safeParse({ name: submission.name, teamName: submission.teamName, repositoryUrl: submission.repositoryUrl, repositoryOwner: submission.repositoryOwner, claims: submission.claims, ownershipAttested: submission.ownershipAttested });
    if (!validRubric.success || !validSubmission.success) throw new AppError(422, "Pinned rubric or submission claims are incomplete.");
    const model = modelOptions?.model ?? geminiSettings().model;
    requestedModel = model;
    source = await collectSource(submission, job.id, fetcher, signal);
    signal.throwIfAborted();
    const result = await assessSource(source, { ...validRubric.data, id: rubric.id, version: rubric.version }, submission.claims, { model, transport: modelOptions?.transport, signal });
    signal.throwIfAborted();
    if (timer) clearInterval(timer);
    await renewing;
    signal.throwIfAborted();
    return await persistDraft(db, job, source, result);
  } catch (error) {
    await failJob(db, job, error, {
      kind: AI_PIPELINE_VERSION, assessment: "NOT_EVALUATED", requestedModel,
      ...(error instanceof GeminiError ? { providerError: { code: error.code, status: error.providerStatus ?? null, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) } } : {}),
      providerSchemaVersion: PROVIDER_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION, ...(source ? { evidenceVersion: source.version, source } : {}),
      limitation: "This attempt did not publish an assessment or scores. Any collected source below is partial static evidence only; see the job error.",
    });
    return false;
  } finally { if (timer) clearInterval(timer); await renewing; }
}
