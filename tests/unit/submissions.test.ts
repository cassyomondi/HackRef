import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRepositoryUrl,
  rubricInput,
  submissionInput,
} from "../../src/lib/validation";
import { resolveRepository } from "../../src/lib/github";
import { AppError } from "../../src/lib/errors";
import { githubFixture, SHA, submissionFixture } from "../helpers/github";

test("repository URLs are canonical and restricted to public GitHub repository paths", () => {
  assert.equal(
    parseRepositoryUrl("https://github.com/Octocat/Hello-World.git/").url,
    "https://github.com/octocat/hello-world",
  );
  for (const url of [
    "http://github.com/owner/repo",
    "https://github.com.evil.example/owner/repo",
    "https://user:password@github.com/owner/repo",
    "https://github.com:444/owner/repo",
    "https://127.0.0.1/owner/repo",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo?x=y",
    "https://github.com/owner/repo#readme",
    "https://github.com/owner/%72epo",
    "git@github.com:owner/repo",
    "https://github.com/-owner/repo",
    "https://github.com/owner/old/../repo",
    "https://github.com\\owner\\repo",
  ])
    assert.throws(() => parseRepositoryUrl(url), url);
});

test("submissions require explicit bounded claims, declared owner and submission authority", () => {
  const parsed = submissionInput.parse(submissionFixture);
  assert.equal(parsed.repositoryUrl, "https://github.com/octocat/hello-world");
  for (const bad of [
    { claims: [] },
    { claims: [" "] },
    { claims: ["a".repeat(1001)] },
    { ownershipAttested: false },
    { repositoryOwner: "someone-else" },
    { name: " " },
    { ref: "main?attack=true" },
    { unexpected: "value" },
  ])
    assert.equal(
      submissionInput.safeParse({ ...submissionFixture, ...bad }).success,
      false,
    );
  assert.equal(
    rubricInput.safeParse({
      title: "Rubric",
      criteria: [
        { key: "quality", label: "Quality", maxScore: 10 },
        { key: "quality", label: "Duplicate", maxScore: 5 },
      ],
    }).success,
    false,
  );
});

test("GitHub resolves references to full SHAs using bounded, fixed-host requests", async () => {
  const calls: string[] = [];
  const result = await resolveRepository(
    "https://github.com/octocat/hello-world",
    "feature/demo",
    async (input, init) => {
      calls.push(String(input));
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("accept"),
        String(input).includes("/commits/")
          ? "application/vnd.github.sha"
          : "application/vnd.github+json",
      );
      assert.ok(init?.signal);
      return githubFixture(input, init);
    },
  );
  assert.equal(result.commitSha, SHA);
  assert.equal(result.githubRepositoryId, "1296269");
  assert.deepEqual(calls, [
    "https://api.github.com/repos/octocat/hello-world",
    "https://api.github.com/repos/octocat/hello-world/commits/feature%2Fdemo",
  ]);
});

test("GitHub private, transferred, missing and malformed repositories cannot be registered", async () => {
  for (const body of [
    {
      id: 1,
      private: true,
      visibility: "private",
      full_name: "octocat/hello-world",
      owner: { login: "octocat" },
      default_branch: "main",
    },
    {
      id: 1,
      private: false,
      visibility: "public",
      full_name: "other/repo",
      owner: { login: "other" },
      default_branch: "main",
    },
    { unexpected: true },
  ])
    await assert.rejects(
      resolveRepository(
        "https://github.com/octocat/hello-world",
        "",
        async () => Response.json(body),
      ),
      AppError,
    );
  await assert.rejects(
    resolveRepository(
      "https://github.com/octocat/hello-world",
      "",
      async () => new Response("secret upstream payload", { status: 404 }),
    ),
    (e: unknown) =>
      e instanceof AppError &&
      e.status === 422 &&
      !e.retryable &&
      !e.message.includes("secret"),
  );
  await assert.rejects(
    resolveRepository(
      "https://github.com/octocat/hello-world",
      "",
      async () => new Response("", { status: 429 }),
    ),
    (e: unknown) => e instanceof AppError && e.retryable,
  );
  await assert.rejects(
    resolveRepository(
      "https://github.com/octocat/hello-world",
      "",
      async () => new Response("x".repeat(1024 * 1024 + 1)),
    ),
    (e: unknown) => e instanceof AppError && e.retryable,
  );
  await assert.rejects(
    resolveRepository(
      "https://github.com/octocat/hello-world",
      "",
      async (input, init) =>
        String(input).includes("/commits/")
          ? Response.json({ sha: "main" })
          : githubFixture(input, init),
    ),
  );
});
