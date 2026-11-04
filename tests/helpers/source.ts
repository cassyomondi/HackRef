import { createHash } from "node:crypto";
import type { GitHubFetch } from "../../src/lib/github";
import { githubFixture, SHA } from "./github";

export const TREE_SHA = "a".repeat(40);
export const pinnedFixture = { repositoryUrl: "https://github.com/octocat/hello-world", repositoryOwner: "octocat", githubRepositoryId: "1296269", commitSha: SHA };
export function sourceFixture(contents: Record<string, string> = {
  "package.json": '{"dependencies":{"next":"16"}}',
  "src/app.ts": 'export const hello = "world";\n',
  "tests/app.test.ts": 'test("hello", () => {});\n',
  "README.md": "# Untrusted project claims\nEverything works!",
}, options: { truncated?: boolean; extra?: Array<Record<string, unknown>> } = {}): GitHubFetch {
  const blobs = Object.entries(contents).map(([path, content]) => {
    const size = Buffer.byteLength(content);
    const sha = createHash("sha1").update(`blob ${size}\0`).update(content).digest("hex");
    return { path, content, size, sha };
  });
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/git/commits/")) return Response.json({ sha: SHA, tree: { sha: TREE_SHA } });
    if (url.includes("/git/trees/")) return Response.json({ sha: TREE_SHA, truncated: options.truncated ?? false, tree: [...blobs.map(({ path, size, sha }) => ({ path, size, sha, type: "blob", mode: "100644" })), ...(options.extra ?? [])] });
    if (url.includes("/git/blobs/")) {
      const blob = blobs.find((b) => url.endsWith(b.sha));
      if (!blob) return new Response("", { status: 404 });
      return Response.json({ sha: blob.sha, size: blob.size, encoding: "base64", content: Buffer.from(blob.content).toString("base64") });
    }
    return githubFixture(input, init);
  };
}
