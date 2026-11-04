import { getDatabase } from "@/db/client";
import { api, apiOrganizer, json } from "@/lib/http";
import { publicJob } from "@/lib/jobs";
import { retryEvaluation } from "@/lib/evaluation/retry";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const result = await retryEvaluation(getDatabase(), organizer.id, (await params).id);
    return json({ job: publicJob(result.job), created: result.created }, result.created ? 201 : 200);
  });
}
