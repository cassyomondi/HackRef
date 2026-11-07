import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Card, PageHeading } from "@/components/workspace-ui";
import { EventForm, RubricForm } from "@/components/management-forms";
import { getDatabase } from "@/db/client";
import { hackathonEvents, rubricVersions } from "@/db/schema";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Event & rubric" };
export default async function EventPage() {
  const organizer = await requirePageOrganizer();
  const db = getDatabase();
  const [event] = await db
    .select()
    .from(hackathonEvents)
    .where(eq(hackathonEvents.organizerId, organizer.id))
    .limit(1);
  const rubrics = event
    ? await db
        .select()
        .from(rubricVersions)
        .where(eq(rubricVersions.eventId, event.id))
        .orderBy(desc(rubricVersions.version))
    : [];
  return (
    <>
      <PageHeading
        eyebrow="SET THE CRITERIA"
        title="Event & rubric"
        description="One event. Clear criteria. Every rubric change keeps its own version."
      />
      {event?.isDemo && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          DEMO DATA · This event was created by the development seed.
        </p>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card title={event ? "Event details" : "Create your event"}>
          <EventForm
            event={
              event
                ? {
                    name: event.name,
                    slug: event.slug,
                    status: event.status,
                    deadlineAt: event.deadlineAt.toISOString(),
                  }
                : undefined
            }
          />
        </Card>
        {event && (
          <Card
            title="Publish a rubric"
            subtitle="New jobs can select any published version"
          >
            <RubricForm />
          </Card>
        )}
      </div>
      <div className="mt-6 space-y-4">
        {rubrics.map((rubric) => (
          <Card
            key={rubric.id}
            title={`${rubric.title} · v${rubric.version}`}
            subtitle="Immutable rubric snapshot"
          >
            <ul className="divide-y divide-slate-100 px-5 text-xs text-slate-600">
              {rubric.criteria.map((criterion) => (
                <li
                  key={criterion.key}
                  className="flex justify-between gap-4 py-3"
                >
                  <span className="min-w-0 break-words">
                    {criterion.label}{" "}
                    <code className="text-slate-400">({criterion.key})</code>
                  </span>
                  <span className="shrink-0">{criterion.maxScore} points</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
