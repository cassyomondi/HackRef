import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { submissions } from "@/db/schema";
import { ownedEvent, registerSubmission } from "@/lib/event-service";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function GET() {
  return api(async () => {
    const organizer = await apiOrganizer();
    const db = getDatabase();
    const event = await ownedEvent(db, organizer.id);
    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.eventId, event.id))
      .orderBy(desc(submissions.createdAt))
      .limit(200);
    return json({ submissions: rows });
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    return json(
      {
        submission: await registerSubmission(
          getDatabase(),
          organizer.id,
          await readJson(request),
        ),
      },
      201,
    );
  });
}
