// Executed only by the database tests. All HTTP is injected, and the database
// URL must pass the same dedicated-test-database guard as the parent suite.
import { connectDatabase } from "../../src/db/connection";
import { sendSandboxPayout } from "../../src/lib/payouts";
import { testDatabaseUrl } from "../../src/lib/test-database";
import { paypalFixture, sandboxEnv } from "./paypal";

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const url = testDatabaseUrl({ TEST_DATABASE_URL: input.connectionString });
  const connection = connectDatabase(url), fixture = paypalFixture();
  try {
    const fetcher: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token" && input.mode === "crash-prepared") process.exit(81);
      if (path === "/v1/payments/payouts") {
        // Test-only stand-in for an external provider receiving the request.
        await connection.pool.query("INSERT INTO mock_provider_dispatches (award_id) VALUES ($1)", [input.awardId]);
        if (input.mode === "crash-started") process.exit(82);
      }
      return fixture.fetcher(url, init);
    };
    const result = await sendSandboxPayout(connection.db, input.organizerId, input.awardId, input.terms, { env: sandboxEnv, fetcher });
    process.stdout.write(JSON.stringify({ payoutId: result.payout.id, created: result.created, state: result.payout.dispatchState }));
  } finally { await connection.pool.end(); }
}
main().catch(() => { process.stderr.write("Isolated mocked payout process failed."); process.exitCode = 1; });
