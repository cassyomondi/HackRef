import { getDatabase } from "@/db/client";
import { api, apiOrganizer, json, readJson } from "@/lib/http";
import { reconcileSandboxPayout } from "@/lib/payouts";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    return json({ payout: await reconcileSandboxPayout(getDatabase(), organizer.id, (await params).id, await readJson(request)) });
  });
}
