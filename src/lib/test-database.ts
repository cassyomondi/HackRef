import { parseServerEnvironment } from "./env-validation";

export function testDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  if (!env.TEST_DATABASE_URL)
    throw new Error(
      "Set TEST_DATABASE_URL to a separate local database ending in _test. Run npm run db:test:setup.",
    );
  const { DATABASE_URL: value } = parseServerEnvironment({
    DATABASE_URL: env.TEST_DATABASE_URL,
  });
  const test = new URL(value);
  const development = env.DATABASE_URL ? new URL(env.DATABASE_URL) : undefined;
  if (
    !/^\/[a-zA-Z0-9_]+_test$/.test(test.pathname) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(test.hostname) ||
    (development && test.pathname === development.pathname)
  ) {
    throw new Error(
      "Tests require a separate loopback database ending in _test, different from DATABASE_URL. Development data will not be reset.",
    );
  }
  return value;
}
