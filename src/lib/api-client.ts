"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields: Array<{ field: string; message: string }>) {
    super(message);
  }
}

export async function apiRequest(path: string, method = "GET", data?: unknown) {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error("Unable to verify this request. Refresh and try again.");
    const { csrf } = await response.json();
    headers["x-csrf-token"] = csrf;
    if (data !== undefined) headers["content-type"] = "application/json";
  }
  const response = await fetch(path, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fields: Array<{ field: string; message: string }> = Array.isArray(result.fields)
      ? result.fields.filter((field: { field?: unknown; message?: unknown }) => typeof field.field === "string" && typeof field.message === "string")
      : [];
    throw new ApiError(
      [result.error || "The request failed. Try again.", fields.map((field) => field.field ? `${field.field}: ${field.message}` : field.message).join(" ")]
        .filter(Boolean)
        .join(" "),
      response.status,
      fields,
    );
  }
  return result;
}
