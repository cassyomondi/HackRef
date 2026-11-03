import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { AppError, appErrorResponse } from "../../src/lib/errors";
import { resolveRepository, type GitHubFetch } from "../../src/lib/github";
import { githubFixture, SHA } from "../helpers/github";

const repository = "https://github.com/octocat/hello-world";

async function githubError(fetcher: GitHubFetch) {
  try {
    await resolveRepository(repository, "", fetcher);
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  throw new Error("The upstream failure must reject.");
}

async function withToken(token: string | undefined, run: () => Promise<void>) {
  const previous = process.env.GITHUB_API_TOKEN;
  if (token === undefined) delete process.env.GITHUB_API_TOKEN;
  else process.env.GITHUB_API_TOKEN = token;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_API_TOKEN;
    else process.env.GITHUB_API_TOKEN = previous;
  }
}

test("GitHub sends a server token to both fixed-host requests without returning it", async () => {
  const secret = randomBytes(32).toString("hex");
  await withToken(secret, async () => {
    let calls = 0;
    const result = await resolveRepository(
      repository,
      "main",
      async (input, init) => {
        calls++;
        assert.equal(new URL(String(input)).origin, "https://api.github.com");
        assert.ok(
          new Headers(init?.headers).get("authorization") ===
            `Bearer ${secret}`,
          "Configured server token must be sent as a bearer credential.",
        );
        assert.equal(init?.redirect, "error");
        assert.equal(init?.cache, "no-store");
        assert.ok(init?.signal);
        return githubFixture(input, init);
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.commitSha, SHA);
    assert.ok(
      !JSON.stringify(result).includes(secret),
      "Credentials must not appear in returned data.",
    );
  });
});

test("GitHub preserves anonymous operation when the optional token is absent or blank", async () => {
  for (const token of [undefined, "", "   "])
    await withToken(token, async () => {
      await resolveRepository(repository, "", async (input, init) => {
        assert.equal(new Headers(init?.headers).has("authorization"), false);
        return githubFixture(input, init);
      });
    });
});

test("exhausted primary limits return safe 429 responses and the later reset/Retry-After deadline", async () => {
  await withToken(undefined, async () => {
    for (const status of [403, 429]) {
      const reset = Math.ceil(Date.now() / 1000) + 600;
      let calls = 0;
      const response = appErrorResponse(
        await githubError(async () => {
          calls++;
          return new Response("do not expose upstream bodies", {
            status,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(reset),
              "retry-after": "1200",
            },
          });
        }),
      );
      assert.equal(calls, 1, "The client must not retry an exhausted request.");
      assert.equal(response.status, 429);
      const body = await response.json();
      assert.match(body.error, /anonymous GitHub quota/);
      assert.match(body.error, /GITHUB_API_TOKEN/);
      assert.ok(Date.parse(body.retryAt) >= (reset + 1) * 1000);
      assert.ok(Number(response.headers.get("retry-after")) >= 1199);
      assert.ok(!JSON.stringify(body).includes("do not expose upstream"));
    }
  });
});

test("GitHub reset time is honored when it is later than Retry-After", async () => {
  const reset = Math.ceil(Date.now() / 1000) + 1800;
  await assert.rejects(
    resolveRepository(
      repository,
      "",
      async () =>
        new Response("", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(reset),
            "retry-after": "1",
          },
        }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.ok(error.retryAt && error.retryAt.getTime() >= (reset + 1) * 1000);
      return true;
    },
  );
});

test("Retry-After HTTP dates are respected; malformed exhausted-limit deadlines disable automatic retry", async () => {
  const deadline = new Date(Date.now() + 3600_000).toUTCString();
  for (const status of [403, 429])
    await assert.rejects(
      resolveRepository(
        repository,
        "",
        async () =>
          new Response("", { status, headers: { "retry-after": deadline } }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, 429);
        assert.ok(
          error.retryAt && error.retryAt.getTime() >= Date.parse(deadline),
        );
        return true;
      },
    );
  await assert.rejects(
    resolveRepository(
      repository,
      "",
      async () =>
        new Response("", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "invalid",
            "retry-after": "invalid",
          },
        }),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.status === 429 &&
      !error.retryable &&
      !error.retryAt,
  );
});

test("rejected tokens fail without retry or anonymous fallback and never expose secrets", async (t) => {
  const secret = randomBytes(32).toString("hex");
  const logged: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(String(args));
  });
  await withToken(secret, async () => {
    let calls = 0;
    const response = appErrorResponse(
      await githubError(async () => {
        calls++;
        return new Response(`raw rejected credential: ${secret}`, {
          status: 401,
        });
      }),
    );
    assert.equal(calls, 1);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /GitHub API authentication failed/);
    assert.ok(
      !body.includes(secret) && !body.includes("raw rejected credential"),
    );
    assert.ok(!logged.join(" ").includes(secret));
    await assert.rejects(
      resolveRepository(
        repository,
        "",
        async () => new Response(secret, { status: 401 }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.retryable, false);
        assert.ok(
          !String(error.stack).includes(secret) &&
            !JSON.stringify(error).includes(secret),
        );
        return true;
      },
    );
  });
});

test("permission denial, missing/private repositories and network failures have distinct safe errors", async () => {
  const secret = randomBytes(32).toString("hex");
  await withToken(secret, async () => {
    const cases: Array<{
      fetcher: GitHubFetch;
      status: number;
      retryable: boolean;
      message: RegExp;
    }> = [
      {
        fetcher: async () =>
          new Response(secret, {
            status: 403,
            headers: { "x-ratelimit-remaining": "59" },
          }),
        status: 403,
        retryable: false,
        message: /denied API access/,
      },
      {
        fetcher: async () => new Response(secret, { status: 404 }),
        status: 422,
        retryable: false,
        message: /private/,
      },
      {
        fetcher: async () => {
          throw new Error(secret);
        },
        status: 503,
        retryable: true,
        message: /network error/,
      },
      {
        fetcher: async () => new Response(secret, { status: 503 }),
        status: 503,
        retryable: true,
        message: /temporarily unavailable/,
      },
    ];
    for (const entry of cases)
      await assert.rejects(
        resolveRepository(repository, "", entry.fetcher),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.status, entry.status);
          assert.equal(error.retryable, entry.retryable);
          assert.match(error.message, entry.message);
          assert.ok(!error.message.includes(secret));
          return true;
        },
      );
    // Authentication must never grant registration of a private repository.
    await assert.rejects(
      resolveRepository(repository, "", async () =>
        Response.json({
          id: 1,
          private: true,
          visibility: "private",
          full_name: "octocat/hello-world",
          owner: { login: "octocat" },
          default_branch: "main",
        }),
      ),
      (error: unknown) => error instanceof AppError && error.status === 422,
    );
  });
});
