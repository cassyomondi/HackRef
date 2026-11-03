import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export function verifyCsrf(
  headers: Headers,
  csrf: string | undefined,
  origin: string,
) {
  const supplied = headers.get("x-csrf-token") ?? "";
  if (
    headers.get("origin") !== origin ||
    headers.get("sec-fetch-site") === "cross-site" ||
    !csrf ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !/^[a-f0-9]{64}$/.test(csrf) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))
  ) {
    throw new AppError(
      403,
      "Request verification failed. Refresh the page and try again.",
    );
  }
}
