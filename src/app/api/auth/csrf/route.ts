import { randomBytes } from "node:crypto";
import { api, json } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET() {
  return api(async () => {
    const session = await getSession();
    if (!session.csrf) {
      session.csrf = randomBytes(32).toString("hex");
      await session.save();
    }
    return json({ csrf: session.csrf });
  });
}
