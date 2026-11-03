import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { evaluationRuns } from "@/db/schema";
import { ownedEvent } from "@/lib/event-service";
import { api, apiOrganizer, json, readJson } from "@/lib/http";
import { publicJob, queueEvaluation } from "@/lib/jobs";
import { uuidInput } from "@/lib/validation";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer();
    const db = getDatabase();
    const event = await ownedEvent(db, organizer.id);
    const submissionId = new URL(request.url).searchParams.get("submissionId");
    const jobs = await db
      .select()
      .from(evaluationRuns)
      .where(
        and(
          eq(evaluationRuns.eventId, event.id),
          submissionId
            ? eq(evaluationRuns.submissionId, uuidInput.parse(submissionId))
            : undefined,
        ),
      )
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(200);
    return json({ jobs: jobs.map(publicJob) });
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const result = await queueEvaluation(
      getDatabase(),
      organizer.id,
      await readJson(request),
    );
    return json(
      { job: publicJob(result.job), created: result.created },
      result.created ? 201 : 200,
    );
  });
}
