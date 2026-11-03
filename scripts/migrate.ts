import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { parseServerEnvironment } from "../src/lib/env-validation";

async function main() {
  loadEnvConfig(process.cwd());
  const { DATABASE_URL } = parseServerEnvironment(process.env);
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Database migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    "Migration failed. Check DATABASE_URL, database availability and migration compatibility. Connection details are omitted.",
  );
  process.exitCode = 1;
});
