import type { Metadata } from "next";
import Link from "next/link";
import { SubmissionForm } from "@/components/management-forms";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { getDatabase } from "@/db/client";
import { AppError } from "@/lib/errors";
import { ownedEvent } from "@/lib/event-service";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Register submission" };

export default async function NewSubmission() {
  const organizer = await requirePageOrganizer();
  const event = await ownedEvent(getDatabase(), organizer.id).catch((error) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  return <>
    <Link href="/submissions" className="mb-5 inline-block text-xs text-teal-700">← All submissions</Link>
    <PageHeading eyebrow="PROJECT REGISTRATION" title="Register submission" description={event ? `Register a project for ${event.name} and pin its source commit.` : "Create your event before registering projects."} />
    <Card title="Submission details" subtitle="Public GitHub metadata only · repository code is never executed">
      {event ? <SubmissionForm /> : <EmptyState icon="file" title="Set up your event" description="Create your organizer-owned event before registering a submission." href="/event" linkLabel="Set up event & rubric" />}
    </Card>
  </>;
}
