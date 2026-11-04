import { setTimeout } from "node:timers/promises";
import { claimJob, processJob } from "../src/lib/jobs";
import { cliDatabase } from "./cli-database";

async function main() {
  const { db, pool } = cliDatabase();
  const once = process.argv.includes("--once");
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(
    once
      ? "HackRef worker: process at most one eligible job (PASS 2 or AI draft)."
      : "HackRef worker started. SIGINT/SIGTERM stops after the active job.",
  );
  try {
    do {
      try {
        const job = await claimJob(db);
        if (job) {
          console.log(
            `Processing job ${job.id}, attempt ${job.attempts}/${job.maxAttempts}.`,
          );
          await processJob(db, job);
          console.log(
            `Finished attempt for job ${job.id}. Check persisted status for outcome.`,
          );
        } else if (!once && !stopping) await setTimeout(1000);
      } catch {
        console.error(
          "Worker database operation failed. Existing leases will recover after expiry.",
        );
        if (once) {
          process.exitCode = 1;
          break;
        }
        if (!stopping) await setTimeout(5000);
      }
    } while (!once && !stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await pool.end();
    console.log("HackRef worker stopped.");
  }
}
main().catch(() => {
  console.error(
    "Worker startup failed. Check server environment and migrations.",
  );
  process.exitCode = 1;
});
