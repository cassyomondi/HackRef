import type { Metadata } from "next";
import {
  Card,
  EmptyState,
  PageHeading,
  PlaceholderNotice,
  PlannedBadge,
} from "@/components/workspace-ui";

export const metadata: Metadata = { title: "Submissions" };

export default function Submissions() {
  return (
    <>
      <PageHeading
        eyebrow="COLLECT & ORGANIZE"
        title="Submissions"
        description="Give every project a clear starting point and a traceable source."
      />
      <PlaceholderNotice />
      <Card
        title="Project registry"
        subtitle="Planned fields: project, team, repository and pinned commit"
        action={<PlannedBadge />}
      >
        <div className="hidden grid-cols-4 gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[10px] font-semibold tracking-wide text-slate-500 sm:grid">
          <span>PROJECT / TEAM</span>
          <span>REPOSITORY</span>
          <span>PINNED COMMIT</span>
          <span>EVIDENCE STATUS</span>
        </div>
        <EmptyState
          icon="file"
          title="No submissions loaded"
          description="This is an empty preview. A later pass will let organizers register public GitHub repositories and pin exact commits. Participant code will never run on the application host."
        />
      </Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card title="Source collection" action={<PlannedBadge />}>
          <p className="p-5 text-xs leading-6 text-slate-500">
            Bounded, read-only collection will preserve file paths, content
            hashes and coverage limits. No repository fetching is available yet.
          </p>
        </Card>
        <Card title="Evidence provenance" action={<PlannedBadge />}>
          <p className="p-5 text-xs leading-6 text-slate-500">
            Evidence will distinguish verified, unverified, failed and not
            evaluated checks. Missing evidence will not automatically count as
            failure.
          </p>
        </Card>
      </div>
    </>
  );
}
