import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { getDatabase } from "@/db/client";
import { submissions } from "@/db/schema";
import { ownedEvent } from "@/lib/event-service";
import { AppError } from "@/lib/errors";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Submissions" };

export default async function Submissions() {
  const organizer = await requirePageOrganizer();
  const db = getDatabase();
  const event = await ownedEvent(db, organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  const [totals] = event ? await db.select({ count: count() }).from(submissions).where(eq(submissions.eventId, event.id)) : [{ count: 0 }];
  const rows = event
    ? await db
        .select()
        .from(submissions)
        .where(eq(submissions.eventId, event.id))
        .orderBy(desc(submissions.createdAt))
        .limit(200)
    : [];
  return (
    <>
      <PageHeading
        eyebrow="COLLECT & ORGANIZE"
        title="Submissions"
        description="Give every project a clear starting point and a traceable source."
      >
        <Link href="/submissions/new" className="rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900">+ Register submission</Link>
      </PageHeading>
      {event?.isDemo && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          DEMO DATA · {event.name}. Demo claims are examples and have not been
          verified.
        </p>
      )}
      <Card
        title="Project registry"
        subtitle={
          event
            ? `${event.name} · ${totals.count} registered projects${totals.count > rows.length ? ` (showing latest ${rows.length})` : ""}`
            : "Create your event before registering projects"
        }
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-500">
                <tr>
                  {[
                    "PROJECT / TEAM",
                    "REPOSITORY",
                    "PINNED COMMIT",
                    "CLAIMS STATUS",
                  ].map((label) => (
                    <th key={label} className="px-5 py-3 font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-4">
                      <Link
                        href={`/submissions/${row.id}`}
                        className="font-semibold text-teal-800 underline decoration-teal-200 underline-offset-4"
                      >
                        {row.name}
                      </Link>
                      <p className="mt-1 text-slate-500">
                        {row.teamName}
                        {row.isDemo ? " · DEMO" : ""}
                      </p>
                    </td>
                    <td className="max-w-60 px-5 py-4 break-all">
                      <a
                        href={row.repositoryUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-600 underline"
                      >
                        {row.repositoryUrl.replace("https://github.com/", "")}
                      </a>
                    </td>
                    <td className="px-5 py-4">
                      <code title={row.commitSha}>
                        {row.commitSha.slice(0, 12)}
                      </code>
                    </td>
                    <td className="px-5 py-4 text-slate-500">Not evaluated</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="file"
            title={
              event ? "Ready for the first submission" : "Set up your event"
            }
            description={
              event
                ? "Register a public GitHub repository, record explicit claims and pin an exact commit."
                : "Create one organizer-owned event and publish a rubric before queueing evaluations."
            }
            href={event ? undefined : "/event"}
            linkLabel="Set up event & rubric"
          />
        )}
      </Card>
    </>
  );
}
