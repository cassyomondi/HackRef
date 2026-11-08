import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { awards } from "../db/schema";

type Reader = Pick<Database, "select">;

// Call under the event row lock for any financial mutation. Approvals do not
// reserve the amount a second time: all allocations already reserve budget.
export async function committedAwardCents(db: Reader, eventId: string) {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${awards.amountCents}), 0)` })
    .from(awards).where(eq(awards.eventId, eventId));
  return Number(row.total);
}
