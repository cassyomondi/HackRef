import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { assessments, evaluationRuns, evidence, findings, rubricVersions, submissions } from "../../db/schema";
import { ownedEvent } from "../event-service";
import { draftSchema } from "./model";
import type { SourceBundle } from "./source";
import { AI_PIPELINE_VERSION } from "./versions";

export async function listReviews(db: Database, organizerId: string, submissionId?: string) {
  const event = await ownedEvent(db, organizerId);
  const rows = await db.select({ assessment: assessments, job: evaluationRuns, rubric: rubricVersions, submission: submissions })
    .from(assessments)
    .innerJoin(evaluationRuns, eq(evaluationRuns.id, assessments.evaluationRunId))
    .innerJoin(rubricVersions, eq(rubricVersions.id, evaluationRuns.rubricVersionId))
    .innerJoin(submissions, eq(submissions.id, assessments.submissionId))
    .where(and(eq(assessments.eventId, event.id), eq(assessments.status, "draft"), eq(evaluationRuns.status, "completed"), eq(evaluationRuns.evidenceVersion, AI_PIPELINE_VERSION), submissionId ? eq(assessments.submissionId, submissionId) : undefined))
    .orderBy(desc(assessments.createdAt)).limit(30);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.job.id);
  const [collected, storedFindings] = await Promise.all([
    db.select().from(evidence).where(inArray(evidence.evaluationRunId, ids)),
    db.select().from(findings).where(inArray(findings.evaluationRunId, ids)),
  ]);
  return rows.flatMap(({ assessment, job, rubric, submission }) => {
    const parsed = draftSchema.safeParse(job.result?.draft);
    const source = job.result?.source as SourceBundle | undefined;
    if (!parsed.success || !source || source.runId !== job.id) return [];
    return [{
      id: assessment.id, jobId: job.id, submissionId: submission.id, submissionName: submission.name,
      rubric: { id: rubric.id, title: rubric.title, version: rubric.version, criteria: rubric.criteria },
      scores: assessment.scores, rationale: assessment.rationale, draft: parsed.data,
      modelVersion: job.modelVersion, promptVersion: job.promptVersion, evidenceVersion: source.version,
      commitSha: source.commitSha, coverage: source.coverage, checks: source.checks,
      evidence: collected.filter((e) => e.evaluationRunId === job.id).map((e) => ({
        id: e.id, path: e.sourcePath, sourceUri: e.sourceUri, contentHash: e.contentHash,
        excerpt: e.excerpt, limitations: e.limitations,
        startLine: source.files.find((f) => f.id === e.id)?.startLine ?? 1,
      })),
      findings: storedFindings.filter((f) => f.evaluationRunId === job.id).map(({ id, criterionKey, summary, status, evidenceId }) => ({ id, criterionKey, summary, status, evidenceId })),
    }];
  });
}
export type Review = Awaited<ReturnType<typeof listReviews>>[number];
