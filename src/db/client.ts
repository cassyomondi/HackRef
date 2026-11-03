import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnvironment } from "@/lib/env";
import * as schema from "./schema";

const globalDatabase = globalThis as unknown as { hackrefPool?: Pool };

/** Lazy: the placeholder shell never opens a database connection. */
export function getDatabase() {
  const { DATABASE_URL } = getServerEnvironment();
  const pool =
    globalDatabase.hackrefPool ??
    new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  globalDatabase.hackrefPool = pool;
  return drizzle(pool, { schema });
}
