import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { assessments, evaluationRuns, rubricVersions, submissions } from "../../db/schema";
import { ownedEvent } from "../event-service";
import { draftSchema } from "./model";
import type { SourceBundle } from "./source";
import { AI_PIPELINE_VERSION } from "./versions";

export type ComparisonRow = {
  id: string; submissionId: string; project: string; team: string; commitSha: string; isDemo: boolean;
  rubricId: string | null; rubric: string; criteria: Array<{ key: string; label: string; maxScore: number }>;
  aiScores: Record<string, number>; finalScores: Record<string, number> | null;
  aiTotal: number | null; finalTotal: number | null; maximum: number | null;
  scoredCriteria: number | null; citedCriteria: number | null; coveragePercent: number | null;
  collectedFiles: number | null; omittedFiles: number | null; treeTruncated: boolean | null;
  state: string; jobStatus: string; reviewHref: string; assessmentId: string | null;
};

export async function listComparison(db: Database, organizerId: string): Promise<ComparisonRow[]> {
  const event = await ownedEvent(db, organizerId);
  const [projects, jobs, records] = await Promise.all([
    db.select().from(submissions).where(eq(submissions.eventId, event.id)).orderBy(submissions.name),
    db.select({ job: evaluationRuns, rubric: rubricVersions }).from(evaluationRuns)
      .innerJoin(rubricVersions, eq(rubricVersions.id, evaluationRuns.rubricVersionId))
      .where(and(eq(evaluationRuns.eventId, event.id), eq(evaluationRuns.evidenceVersion, AI_PIPELINE_VERSION)))
      .orderBy(desc(evaluationRuns.createdAt), desc(evaluationRuns.id)),
    db.select().from(assessments).where(eq(assessments.eventId, event.id)),
  ]);
  return projects.flatMap<ComparisonRow>((project) => {
    const seen = new Set<string>();
    const latest = jobs.filter(({ job }) => {
      if (job.submissionId !== project.id || seen.has(job.rubricVersionId)) return false;
      seen.add(job.rubricVersionId); return true;
    });
    const base = { submissionId: project.id, project: project.name, team: project.teamName, commitSha: project.commitSha, isDemo: project.isDemo || event.isDemo };
    if (!latest.length) return [{ ...base, id: project.id, rubricId: null, rubric: "No AI evaluation", criteria: [], aiScores: {}, finalScores: null, aiTotal: null, finalTotal: null, maximum: null, scoredCriteria: null, citedCriteria: null, coveragePercent: null, collectedFiles: null, omittedFiles: null, treeTruncated: null, state: "Awaiting evaluation", jobStatus: "Not queued", reviewHref: `/submissions/${project.id}`, assessmentId: null }];
    return latest.map(({ job, rubric }) => {
      const draft = records.find((a) => a.evaluationRunId === job.id && a.status === "draft" && job.result?.assessmentId === a.id);
      const final = draft ? records.find((a) => a.sourceDraftId === draft.id) : undefined;
      const parsed = draftSchema.safeParse(job.result?.draft);
      const source = job.result?.source as SourceBundle | undefined;
      const criteria = rubric.criteria;
      const aiScores = draft?.scores ?? {};
      const scored = parsed.success ? parsed.data.criteria.filter((c) => c.suggestedScore !== null).length : null;
      const cited = parsed.success ? parsed.data.criteria.filter((c) => c.citations.length > 0).length : null;
      return {
        ...base, id: job.id, rubricId: rubric.id, rubric: `${rubric.title} · v${rubric.version}`, criteria,
        aiScores, finalScores: final?.scores ?? null,
        // A partial AI draft has no total: missing criteria are never zero-filled.
        aiTotal: scored === criteria.length ? Object.values(aiScores).reduce((s, n) => s + n, 0) : null,
        finalTotal: final ? Object.values(final.scores).reduce((s, n) => s + n, 0) : null,
        maximum: criteria.reduce((s, c) => s + c.maxScore, 0), scoredCriteria: scored, citedCriteria: cited,
        coveragePercent: cited === null ? null : Math.round(100 * cited / criteria.length),
        collectedFiles: source?.files.length ?? null, omittedFiles: source?.coverage.omittedCount ?? null,
        treeTruncated: source?.coverage.treeTruncated ?? null,
        state: final ? "Human finalized" : draft ? "AI draft · review required" : "No assessment",
        jobStatus: job.status, reviewHref: draft ? `/judging/${draft.id}` : `/submissions/${project.id}`, assessmentId: draft?.id ?? null,
      };
    });
  });
}
