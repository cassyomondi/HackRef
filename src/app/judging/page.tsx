import type { Metadata } from "next";
import {
  Card,
  EmptyState,
  PageHeading,
  PlaceholderNotice,
  PlannedBadge,
} from "@/components/workspace-ui";

export const metadata: Metadata = { title: "Judging" };

export default function Judging() {
  return (
    <>
      <PageHeading
        eyebrow="ASSESS & REVIEW"
        title="Judging"
        description="Consistent criteria. Visible evidence. A human decision at every step."
      />
      <PlaceholderNotice />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card
          title="Assessment workspace"
          subtitle="AI recommendations will require organizer review"
          action={<PlannedBadge />}
        >
          <EmptyState
            icon="scale"
            title="Nothing ready for review"
            description="No assessments are loaded. Evaluation runs, evidence-linked findings, suggested scores and organizer decisions will appear here after the evaluation workflow is implemented."
            href="/submissions"
            linkLabel="View submissions"
          />
        </Card>
        <Card
          title="Versioned rubric"
          subtitle="No rubric loaded"
          action={<PlannedBadge />}
        >
          <div className="p-5">
            <p className="text-xs leading-6 text-slate-500">
              Future assessments will reference an exact rubric version so
              criteria remain traceable as your event evolves.
            </p>
            <div className="mt-5 rounded-lg border border-dashed border-slate-200 p-4 text-xs leading-6 text-slate-500">
              Rubric editing, AG Grid, Gemini and the evaluation worker are not
              integrated in PASS 1.
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
