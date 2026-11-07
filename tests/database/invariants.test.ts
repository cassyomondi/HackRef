import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { parseServerEnvironment } from "../../src/lib/env-validation";
import { testDatabaseUrl } from "../../src/lib/test-database";

loadEnvConfig(process.cwd());

test("PostgreSQL enforces provenance, approval terms and payout uniqueness", async (t) => {
  assert.ok(
    process.env.TEST_DATABASE_URL,
    "Set TEST_DATABASE_URL to a dedicated local test database. See docs/DEVELOPMENT.md.",
  );
  const { DATABASE_URL } = parseServerEnvironment({
    DATABASE_URL: testDatabaseUrl(),
  });
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const testSchema = `hackref_test_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${testSchema}"`);
    await client.query(`SET LOCAL search_path TO "${testSchema}"`);
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      const migration = await readFile(`drizzle/${tag}.sql`, "utf8");
      // Drizzle qualifies enum/FK references with public. Scope the actual SQL to
      // a transaction-local test schema so existing application tables are untouched.
      await client.query(migration.replaceAll('"public".', `"${testSchema}".`));
    }

    async function insert(table: string, values: Record<string, unknown>) {
      const columns = Object.keys(values);
      const result = await client.query<{ id: string }>(
        `INSERT INTO "${table}" (${columns.map((key) => `"${key}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        Object.values(values),
      );
      return result.rows[0].id;
    }

    async function rejectsSql(query: string, values: unknown[], code: string) {
      await client.query("SAVEPOINT expected_failure");
      try {
        await assert.rejects(client.query(query, values), (error: unknown) => {
          assert.equal((error as { code: string }).code, code);
          return true;
        });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT expected_failure");
        await client.query("RELEASE SAVEPOINT expected_failure");
      }
    }

    const organizer = await insert("organizer_users", {
      email: "organizer@example.test",
      display_name: "Organizer",
    });
    const event = await insert("hackathon_events", {
      organizer_id: organizer,
      slug: "foundation",
      name: "Foundation",
      deadline_at: "2026-11-12T20:59:59Z",
      budget_cents: 10000,
    });
    const otherOrganizer = await insert("organizer_users", {
      email: "other@example.test",
      display_name: "Other organizer (authorization fixture)",
    });
    const otherEvent = await insert("hackathon_events", {
      organizer_id: otherOrganizer,
      slug: "other",
      name: "Other",
      deadline_at: "2026-11-12T20:59:59Z",
    });
    const rubric = await insert("rubric_versions", {
      event_id: event,
      version: 1,
      title: "Rubric",
      criteria: JSON.stringify([
        { key: "quality", label: "Quality", maxScore: 10 },
      ]),
    });
    const otherRubric = await insert("rubric_versions", {
      event_id: otherEvent,
      version: 1,
      title: "Other rubric",
      criteria: "[]",
    });
    const submission = await insert("submissions", {
      event_id: event,
      name: "Project",
      team_name: "Team",
      repository_url: "https://github.com/example/project",
      commit_sha: "a".repeat(40),
    });
    const run = await insert("evaluation_runs", {
      event_id: event,
      submission_id: submission,
      rubric_version_id: rubric,
      idempotency_key: "run-1",
    });
    const secondRun = await insert("evaluation_runs", {
      event_id: event,
      submission_id: submission,
      rubric_version_id: rubric,
      idempotency_key: "run-2",
    });
    const source = await insert("evidence", {
      evaluation_run_id: run,
      source_uri: "https://github.com/example/project",
      method: "static_analysis",
    });
    const assessment = await insert("assessments", {
      event_id: event,
      submission_id: submission,
      evaluation_run_id: run,
      version: 1,
      scores: "{}",
      rationale: "For constraint tests only",
    });
    const award = await insert("awards", {
      event_id: event,
      submission_id: submission,
      assessment_id: assessment,
      title: "First prize",
      amount_cents: 1000,
      recipient_email: "winner@example.test",
    });

    await t.test("organizer email uniqueness is case insensitive", async () => {
      await rejectsSql(
        "INSERT INTO organizer_users (email, display_name) VALUES ($1, 'Duplicate')",
        ["ORGANIZER@example.test"],
        "23505",
      );
    });
    await t.test(
      "submissions require an immutable 40-character commit",
      async () => {
        await rejectsSql(
          "UPDATE submissions SET commit_sha = 'main' WHERE id = $1",
          [submission],
          "23514",
        );
      },
    );
    await t.test(
      "rubric versions and registered repositories are unique per event",
      async () => {
        await rejectsSql(
          "INSERT INTO rubric_versions (event_id, version, title, criteria) VALUES ($1, 1, 'Duplicate', '[]')",
          [event],
          "23505",
        );
        await rejectsSql(
          "INSERT INTO submissions (event_id, name, team_name, repository_url, commit_sha) SELECT event_id, name, team_name, repository_url, commit_sha FROM submissions WHERE id = $1",
          [submission],
          "23505",
        );
      },
    );
    await t.test(
      "evaluation cannot mix events and rubric versions",
      async () => {
        await rejectsSql(
          "UPDATE evaluation_runs SET rubric_version_id = $1 WHERE id = $2",
          [otherRubric, run],
          "23503",
        );
      },
    );
    await t.test("findings cannot cite another run's evidence", async () => {
      await rejectsSql(
        "INSERT INTO findings (evaluation_run_id, evidence_id, criterion_key, summary) VALUES ($1, $2, 'quality', 'Invalid evidence')",
        [secondRun, source],
        "23503",
      );
    });
    await t.test("awards require positive integer cents and USD", async () => {
      await rejectsSql(
        "UPDATE awards SET amount_cents = 0 WHERE id = $1",
        [award],
        "23514",
      );
      await rejectsSql(
        "UPDATE awards SET currency = 'EUR' WHERE id = $1",
        [award],
        "23514",
      );
    });
    const approvalSql =
      "INSERT INTO award_approvals (award_id, award_revision, assessment_id, amount_cents, currency, recipient_email, approved_by) VALUES ($1, 1, $2, $3, 'USD', $4, $5)";
    await t.test(
      "a draft assessment cannot authorize an award approval",
      async () => {
        await rejectsSql(
          approvalSql,
          [award, assessment, 1000, "winner@example.test", organizer],
          "23503",
        );
      },
    );
    await client.query(
      "UPDATE assessments SET status = 'finalized', scores = '{\"quality\":8}', finalized_by = $1, finalized_at = now() WHERE id = $2",
      [organizer, assessment],
    );
    await t.test(
      "approvals must match the exact recipient and amount",
      async () => {
        await rejectsSql(
          approvalSql,
          [award, assessment, 2000, "winner@example.test", organizer],
          "23503",
        );
        await rejectsSql(
          approvalSql,
          [award, assessment, 1000, "other@example.test", organizer],
          "23503",
        );
      },
    );
    const approval = await insert("award_approvals", {
      award_id: award,
      award_revision: 1,
      assessment_id: assessment,
      amount_cents: 1000,
      currency: "USD",
      recipient_email: "winner@example.test",
      approved_by: organizer,
    });
    await t.test("approved award terms cannot change silently", async () => {
      await rejectsSql(
        "UPDATE awards SET amount_cents = 2000 WHERE id = $1",
        [award],
        "23503",
      );
      await rejectsSql(
        "UPDATE assessments SET status = 'draft', finalized_by = NULL, finalized_at = NULL WHERE id = $1",
        [assessment],
        "23514",
      );
    });
    const payout = await insert("payouts", {
      award_id: award,
      approval_id: approval,
      sender_batch_id: "stable-batch-1",
      sender_item_id: "stable-item-1",
    });
    await t.test(
      "one payout intent per award prevents duplicate dispatch records",
      async () => {
        await rejectsSql(
          "INSERT INTO payouts (award_id, approval_id, sender_batch_id, sender_item_id) VALUES ($1, $2, 'another-batch', 'another-item')",
          [award, approval],
          "23505",
        );
      },
    );
    await t.test(
      "payouts require approval and cannot use live mode or unobserved success",
      async () => {
        await rejectsSql(
          "UPDATE payouts SET approval_id = $1 WHERE id = $2",
          [randomUUID(), payout],
          "23503",
        );
        await rejectsSql(
          "UPDATE payouts SET environment = 'live' WHERE id = $1",
          [payout],
          "23514",
        );
        await rejectsSql(
          "UPDATE payouts SET status = 'succeeded' WHERE id = $1",
          [payout],
          "23514",
        );
      },
    );
    await t.test(
      "evidence defaults to NOT_EVALUATED and deletion preserves history",
      async () => {
        const result = await client.query<{ status: string }>(
          "SELECT status FROM evidence WHERE id = $1",
          [source],
        );
        assert.equal(result.rows[0].status, "NOT_EVALUATED");
        await rejectsSql(
          "DELETE FROM hackathon_events WHERE id = $1",
          [event],
          "23503",
        );
      },
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
