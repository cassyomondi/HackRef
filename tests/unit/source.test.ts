import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { collectSource, exclusionReason, SOURCE_BUDGET } from "../../src/lib/evaluation/source";
import { AppError } from "../../src/lib/errors";
import { pinnedFixture, sourceFixture, TREE_SHA } from "../helpers/source";
import { SHA } from "../helpers/github";

test("source collection uses only immutable commit/tree/blob SHA requests and records provenance", async () => {
  const runId = randomUUID();
  const fixture = sourceFixture();
  const urls: string[] = [];
  const result = await collectSource(pinnedFixture, runId, async (input, init) => {
    const url = String(input); urls.push(url);
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    return fixture(input, init);
  });
  assert.equal(result.files.length, 4);
  assert.ok(urls.includes(`https://api.github.com/repos/octocat/hello-world/git/trees/${TREE_SHA}?recursive=1`));
  assert.ok(!urls.some((url) => /main|master|raw\.github|contents/.test(url)));
  for (const file of result.files) {
    assert.equal(file.runId, runId); assert.equal(file.commitSha, SHA);
    assert.equal(file.contentHash, createHash("sha256").update(file.excerpt).digest("hex"));
    assert.match(file.sourceUri, new RegExp(`/blob/${SHA}/`));
    assert.equal(file.endLine, file.excerpt.split("\n").length);
  }
  assert.ok(result.checks.some((c) => c.kind === "declared_dependency" && /installation, use and successful integration were not checked/.test(c.statement)));
  assert.ok(result.files.find((f) => f.path === "README.md")?.documentation);
});

test("source rejects moving refs, changed identity and inconsistent commit/tree provenance", async () => {
  await assert.rejects(collectSource({ ...pinnedFixture, commitSha: "main" }, randomUUID(), sourceFixture()), /immutable commit/);
  await assert.rejects(collectSource({ ...pinnedFixture, githubRepositoryId: "123" }, randomUUID(), sourceFixture()), /identity/);
  const fixture = sourceFixture();
  for (const target of ["commits", "trees"]) {
    await assert.rejects(collectSource(pinnedFixture, randomUUID(), async (input, init) => {
      if (String(input).includes(`/git/${target}/`)) return Response.json({ sha: "b".repeat(40), tree: { sha: TREE_SHA }, truncated: false });
      return fixture(input, init);
    }), /provenance|tree/);
  }
});

test("malicious, secret, dependency, generated and binary paths/content are excluded", async () => {
  for (const path of ["../src/x.ts", "/etc/test.ts", "src/../x.ts", "src/%2e.ts", "src\\x.ts", "src/evil\n.ts", "src//x.ts", "src/#x.ts", "https://evil/x.ts", ".env", ".env.example", "config/credentials.json", "private.key", "node_modules/x.ts", "dist/x.js", "x.min.js", "package-lock.json", "image.png", ".github/workflows/test.yml"])
    assert.ok(exclusionReason(path), path);
  const result = await collectSource(pinnedFixture, randomUUID(), sourceFixture({
    "src/ok.py": "print('hello')", "src/binary.ts": "\0x", "src/key.ts": 'const api_key = "123456789abc";',
    "src/generated.ts": "// @generated\nhello", "src/minified.js": "a".repeat(2200), ".env": "SECRET=secret",
  }, { extra: [{ path: "src/link.ts", sha: TREE_SHA, type: "blob", mode: "120000", size: 1 }] }));
  assert.deepEqual(result.files.map((f) => f.path), ["src/ok.py"]);
  const reasons = result.coverage.omissions.map((o) => o.reason);
  for (const reason of ["binary", "suspected_embedded_secret", "generated_or_minified", "secret_path", "symlink_or_submodule"]) assert.ok(reasons.includes(reason), reason);
});

test("file, aggregate, excerpt, request and detail budgets bound collection", async () => {
  const contents: Record<string, string> = { "src/huge.ts": "x".repeat(SOURCE_BUDGET.fileBytes + 1) };
  for (let i = 0; i < 150; i++) contents[`src/a${i}.ts`] = "hello\n".repeat(2000);
  const result = await collectSource(pinnedFixture, randomUUID(), sourceFixture(contents));
  assert.ok(result.files.length <= SOURCE_BUDGET.files);
  assert.ok(result.coverage.requests <= SOURCE_BUDGET.requests);
  assert.ok(result.coverage.fetchedBytes <= SOURCE_BUDGET.aggregateBytes);
  assert.ok(result.coverage.excerptBytes <= SOURCE_BUDGET.excerptTotalBytes);
  assert.equal(result.coverage.omissions.length, SOURCE_BUDGET.omissionDetails);
  assert.ok(result.files.every((f) => f.truncated && Buffer.byteLength(f.excerpt) <= SOURCE_BUDGET.excerptBytes));
});

test("small files reach the exact file/request ceiling without fetching an extra blob", async () => {
  const result = await collectSource(pinnedFixture, randomUUID(), sourceFixture(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/${i}.ts`, `export const value = ${i};`]))));
  assert.equal(result.files.length, SOURCE_BUDGET.files);
  assert.equal(result.coverage.requests, SOURCE_BUDGET.requests);
  assert.equal(result.coverage.omittedCount, 14);
});

test("truncated trees and unavailable blobs remain transparent partial evidence", async () => {
  const fixture = sourceFixture(undefined, { truncated: true });
  const result = await collectSource(pinnedFixture, randomUUID(), async (input, init) => {
    if (String(input).includes("/git/blobs/")) return new Response("", { status: 404 });
    return fixture(input, init);
  });
  assert.equal(result.files.length, 0);
  assert.equal(result.coverage.treeTruncated, true);
  assert.equal(result.coverage.omittedCount, 4);
  assert.ok(result.coverage.limitations.some((s) => /cannot be inferred absent/.test(s)));
});

test("blob rate limits retain canonical retry classification; fabricated blob hashes are excluded", async () => {
  const fixture = sourceFixture();
  await assert.rejects(collectSource(pinnedFixture, randomUUID(), async (input, init) => {
    if (String(input).includes("/git/blobs/")) return new Response("", { status: 429, headers: { "retry-after": "120" } });
    return fixture(input, init);
  }), (error: unknown) => error instanceof AppError && error.status === 429 && error.retryable && !!error.retryAt);
  const result = await collectSource(pinnedFixture, randomUUID(), async (input, init) => {
    const response = await fixture(input, init);
    if (String(input).includes("/git/blobs/")) { const blob = await response.json(); blob.content = Buffer.from("x".repeat(blob.size)).toString("base64"); return Response.json(blob); }
    return response;
  });
  assert.equal(result.files.length, 0);
  assert.ok(result.coverage.omissions.every((o) => o.reason === "blob_hash_mismatch"));
});

test("source deadline is propagated and an aborted collection cannot start network work", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(collectSource(pinnedFixture, randomUUID(), async () => { calls++; throw new Error("unexpected"); }, controller.signal));
  assert.equal(calls, 0);
});
