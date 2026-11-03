import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { login, authenticate } from "../../src/lib/auth-service";
import { organizerUsers } from "../../src/db/schema";
import { isolatedDatabase } from "../helpers/database";

// util-linux `script` provides a real PTY so password echo and interactive input
// are exercised, rather than testing a bypass unavailable to the real command.
async function setup(
  connectionString: string,
  password: string,
  reset = false,
) {
  const child = spawn(
    "script",
    [
      "-q",
      "-e",
      "-c",
      `node --import tsx scripts/setup-organizer.ts${reset ? " --reset-password" : ""}`,
      "/dev/null",
    ],
    {
      env: { ...process.env, DATABASE_URL: connectionString },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const prompts: Array<[string, string]> = [
    ["Organizer email: ", "cli@example.test\n"],
  ];
  if (!reset) prompts.push(["Display name: ", "CLI test organizer\n"]);
  prompts.push(
    ["Password (15+ characters; hidden): ", `${password}\r`],
    ["Confirm password (hidden): ", `${password}\r`],
  );
  let output = "";
  let step = 0;
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (step < prompts.length && output.includes(prompts[step][0])) {
      child.stdin.write(prompts[step][1]);
      step++;
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("exit", resolve);
      child.on("error", reject);
    });
    assert.ok(
      !output.includes(password),
      "The password must never be echoed or logged.",
    );
    return { code, output };
  } finally {
    clearTimeout(timeout);
  }
}

test(
  "interactive setup provisions once and password reset revokes all sessions",
  { timeout: 60000 },
  async () => {
    const fixture = await isolatedDatabase();
    try {
      const password = randomBytes(24).toString("base64url");
      const created = await setup(fixture.connectionString, password);
      assert.equal(created.code, 0, "Interactive organizer setup failed.");
      const [organizer] = await fixture.db.select().from(organizerUsers);
      assert.equal(organizer.email, "cli@example.test");
      assert.ok(organizer.passwordHash);
      const token = await login(fixture.db, {
        email: organizer.email,
        password,
      });
      assert.equal((await authenticate(fixture.db, token)).id, organizer.id);
      const duplicate = await setup(
        fixture.connectionString,
        randomBytes(24).toString("base64url"),
      );
      assert.equal(duplicate.code, 1);
      assert.match(duplicate.output, /already provisioned/);
      const nextPassword = randomBytes(24).toString("base64url");
      assert.equal(
        (await setup(fixture.connectionString, nextPassword, true)).code,
        0,
      );
      await assert.rejects(authenticate(fixture.db, token));
      await assert.rejects(
        login(fixture.db, { email: organizer.email, password }),
      );
      assert.ok(
        await login(fixture.db, {
          email: organizer.email,
          password: nextPassword,
        }),
      );
    } finally {
      await fixture.close();
    }
  },
);
