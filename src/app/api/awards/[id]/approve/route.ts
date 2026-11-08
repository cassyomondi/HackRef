import { getDatabase } from "@/db/client";
import { approveAward } from "@/lib/awards";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const result = await approveAward(getDatabase(), organizer.id, (await params).id, await readJson(request));
    return json({ approvalId: result.approval.id, created: result.created }, result.created ? 201 : 200);
  });
}
