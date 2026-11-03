import assert from "node:assert/strict";
import { test } from "node:test";
import { parseServerEnvironment } from "../../src/lib/env-validation";

test("accepts PostgreSQL URLs and excludes unrelated secrets", () => {
  const DATABASE_URL = "postgresql://local:password@localhost:5433/hackref";
  assert.deepEqual(
    parseServerEnvironment({ DATABASE_URL, UNRELATED_SECRET: "private" }),
    { DATABASE_URL },
  );
  assert.ok(
    parseServerEnvironment({ DATABASE_URL: "postgres://localhost/hackref" }),
  );
});

test("rejects missing, malformed and non-PostgreSQL connection strings", () => {
  for (const DATABASE_URL of [
    undefined,
    "",
    "not-a-url",
    "https://localhost/hackref",
    "postgresql://localhost/",
  ]) {
    assert.throws(
      () => parseServerEnvironment({ DATABASE_URL }),
      /Invalid server environment/,
    );
  }
});

test("validation errors never include supplied credentials", () => {
  const secret = "sensitive-password-do-not-log";
  assert.throws(
    () =>
      parseServerEnvironment({
        DATABASE_URL: `https://user:${secret}@localhost/hackref`,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes("https://"));
      return true;
    },
  );
});
