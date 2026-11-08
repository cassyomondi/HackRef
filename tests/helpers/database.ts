import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { testDatabaseUrl } from "../../src/lib/test-database";

export async function isolatedDatabase(throughTag?: string) {
  loadEnvConfig(process.cwd());
  const url = testDatabaseUrl();
  const name = `hackref_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const pool = new Pool({
    connectionString: url,
    max: 5,
    options: `-c search_path=${name}`,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  try {
    await admin.query(`CREATE SCHEMA "${name}"`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const journal = JSON.parse(
        await readFile("drizzle/meta/_journal.json", "utf8"),
      ) as { entries: Array<{ tag: string }> };
      if (throughTag && !journal.entries.some(entry => entry.tag === throughTag)) throw new Error("Unknown fixture migration boundary.");
      for (const { tag } of journal.entries) {
        const migration = await readFile(`drizzle/${tag}.sql`, "utf8");
        await client.query(migration.replaceAll('"public".', `"${name}".`));
        if (tag === throughTag) break;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    await admin.end();
    throw error;
  }
  const connection = new URL(url);
  connection.searchParams.set("options", `-c search_path=${name}`);
  return {
    schemaName: name,
    db: drizzle(pool, { schema }),
    pool,
    connectionString: connection.toString(),
    async close() {
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
