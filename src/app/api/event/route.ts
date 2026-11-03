import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { rubricVersions } from "@/db/schema";
import { ownedEvent, saveEvent } from "@/lib/event-service";
import { api, apiOrganizer, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function GET() {
  return api(async () => {
    const organizer = await apiOrganizer();
    const db = getDatabase();
    const event = await ownedEvent(db, organizer.id);
    const rubrics = await db
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.eventId, event.id))
      .orderBy(desc(rubricVersions.version));
    return json({ event, rubrics });
  });
}
export async function PUT(request: Request) {
  return api(async () => {
    const organizer = await apiOrganizer(request);
    return json({
      event: await saveEvent(
        getDatabase(),
        organizer.id,
        await readJson(request),
      ),
    });
  });
}
