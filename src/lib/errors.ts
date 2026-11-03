export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryable = false,
    public retryAt?: Date,
  ) {
    super(message);
  }
}

export function appErrorResponse(error: AppError) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (error.retryAt)
    headers["Retry-After"] = String(
      Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000)),
    );
  return Response.json(
    {
      error: error.message,
      ...(error.retryAt ? { retryAt: error.retryAt.toISOString() } : {}),
    },
    { status: error.status, headers },
  );
}
