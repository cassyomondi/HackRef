import { getDatabase } from "@/db/client";
import { api, apiOrganizer, json, readJson } from "@/lib/http";
import { sendSandboxPayout } from "@/lib/payouts";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    const result = await sendSandboxPayout(getDatabase(), organizer.id, (await params).id, await readJson(request));
    return json({ payout: result.payout, created: result.created }, result.created ? 201 : 200);
  });
}
