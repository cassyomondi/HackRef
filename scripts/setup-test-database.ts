import { loadEnvConfig } from "@next/env";
import { appendFileSync } from "node:fs";
import { Pool } from "pg";
import { parseServerEnvironment } from "../src/lib/env-validation";
import { testDatabaseUrl } from "../src/lib/test-database";

async function main() {
  loadEnvConfig(process.cwd());
  const { DATABASE_URL } = parseServerEnvironment(process.env);
  const derived = new URL(DATABASE_URL);
  derived.pathname += "_test";
  const testUrl = testDatabaseUrl({
    ...process.env,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || derived.toString(),
  });
  const target = new URL(testUrl);
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  const pool = new Pool({
    connectionString: admin.toString(),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const name = target.pathname.slice(1);
    const result = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (!result.rowCount) await pool.query(`CREATE DATABASE "${name}"`); // Name was restricted to alphanumeric/underscore by testDatabaseUrl.
    if (!process.env.TEST_DATABASE_URL)
      appendFileSync(
        ".env",
        `\nTEST_DATABASE_URL=${testUrl.replaceAll("$", "\\$")}\n`,
        { mode: 0o600 },
      );
    console.log(
      "Dedicated test database is available; TEST_DATABASE_URL is configured. No existing database was reset.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Test database setup failed. Check local PostgreSQL permissions (CREATEDB) and the separate TEST_DATABASE_URL. Connection details omitted.",
  );
  process.exitCode = 1;
});
