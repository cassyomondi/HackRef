import "server-only";
import { ZodError } from "zod";
import { getDatabase } from "../db/client";
import { authConfig } from "./auth-config";
import { authenticate } from "./auth-service";
import { verifyCsrf } from "./csrf";
import { AppError, appErrorResponse } from "./errors";
import { getSession } from "./session";
import { validationFields } from "./validation";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function api(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return appErrorResponse(error);
    if (error instanceof ZodError)
      return json(
        {
          error: "Check the submitted fields.",
          fields: validationFields(error),
        },
        400,
      );
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505"
    ) {
      return json(
        {
          error:
            "A record with these details already exists. Refresh and check the existing records.",
        },
        409,
      );
    }
    // Do not expose SQL, URLs, passwords, request bodies or upstream payloads.
    console.error(
      "HackRef request failed; check server configuration and database availability.",
    );
    return json(
      { error: "The service is unavailable. Please try again shortly." },
      503,
    );
  }
}

export async function apiOrganizer(request?: Request) {
  const session = await getSession();
  const organizer = await authenticate(getDatabase(), session.token);
  if (request) verifyCsrf(request.headers, session.csrf, authConfig().origin);
  return organizer;
}

export async function readJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new AppError(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new AppError(413, "Request exceeds 32 KiB.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Send valid JSON.");
  } finally {
    reader.releaseLock();
  }
}
