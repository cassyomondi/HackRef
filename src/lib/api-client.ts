"use client";

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
    const fields = Array.isArray(result.fields)
      ? result.fields
          .map(
            (f: { field: string; message: string }) =>
              `${f.field}: ${f.message}`,
          )
          .join(" ")
      : "";
    throw new Error(
      [result.error || "The request failed. Try again.", fields]
        .filter(Boolean)
        .join(" "),
    );
  }
  return result;
}
