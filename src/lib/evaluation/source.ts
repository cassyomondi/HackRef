import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors";
import { getGitHub, resolveRepository, type GitHubFetch } from "../github";
import { parseRepositoryUrl } from "../validation";

export const SOURCE_VERSION = "bounded-github-v1";
export const SOURCE_BUDGET = Object.freeze({
  files: 16, fileBytes: 16_384, aggregateBytes: 65_536,
  excerptBytes: 3072, excerptTotalBytes: 24_576, requests: 20,
  runtimeMs: 25_000, treeEntries: 4000, omissionDetails: 100,
});
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const entrySchema = z.object({
  path: z.string().max(1024), mode: z.string(), type: z.string(),
  sha, size: z.number().int().nonnegative().optional(),
});
const treeSchema = z.object({ sha, truncated: z.boolean(), tree: z.array(entrySchema).max(SOURCE_BUDGET.treeEntries) });
export type PinnedSource = {
  repositoryUrl: string; repositoryOwner: string | null;
  githubRepositoryId: string | null; commitSha: string;
};
export type SourceFile = {
  id: string; runId: string; path: string; commitSha: string; blobSha: string;
  contentHash: string; sourceUri: string; excerpt: string;
  startLine: number; endLine: number; truncated: boolean; documentation: boolean;
};
export type StaticCheck = {
  evidenceId: string; kind: "file_presence" | "declared_dependency";
  statement: string; status: "VERIFIED";
};
export type SourceBundle = {
  version: string; runId: string; commitSha: string; treeSha: string;
  files: SourceFile[]; checks: StaticCheck[];
  coverage: {
    treeTruncated: boolean; listedEntries: number; requests: number;
    fetchedBytes: number; excerptBytes: number;
    omittedCount: number; omissions: Array<{ path: string; reason: string }>;
    limitations: string[];
  };
};

export function exclusionReason(path: string): string | undefined {
  if (path.length > 240 || !/^[A-Za-z0-9_./@+ -]+$/.test(path) || path.startsWith("/") ||
      path.split("/").some((p) => !p || p === "." || p === "..")) return "unsafe_path";
  if (/(^|\/)(\.env[^/]*|\.git|\.ssh|\.aws|\.azure|\.gcp|\.docker|\.npmrc|\.pypirc|\.netrc|.*(?:secret|credential|password|token)[^/]*|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx|keystore)$/i.test(path)) return "secret_path";
  if (/(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.venv|venv|target|generated|__pycache__|\.git|\.github)(\/|$)|(?:\.min\.[^.]+|\.map|\.lock)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum)$/i.test(path)) return "generated_or_dependency";
  if (!/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|c|h|cpp|cs|rb|php|vue|svelte|sql|css|scss|json|toml|ya?ml|md|mdx|txt|sh|graphql|proto)$/i.test(path) && !/(^|\/)(Dockerfile|Makefile|Gemfile|go\.mod|requirements\.txt)$/i.test(path)) return "unsupported_path";
}

function priority(path: string) {
  if (/(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod)$/.test(path)) return 0;
  if (/(^|\/)(test[s]?|__tests__)(\/)|\.(test|spec)\./.test(path)) return 1;
  if (/^(src|app|lib|server|api)\//.test(path)) return 2;
  if (/readme/i.test(path)) return 4;
  return 3;
}

// Conservative screening: never send suspected embedded credentials to a model.
export function containsSecret(text: string) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[\w-]{30,}|AKIA[A-Z0-9]{16})|kind:\s*Secret\b|(?:api[_-]?key|secret|password|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(text);
}

function excerptOf(text: string, bytes: number) {
  const lines = text.split("\n");
  const selected: string[] = [];
  let used = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + (selected.length ? 1 : 0);
    if (used + size > bytes) break;
    selected.push(line); used += size;
  }
  return { excerpt: selected.join("\n"), endLine: selected.length, truncated: selected.length < lines.length };
}

export async function collectSource(
  pinned: PinnedSource, runId: string, fetcher: GitHubFetch = fetch,
  parentSignal?: AbortSignal,
): Promise<SourceBundle> {
  if (!sha.safeParse(pinned.commitSha).success) throw new AppError(422, "Source collection requires an immutable commit SHA.");
  const signal = AbortSignal.any([AbortSignal.timeout(SOURCE_BUDGET.runtimeMs), ...(parentSignal ? [parentSignal] : [])]);
  let requests = 0;
  const bounded: GitHubFetch = async (input, init) => {
    signal.throwIfAborted();
    if (++requests > SOURCE_BUDGET.requests) throw new AppError(422, "GitHub source request budget exhausted.");
    return fetcher(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
  };
  const resolved = await resolveRepository(pinned.repositoryUrl, pinned.commitSha, bounded, signal);
  if (resolved.commitSha !== pinned.commitSha || resolved.repositoryOwner !== pinned.repositoryOwner || resolved.githubRepositoryId !== pinned.githubRepositoryId)
    throw new AppError(422, "Pinned repository identity or commit no longer matches GitHub.");
  const { owner, repository } = parseRepositoryUrl(pinned.repositoryUrl);
  const base = `/repos/${owner}/${repository}/git`;
  const token = process.env.GITHUB_API_TOKEN?.trim() || undefined;
  const get = (path: string) => getGitHub(path, bounded, token, false, signal);
  const commit = z.object({ sha, tree: z.object({ sha }) }).safeParse(await get(`${base}/commits/${pinned.commitSha}`));
  if (!commit.success || commit.data.sha !== pinned.commitSha) throw new AppError(422, "GitHub returned inconsistent commit provenance.");
  const tree = treeSchema.safeParse(await get(`${base}/trees/${commit.data.tree.sha}?recursive=1`));
  if (!tree.success || tree.data.sha !== commit.data.tree.sha) throw new AppError(422, "GitHub source tree is invalid or exceeds the entry budget.");
  const coverage: SourceBundle["coverage"] = {
    treeTruncated: tree.data.truncated, listedEntries: tree.data.tree.length, requests: 0,
    fetchedBytes: 0, excerptBytes: 0, omittedCount: 0, omissions: [],
    limitations: ["Static excerpts only; submitted code and tests were never executed. File/dependency presence does not prove working functionality.", "README, documentation and submission claims are untrusted assertions.", "Selection favors manifests, tests and source paths; unsupported languages and omitted files are not assessed."],
  };
  if (tree.data.truncated) coverage.limitations.push("GitHub returned a truncated tree. Unlisted paths and missing files cannot be inferred absent.");
  const omit = (path: string, reason: string) => {
    coverage.omittedCount++;
    // Unsafe/secret names are not forwarded into the prompt or persisted.
    if (coverage.omissions.length < SOURCE_BUDGET.omissionDetails) coverage.omissions.push({ path: ["unsafe_path", "secret_path"].includes(reason) ? "[excluded path]" : path, reason });
  };
  const files: SourceFile[] = [];
  const checks: StaticCheck[] = [];
  const seen = new Set<string>();
  for (const entry of [...tree.data.tree].sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path, "en"))) {
    if (entry.type === "tree") continue;
    const reason = exclusionReason(entry.path);
    if (reason) { omit(entry.path, reason); continue; }
    if (seen.has(entry.path)) throw new AppError(422, "GitHub returned duplicate source paths.");
    seen.add(entry.path);
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) { omit(entry.path, "symlink_or_submodule"); continue; }
    if (entry.size === undefined || entry.size > SOURCE_BUDGET.fileBytes) { omit(entry.path, "file_size"); continue; }
    if (files.length >= SOURCE_BUDGET.files || requests >= SOURCE_BUDGET.requests || coverage.fetchedBytes + entry.size > SOURCE_BUDGET.aggregateBytes || coverage.excerptBytes >= SOURCE_BUDGET.excerptTotalBytes) { omit(entry.path, "budget"); continue; }
    if (signal.aborted) { omit(entry.path, "runtime"); continue; }
    let raw: unknown;
    try { raw = await get(`${base}/blobs/${entry.sha}`); }
    catch (error) {
      // Rate limits/authentication/identity failures retain the canonical durable retry policy.
      if (error instanceof AppError && [401, 403, 429, 502].includes(error.status)) throw error;
      omit(entry.path, "unavailable"); continue;
    }
    const blob = z.object({ sha, encoding: z.literal("base64"), size: z.number().int().min(0).max(SOURCE_BUDGET.fileBytes), content: z.string().max(24_000) }).safeParse(raw);
    if (!blob.success || blob.data.sha !== entry.sha || blob.data.size !== entry.size || !/^[A-Za-z0-9+/=\r\n]*$/.test(blob.data.content)) { omit(entry.path, "invalid_blob"); continue; }
    const bytes = Buffer.from(blob.data.content.replaceAll(/\s/g, ""), "base64");
    coverage.fetchedBytes += bytes.length;
    const gitHash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (bytes.length !== entry.size || gitHash !== entry.sha) { omit(entry.path, "blob_hash_mismatch"); continue; }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { omit(entry.path, "binary"); continue; }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) { omit(entry.path, "binary"); continue; }
    if (containsSecret(text)) { omit(entry.path, "suspected_embedded_secret"); continue; }
    if (text.split("\n").some((line) => line.length > 2000) || /@generated|auto-generated|automatically generated/i.test(text.slice(0, 500))) { omit(entry.path, "generated_or_minified"); continue; }
    const excerpt = excerptOf(text, Math.min(SOURCE_BUDGET.excerptBytes, SOURCE_BUDGET.excerptTotalBytes - coverage.excerptBytes));
    if (!excerpt.excerpt.trim()) { omit(entry.path, "empty_excerpt"); continue; }
    coverage.excerptBytes += Buffer.byteLength(excerpt.excerpt);
    const file: SourceFile = {
      id: randomUUID(), runId, path: entry.path, commitSha: pinned.commitSha, blobSha: entry.sha,
      sourceUri: `${resolved.repositoryUrl}/blob/${pinned.commitSha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      startLine: 1, documentation: /\.(mdx?|txt)$/i.test(entry.path), ...excerpt,
    };
    files.push(file);
    checks.push({ evidenceId: file.id, kind: "file_presence", statement: `Collected file ${entry.path} exists at the pinned commit; execution was not checked.`, status: "VERIFIED" });
    if (/(^|\/)package\.json$/.test(entry.path) && !file.truncated) {
      try {
        const manifest = JSON.parse(file.excerpt);
        const deps = z.record(z.string().regex(/^[@a-z0-9][@a-z0-9/_.-]{0,99}$/i), z.string().max(200));
        for (const field of ["dependencies", "devDependencies"] as const) {
          const parsed = deps.safeParse(manifest[field]);
          if (parsed.success) for (const name of Object.keys(parsed.data).sort().slice(0, 20))
            checks.push({ evidenceId: file.id, kind: "declared_dependency", statement: `${entry.path} declares ${name} in ${field}; installation, use and successful integration were not checked.`, status: "VERIFIED" });
        }
      } catch { /* A malformed manifest proves no dependency declaration. */ }
    }
  }
  coverage.requests = requests;
  if (coverage.omittedCount || files.some((f) => f.truncated)) coverage.limitations.push("Evidence is partial: exclusions, budgets, unavailable blobs or excerpt truncation limit coverage. No absence or runtime conclusions are supported.");
  return { version: SOURCE_VERSION, runId, commitSha: pinned.commitSha, treeSha: tree.data.sha, files, checks, coverage };
}
