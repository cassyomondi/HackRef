import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { loginLimits, organizerSessions, organizerUsers } from "../db/schema";
import { SESSION_SECONDS } from "./auth-config";
import { AppError } from "./errors";
import { verifyPassword } from "./password";

const loginInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(1)
      .max(256)
      .refine((v) => Buffer.byteLength(v) <= 256),
  })
  .strict();
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function login(db: Database, input: unknown) {
  const { email, password } = loginInput.parse(input);
  const reserved = await db
    .insert(loginLimits)
    .values({ key: "organizer", attempts: 1, windowStartedAt: new Date() })
    .onConflictDoUpdate({
      target: loginLimits.key,
      set: {
        attempts: sql`CASE WHEN ${loginLimits.windowStartedAt} < now() - interval '15 minutes' THEN 1 ELSE ${loginLimits.attempts} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${loginLimits.windowStartedAt} < now() - interval '15 minutes' THEN now() ELSE ${loginLimits.windowStartedAt} END`,
      },
      setWhere: sql`${loginLimits.attempts} < 10 OR ${loginLimits.windowStartedAt} < now() - interval '15 minutes'`,
    })
    .returning();
  if (!reserved.length)
    throw new AppError(
      429,
      "Too many login attempts. Try again in 15 minutes.",
    );
  const [organizer] = await db
    .select()
    .from(organizerUsers)
    .where(
      and(
        sql`lower(${organizerUsers.email}) = ${email}`,
        isNotNull(organizerUsers.passwordHash),
      ),
    )
    .limit(1);
  if (
    !(await verifyPassword(password, organizer?.passwordHash ?? null)) ||
    !organizer
  )
    throw new AppError(401, "Invalid email or password.");
  const token = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    // Serialize with password rotation so a stale password cannot create a new
    // session immediately after the reset command revokes existing sessions.
    const [current] = await tx
      .select({ id: organizerUsers.id })
      .from(organizerUsers)
      .where(
        and(
          eq(organizerUsers.id, organizer.id),
          eq(organizerUsers.passwordHash, organizer.passwordHash!),
        ),
      )
      .for("update");
    if (!current) throw new AppError(401, "Invalid email or password.");
    await tx
      .delete(organizerSessions)
      .where(lt(organizerSessions.expiresAt, new Date()));
    await tx.insert(organizerSessions).values({
      tokenHash: tokenHash(token),
      organizerId: organizer.id,
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    });
  });
  return token;
}

export async function authenticate(db: Database, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "Sign in to continue.");
  const [row] = await db
    .select({
      id: organizerUsers.id,
      email: organizerUsers.email,
      displayName: organizerUsers.displayName,
    })
    .from(organizerSessions)
    .innerJoin(
      organizerUsers,
      eq(organizerUsers.id, organizerSessions.organizerId),
    )
    .where(
      and(
        eq(organizerSessions.tokenHash, tokenHash(token)),
        gt(organizerSessions.expiresAt, new Date()),
        isNotNull(organizerUsers.passwordHash),
      ),
    )
    .limit(1);
  if (!row) throw new AppError(401, "Your session has expired. Sign in again.");
  return row;
}

export async function logout(db: Database, token: string | undefined) {
  if (token)
    await db
      .delete(organizerSessions)
      .where(eq(organizerSessions.tokenHash, tokenHash(token)));
}
