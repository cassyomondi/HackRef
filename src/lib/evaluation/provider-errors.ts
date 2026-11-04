import "server-only";
import { z } from "zod";
import { AppError } from "../errors";
import { invalidRequestDiagnostics, type RequestDiagnostics } from "./request-diagnostics";

export type GeminiErrorCode = "GEMINI_KEY_MISSING" | "GEMINI_KEY_INVALID" |
  "GEMINI_PERMISSION_DENIED" | "GEMINI_MODEL_NOT_FOUND" | "GEMINI_QUOTA_EXHAUSTED" |
  "GEMINI_RATE_LIMITED" | "GEMINI_UNAVAILABLE" | "GEMINI_TIMEOUT" |
  "GEMINI_TRANSPORT_ERROR" | "GEMINI_INVALID_REQUEST" | "GEMINI_REQUEST_REJECTED";

export class GeminiError extends AppError {
  constructor(public code: GeminiErrorCode, message: string, retryable = false,
    public providerStatus?: number, retryAt?: Date, public diagnostics?: RequestDiagnostics) {
    super(providerStatus === 429 ? 429 : 503, message, retryable, retryAt);
  }
}

const detailSchema = z.object({ reason: z.string().optional(), retryDelay: z.string().optional(),
  fieldViolations: z.array(z.object({ field: z.string().optional(), description: z.string().optional() })).optional(),
});
const bodySchema = z.object({ error: z.object({
  code: z.number().optional(), status: z.string().optional(),
  details: z.array(detailSchema).optional(),
}) });

export function providerError(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  // Inspect upstream data only for classification, never echo it to logs/UI.
  const info = z.object({ status: z.union([z.number(), z.string()]).optional(), message: z.string().optional(), name: z.string().optional() }).safeParse(error);
  const message = info.success ? info.data.message ?? "" : "";
  let body: z.infer<typeof bodySchema> | undefined;
  if (message.length <= 65_536) {
    try { body = bodySchema.parse(JSON.parse(message)); } catch { /* not an SDK JSON error */ }
  }
  const rawStatus = info.success ? info.data.status : undefined;
  const status = rawStatus !== undefined && /^\d{3}$/.test(String(rawStatus)) ? Number(rawStatus) : body?.error.code;
  const details = body?.error.details ?? [];
  const reasons = details.flatMap((d) => d.reason ? [d.reason] : []);
  const cause = z.object({ cause: z.object({ code: z.string() }) }).safeParse(error);
  // An explicit HTTP status takes precedence over text suggesting another cause.
  if (status === 503) return new GeminiError("GEMINI_UNAVAILABLE", "Gemini is temporarily unavailable (HTTP 503). No assessment was published.", true, status);
  if (status === 408 || status === 504 || (!status && (
    (info.success && ["AbortError", "TimeoutError"].includes(info.data.name ?? "")) ||
    (cause.success && ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(cause.data.cause.code)) || /\b(?:timed?\s*out|timeout)\b/i.test(message))))
    return new GeminiError("GEMINI_TIMEOUT", "Gemini request timed out. No assessment was published.", true, status);
  if (status === 429 || status === 402) {
    if (status === 402 || reasons.some((r) => ["BILLING_DISABLED", "DAILY_LIMIT_EXCEEDED"].includes(r)) || /per.?day|daily|billing|prepay|limit:\s*0|quota.*exhaust/i.test(message))
      return new GeminiError("GEMINI_QUOTA_EXHAUSTED", "Gemini quota or credits are exhausted. Check the configured account's quota and billing before retrying.", false, status);
    let delaySeconds = 60;
    for (const detail of details) {
      if (detail.retryDelay && /^\d+(?:\.\d+)?s$/.test(detail.retryDelay)) {
        const seconds = Number(detail.retryDelay.slice(0, -1));
        if (Number.isFinite(seconds) && seconds <= 31_536_000) delaySeconds = Math.max(delaySeconds, seconds);
      }
    }
    return new GeminiError("GEMINI_RATE_LIMITED", "Gemini is rate limited. Retry after the provider cooldown.", true, status, new Date(Date.now() + delaySeconds * 1000));
  }
  if (status === 404) return new GeminiError("GEMINI_MODEL_NOT_FOUND", "The configured Gemini model was not found for this API account. Check GEMINI_MODEL and available models.", false, status);
  if (status === 401 || ([400, 403].includes(status ?? 0) && (
    reasons.some((r) => ["API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_NOT_FOUND", "API_KEY_MISSING"].includes(r)) || /API_KEY_INVALID|invalid api key|api key (?:is )?(?:not valid|invalid|expired)/i.test(message))))
    return new GeminiError("GEMINI_KEY_INVALID", "Gemini authentication failed: the API key is invalid, expired or rejected. Check the worker's GEMINI_API_KEY.", false, status);
  if (status === 403) return new GeminiError("GEMINI_PERMISSION_DENIED", "Gemini permission denied. The configured account lacks permission for this model or API; check project and model access.", false, status);
  if (status === 400) return new GeminiError("GEMINI_INVALID_REQUEST", "Gemini rejected an invalid evaluation request (HTTP 400). Check the safe provider contract diagnostics; no assessment was published.", false, status, undefined, invalidRequestDiagnostics(message, details));
  if (status && status >= 500) return new GeminiError("GEMINI_UNAVAILABLE", "Gemini encountered a temporary server error. No assessment was published.", true, status);
  if (!status) return new GeminiError("GEMINI_TRANSPORT_ERROR", "Could not connect to Gemini. No assessment was published.", true);
  return new GeminiError("GEMINI_REQUEST_REJECTED", "Gemini rejected the evaluation request. Check the configured model's supported request settings.", false, status);
}
