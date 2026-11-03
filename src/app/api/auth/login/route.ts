import { randomBytes } from "node:crypto";
import { getDatabase } from "@/db/client";
import { authConfig } from "@/lib/auth-config";
import { login, logout } from "@/lib/auth-service";
import { verifyCsrf } from "@/lib/csrf";
import { api, json, readJson } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    const session = await getSession();
    verifyCsrf(request.headers, session.csrf, authConfig().origin);
    const db = getDatabase();
    const token = await login(db, await readJson(request));
    await logout(db, session.token);
    session.token = token;
    session.csrf = randomBytes(32).toString("hex");
    await session.save();
    return json({ ok: true });
  });
}
