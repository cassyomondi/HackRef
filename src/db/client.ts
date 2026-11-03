import "server-only";
import { getServerEnvironment } from "@/lib/env";
import { connectDatabase } from "./connection";

const globalDatabase = globalThis as unknown as {
  hackrefDatabase?: ReturnType<typeof connectDatabase>;
};

/** Lazy: builds never connect to PostgreSQL. */
export function getDatabase() {
  const { DATABASE_URL } = getServerEnvironment();
  globalDatabase.hackrefDatabase ??= connectDatabase(DATABASE_URL);
  return globalDatabase.hackrefDatabase.db;
}
