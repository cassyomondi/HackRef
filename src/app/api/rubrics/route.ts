import { getDatabase } from "@/db/client";
import { addRubric } from "@/lib/event-service";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    return json(
      {
        rubric: await addRubric(
          getDatabase(),
          organizer.id,
          await readJson(request),
        ),
      },
      201,
    );
  });
}
