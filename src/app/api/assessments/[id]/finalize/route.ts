import { getDatabase } from "@/db/client";
import { finalizeReview } from "@/lib/evaluation/finalize";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const result = await finalizeReview(getDatabase(), organizer.id, (await params).id, await readJson(request));
    return json(result, result.created ? 201 : 200);
  });
}
