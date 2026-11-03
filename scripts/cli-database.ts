import { loadEnvConfig } from "@next/env";
import { connectDatabase } from "../src/db/connection";
import { parseServerEnvironment } from "../src/lib/env-validation";

export function cliDatabase() {
  loadEnvConfig(process.cwd());
  const { DATABASE_URL } = parseServerEnvironment(process.env);
  return connectDatabase(DATABASE_URL);
}
