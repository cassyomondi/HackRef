import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import {
  hackathonEvents,
  organizerUsers,
  rubricVersions,
  submissions,
} from "../db/schema";
import { AppError } from "./errors";
import { resolveRepository, type GitHubFetch } from "./github";
import { eventInput, rubricInput, submissionInput } from "./validation";
import { committedAwardCents } from "./award-budget";

export async function ownedEvent(db: Database, organizerId: string) {
  const [event] = await db
    .select()
    .from(hackathonEvents)
    .where(eq(hackathonEvents.organizerId, organizerId))
    .limit(1);
  if (!event) throw new AppError(404, "Set up your event first.");
  return event;
}

export async function saveEvent(
  db: Database,
  organizerId: string,
  input: unknown,
) {
  const data = eventInput.parse(input);
  return db.transaction(async (tx) => {
    // Serialize creation, including concurrent first requests. NO KEY UPDATE
    // permits the KEY SHARE foreign-key checks used by award/approval audits,
    // so an event edit waiting for the budget lock cannot deadlock an award.
    await tx
      .select({ id: organizerUsers.id })
      .from(organizerUsers)
      .where(eq(organizerUsers.id, organizerId))
      .for("no key update");
    const [current] = await tx
      .select()
      .from(hackathonEvents)
      .where(eq(hackathonEvents.organizerId, organizerId))
      .for("update");
    if (current && data.budgetCents !== undefined && data.budgetCents < await committedAwardCents(tx, current.id)) {
      const message = "The budget cannot be below the total reserved by allocated and approved awards.";
      throw new AppError(409, message, false, undefined, [{ field: "budgetCents", message }]);
    }
    const values = { ...data, deadlineAt: new Date(data.deadlineAt) };
    const [saved] = current
      ? await tx
          .update(hackathonEvents)
          .set(values)
          .where(eq(hackathonEvents.id, current.id))
          .returning()
      : await tx
          .insert(hackathonEvents)
          .values({ ...values, organizerId })
          .returning();
    return saved;
  });
}

export async function addRubric(
  db: Database,
  organizerId: string,
  input: unknown,
) {
  const data = rubricInput.parse(input);
  const event = await ownedEvent(db, organizerId);
  return db.transaction(async (tx) => {
    await tx
      .select({ id: hackathonEvents.id })
      .from(hackathonEvents)
      .where(
        and(
          eq(hackathonEvents.id, event.id),
          eq(hackathonEvents.organizerId, organizerId),
        ),
      )
      .for("update");
    const [latest] = await tx
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.eventId, event.id))
      .orderBy(desc(rubricVersions.version))
      .limit(1);
    const [saved] = await tx
      .insert(rubricVersions)
      .values({
        ...data,
        eventId: event.id,
        version: (latest?.version ?? 0) + 1,
      })
      .returning();
    return saved;
  });
}

export async function registerSubmission(
  db: Database,
  organizerId: string,
  input: unknown,
  fetcher?: GitHubFetch,
) {
  const data = submissionInput.parse(input);
  const event = await ownedEvent(db, organizerId);
  const pinned = await resolveRepository(data.repositoryUrl, data.ref, fetcher);
  const [saved] = await db
    .insert(submissions)
    .values({
      eventId: event.id,
      name: data.name,
      teamName: data.teamName,
      claims: data.claims,
      ownershipAttested: true,
      ...pinned,
    })
    .onConflictDoNothing({
      target: [submissions.eventId, submissions.repositoryUrl],
    })
    .returning();
  if (!saved)
    throw new AppError(
      409,
      "This repository is already registered for your event.",
    );
  return saved;
}

export async function ownedSubmission(
  db: Database,
  organizerId: string,
  submissionId: string,
) {
  const event = await ownedEvent(db, organizerId);
  const [submission] = await db
    .select()
    .from(submissions)
    .where(
      and(eq(submissions.id, submissionId), eq(submissions.eventId, event.id)),
    )
    .limit(1);
  if (!submission) throw new AppError(404, "Submission not found.");
  return submission;
}
