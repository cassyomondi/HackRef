import type { Metadata } from "next";
import {
  Card,
  EmptyState,
  PageHeading,
  PlaceholderNotice,
  PlannedBadge,
} from "@/components/workspace-ui";

export const metadata: Metadata = { title: "Analytics" };

export default function Analytics() {
  return (
    <>
      <PageHeading
        eyebrow="COMPARE & UNDERSTAND"
        title="Analytics"
        description="See the story behind the scores, with the evidence still in view."
      />
      <PlaceholderNotice />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Rubric score comparison"
          subtitle="Chart placeholder · no assessment data"
          action={<PlannedBadge />}
        >
          <EmptyState
            icon="chart"
            title="Comparisons will start here"
            description="Once reviewed assessments are available, compare projects across rubric criteria. There are no sample scores or generated rankings in this preview."
          />
        </Card>
        <Card
          title="Evidence coverage"
          subtitle="Chart placeholder · no evidence data"
          action={<PlannedBadge />}
        >
          <EmptyState
            icon="layers"
            title="Coverage needs context"
            description="Future analytics will show verified evidence alongside gaps and evaluation limits. AG Studio is not installed or connected in this pass."
          />
        </Card>
      </div>
      <p className="mt-5 text-xs leading-6 text-slate-500">
        Analytics will support organizer judgment. No automated ranking or award
        decision is made here.
      </p>
    </>
  );
}
