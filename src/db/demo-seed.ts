import { eq, isNotNull } from "drizzle-orm";
import type { Database } from "./connection";
import {
  hackathonEvents,
  organizerUsers,
  rubricVersions,
  submissions,
} from "./schema";
import { AppError } from "../lib/errors";

export const DEMO_COMMIT = "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d";

/** Fixed, offline, idempotent development fixtures. No organizer or credentials are seeded. */
export async function seedDemo(db: Database) {
  return db.transaction(async (tx) => {
    const [organizer] = await tx
      .select()
      .from(organizerUsers)
      .where(isNotNull(organizerUsers.passwordHash))
      .limit(1)
      .for("update");
    if (!organizer)
      throw new AppError(
        409,
        "Provision your organizer with npm run organizer:setup before seeding.",
      );
    const [existing] = await tx
      .select()
      .from(hackathonEvents)
      .where(eq(hackathonEvents.organizerId, organizer.id));
    if (existing && (!existing.isDemo || existing.slug !== "hackref-demo"))
      throw new AppError(
        409,
        "Seed refused: the organizer already owns a non-demo event. No data was changed.",
      );
    const event =
      existing ??
      (
        await tx
          .insert(hackathonEvents)
          .values({
            organizerId: organizer.id,
            slug: "hackref-demo",
            name: "DEMO · HackRef development event",
            status: "open",
            deadlineAt: new Date("2026-11-12T20:59:59Z"),
            isDemo: true,
          })
          .returning()
      )[0];
    await tx
      .insert(rubricVersions)
      .values({
        eventId: event.id,
        version: 1,
        title: "DEMO · Example rubric",
        criteria: [
          { key: "quality", label: "Engineering quality", maxScore: 10 },
          { key: "clarity", label: "Documentation clarity", maxScore: 10 },
        ],
      })
      .onConflictDoNothing({
        target: [rubricVersions.eventId, rubricVersions.version],
      });
    await tx
      .insert(submissions)
      .values({
        eventId: event.id,
        name: "DEMO · Hello World",
        teamName: "DEMO · Example team (not the repository owner)",
        repositoryUrl: "https://github.com/octocat/hello-world",
        repositoryOwner: "octocat",
        githubRepositoryId: "1296269",
        commitSha: DEMO_COMMIT,
        claims: [
          "DEMO STATEMENT: This example claims to provide a Hello World README. This is a UI fixture, not a verified project finding or an actual hackathon submission.",
        ],
        ownershipAttested: true,
        isDemo: true,
      })
      .onConflictDoNothing({
        target: [submissions.eventId, submissions.repositoryUrl],
      });
    return event.id;
  });
}
