import { getDatabase } from "@/db/client";
import { api, apiOrganizer, json } from "@/lib/http";
import { ownedJob, publicJob } from "@/lib/jobs";
import { uuidInput } from "@/lib/validation";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const organizer = await apiOrganizer();
    return json({
      job: publicJob(
        await ownedJob(
          getDatabase(),
          organizer.id,
          uuidInput.parse((await params).id),
        ),
      ),
    });
  });
}
