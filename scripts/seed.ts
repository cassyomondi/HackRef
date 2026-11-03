import { seedDemo } from "../src/db/demo-seed";
import { AppError } from "../src/lib/errors";
import { cliDatabase } from "./cli-database";

async function main() {
  const { db, pool } = cliDatabase();
  try {
    if (process.env.NODE_ENV === "production")
      throw new AppError(403, "Demo seed is disabled in production.");
    const target = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
      throw new AppError(403, "Demo seed requires a local database.");
    await seedDemo(db);
    console.log(
      "DEMO data seeded without overwriting existing rows. No credentials, assessments, findings, jobs or financial records were created.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof AppError
      ? error.message
      : "Demo seed failed. Check database availability and migrations; connection details omitted.",
  );
  process.exitCode = 1;
});
