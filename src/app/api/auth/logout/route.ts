import { getDatabase } from "@/db/client";
import { authConfig } from "@/lib/auth-config";
import { logout } from "@/lib/auth-service";
import { verifyCsrf } from "@/lib/csrf";
import { api, json } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return api(async () => {
    const session = await getSession();
    verifyCsrf(request.headers, session.csrf, authConfig().origin);
    await logout(getDatabase(), session.token);
    session.destroy();
    return json({ ok: true });
  });
}
