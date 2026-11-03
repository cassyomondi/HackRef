import type { SessionOptions } from "iron-session";
import { z } from "zod";

export const SESSION_SECONDS = 8 * 60 * 60;
export type SessionData = { token?: string; csrf?: string };

export function authConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const password = env.SESSION_PASSWORD;
  const parsed = z.url().safeParse(env.APP_ORIGIN);
  if (!password || password.length < 32 || !parsed.success) {
    throw new Error(
      "Set SESSION_PASSWORD (at least 32 random bytes) and APP_ORIGIN. See .env.example.",
    );
  }
  const url = new URL(parsed.data);
  const secure = url.protocol === "https:";
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== parsed.data ||
    (!secure &&
      (env.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  ) {
    throw new Error(
      "APP_ORIGIN must be an exact HTTPS origin; local HTTP is permitted only outside production.",
    );
  }
  const options: SessionOptions = {
    password,
    cookieName: secure ? "__Host-hackref" : "hackref-local",
    ttl: SESSION_SECONDS,
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_SECONDS,
    },
  };
  return { origin: url.origin, options };
}
