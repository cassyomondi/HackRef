import { getDatabase } from "@/db/client";
import { allocateAward } from "@/lib/awards";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const award = await allocateAward(getDatabase(), organizer.id, await readJson(request));
    return json({ awardId: award.id }, 201);
  });
}
