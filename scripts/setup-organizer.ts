import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { organizerSessions, organizerUsers } from "../src/db/schema";
import { hashPassword } from "../src/lib/password";
import { cliDatabase } from "./cli-database";

async function secret(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error?: Error) {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }
    function onData(chunk: Buffer) {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003" || char === "\u0004")
          return finish(new Error("Setup cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b")
          value = Array.from(value).slice(0, -1).join("");
        else if (char >= " " && char !== "\u001b") value += char;
        if (Buffer.byteLength(value) > 256)
          return finish(new Error("Password exceeds 256 UTF-8 bytes."));
      }
    }
    stdin.on("data", onData);
  });
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Use an interactive terminal. Password arguments, environment variables and piped passwords are not accepted.",
    );
  const reset = process.argv.includes("--reset-password");
  const rl = createInterface({ input: stdin, output: stdout });
  let email: string;
  let displayName: string;
  try {
    email = z
      .email()
      .max(254)
      .parse((await rl.question("Organizer email: ")).trim().toLowerCase());
    displayName = reset
      ? ""
      : z
          .string()
          .trim()
          .min(1)
          .max(120)
          .parse(await rl.question("Display name: "));
  } finally {
    rl.close();
  }
  const password = await secret("Password (15+ characters; hidden): ");
  if (password !== (await secret("Confirm password (hidden): ")))
    throw new Error("Passwords did not match.");
  const passwordHash = await hashPassword(password);
  const { db, pool } = cliDatabase();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`LOCK TABLE organizer_users IN SHARE ROW EXCLUSIVE MODE`,
      );
      const [existing] = await tx
        .select()
        .from(organizerUsers)
        .where(isNotNull(organizerUsers.passwordHash))
        .limit(1);
      if (reset) {
        if (!existing || existing.email.toLowerCase() !== email)
          throw new Error("No provisioned organizer matches that email.");
        await tx
          .update(organizerUsers)
          .set({ passwordHash })
          .where(eq(organizerUsers.id, existing.id));
        await tx
          .delete(organizerSessions)
          .where(eq(organizerSessions.organizerId, existing.id));
      } else {
        if (existing)
          throw new Error(
            "An organizer is already provisioned. Use --reset-password to rotate its password and revoke all sessions.",
          );
        // Provision a PASS 1 identity if it already exists; do not replace its ID.
        const [identity] = await tx
          .select()
          .from(organizerUsers)
          .where(sql`lower(${organizerUsers.email}) = ${email}`)
          .limit(1);
        if (identity)
          await tx
            .update(organizerUsers)
            .set({ displayName, passwordHash })
            .where(eq(organizerUsers.id, identity.id));
        else
          await tx
            .insert(organizerUsers)
            .values({ email, displayName, passwordHash });
      }
    });
    console.log(
      reset
        ? "Organizer password rotated; all existing sessions revoked."
        : "Organizer provisioned. No public registration endpoint exists.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof z.ZodError
      ? "Invalid email or display name."
      : error instanceof Error && !("query" in error) && !("code" in error)
        ? error.message
        : "Organizer setup failed. Check database availability and migrations; connection details omitted.",
  );
  process.exitCode = 1;
});
