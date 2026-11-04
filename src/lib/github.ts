import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
import { parseRepositoryUrl } from "./validation";

const metadata = z.object({
  id: z.number().int().positive().safe(),
  private: z.literal(false),
  visibility: z.literal("public"),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string().min(1).max(200),
});
const commit = z.string().regex(/^[a-f0-9]{40}$/);
export type GitHubFetch = typeof fetch;

function retryDate(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 8.64e15
    ? new Date(value)
    : undefined;
}

function rateLimitError(response: Response, authenticated: boolean) {
  if (![403, 429].includes(response.status)) return;
  const exhausted = response.headers.get("x-ratelimit-remaining") === "0";
  const reset = response.headers.get("x-ratelimit-reset");
  const retryAfter = response.headers.get("retry-after");
  const now = Date.now();
  const resetAt =
    exhausted && reset && /^\d+$/.test(reset)
      ? retryDate(Number(reset) * 1000 + 1000)
      : undefined;
  const afterAt = retryAfter
    ? retryDate(
        /^\d+$/.test(retryAfter)
          ? now + Number(retryAfter) * 1000
          : Date.parse(retryAfter),
      )
    : undefined;
  if (!exhausted && response.status !== 429 && !afterAt) return;
  // Never shorten either upstream deadline. If an exhausted primary limit has
  // no usable deadline, fail without automatically guessing an early retry.
  const retryAt =
    resetAt || afterAt || !exhausted
      ? new Date(
          Math.max(
            now + 60_000,
            resetAt?.getTime() ?? 0,
            afterAt?.getTime() ?? 0,
          ),
        )
      : undefined;
  const advice = !exhausted
    ? "GitHub is temporarily limiting requests."
    : authenticated
      ? "The server's authenticated GitHub quota is exhausted."
      : "The shared anonymous GitHub quota is exhausted. Configure GITHUB_API_TOKEN on the server for authenticated requests.";
  return new AppError(
    429,
    `GitHub API rate limit reached. ${advice} ${retryAt ? `Try again at or after ${retryAt.toISOString()}.` : "GitHub did not provide a usable reset time; wait for the quota to reset before trying again."}`,
    !!retryAt,
    retryAt,
  );
}

export async function getGitHub(
  path: string,
  fetcher: GitHubFetch,
  token: string | undefined,
  shaOnly = false,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: shaOnly
          ? "application/vnd.github.sha"
          : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "HackRef-Pass2",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "Could not connect to GitHub (network error, timeout or rejected redirect). Try again shortly; if the repository moved, use its current URL.",
      true,
    );
  }
  if (!response.ok) await response.body?.cancel().catch(() => {});
  const limited = rateLimitError(response, !!token);
  if (limited) throw limited;
  if (response.status === 401)
    throw new AppError(
      502,
      "GitHub API authentication failed. Check or replace the server's GITHUB_API_TOKEN and restart the app and worker.",
    );
  if (response.status === 403)
    throw new AppError(
      403,
      "GitHub denied API access. Check the server's GITHUB_API_TOKEN permissions and organization restrictions.",
    );
  if (
    response.status === 404 ||
    response.status === 409 ||
    response.status === 422
  )
    throw new AppError(
      422,
      "Repository or commit not found, or the repository is private. Check the URL and reference; HackRef accepts public repositories only.",
    );
  if (!response.ok)
    throw new AppError(
      response.status >= 500 ? 503 : 502,
      response.status >= 500
        ? "GitHub is temporarily unavailable. Try again shortly."
        : "GitHub could not process this API request. Check the repository URL and server configuration.",
      response.status >= 500,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(503, "GitHub returned an empty response.", true);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("Response too large");
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return shaOnly ? body.trim() : (JSON.parse(body) as unknown);
  } catch {
    await reader.cancel().catch(() => {});
    throw new AppError(
      503,
      "GitHub returned an invalid or oversized response.",
      true,
    );
  } finally {
    reader.releaseLock();
  }
}

export async function resolveRepository(
  repositoryUrl: string,
  ref = "",
  fetcher: GitHubFetch = fetch,
  signal?: AbortSignal,
) {
  const parsed = parseRepositoryUrl(repositoryUrl);
  // Read only at runtime inside this server-only module. Never return or log it.
  const token = process.env.GITHUB_API_TOKEN?.trim() || undefined;
  const path = `/repos/${parsed.owner}/${parsed.repository}`;
  const info = metadata.safeParse(await getGitHub(path, fetcher, token, false, signal));
  if (!info.success)
    throw new AppError(
      422,
      "Only public GitHub repositories with valid metadata are supported.",
    );
  if (
    info.data.full_name.toLowerCase() !==
      `${parsed.owner}/${parsed.repository}` ||
    info.data.owner.login.toLowerCase() !== parsed.owner
  )
    throw new AppError(
      422,
      "GitHub repository ownership changed. Use the current canonical URL.",
    );
  const resolved = commit.safeParse(
    await getGitHub(
      `${path}/commits/${encodeURIComponent(ref || info.data.default_branch)}`,
      fetcher,
      token,
      true,
      signal,
    ),
  );
  if (!resolved.success)
    throw new AppError(
      503,
      "GitHub did not return a full immutable commit SHA.",
      true,
    );
  return {
    repositoryUrl: parsed.url,
    repositoryOwner: parsed.owner,
    githubRepositoryId: String(info.data.id),
    commitSha: resolved.data,
  };
}
