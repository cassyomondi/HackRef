import { getDatabase } from "@/db/client";
import { ownedSubmission } from "@/lib/event-service";
import { api, apiOrganizer, json } from "@/lib/http";
import { uuidInput } from "@/lib/validation";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const organizer = await apiOrganizer();
    return json({
      submission: await ownedSubmission(
        getDatabase(),
        organizer.id,
        uuidInput.parse((await params).id),
      ),
    });
  });
}
