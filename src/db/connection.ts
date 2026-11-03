import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function connectDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  pool.on("error", () => {
    console.error(
      "HackRef database connection interrupted; later queries will reconnect.",
    );
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof connectDatabase>["db"];
