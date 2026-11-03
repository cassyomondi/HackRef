import type { Metadata } from "next";
import {
  Card,
  EmptyState,
  PageHeading,
  PlaceholderNotice,
  PlannedBadge,
  StatCard,
} from "@/components/workspace-ui";

export const metadata: Metadata = { title: "Awards" };

export default function Awards() {
  return (
    <>
      <PageHeading
        eyebrow="RECOGNIZE & APPROVE"
        title="Awards"
        description="Turn reviewed decisions into awards with an explicit human approval."
      />
      <PlaceholderNotice />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon="trophy"
          label="Prize budget · USD"
          detail="No event budget loaded"
        />
        <StatCard
          icon="shield"
          label="Approved awards"
          detail="Approval workflow is not connected"
        />
        <StatCard
          icon="clock"
          label="Payout records"
          detail="No payout records loaded"
        />
      </div>
      <Card
        title="Award register"
        subtitle="Planned flow: allocate → approve exact terms → initiate sandbox payout"
        action={<PlannedBadge />}
      >
        <EmptyState
          icon="trophy"
          title="Recognition starts with a reviewed decision"
          description="No awards are loaded. Future approvals will bind the recipient, USD amount, award revision and finalized assessment. Payout actions are unavailable in this preview."
          href="/judging"
          linkLabel="View judging workspace"
        />
      </Card>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xs font-semibold text-slate-700">
          PayPal sandbox spike stays separate
        </h2>
        <p className="mt-2 text-xs leading-6 text-slate-500">
          The tested PayPal sandbox spike is preserved as an isolated
          experiment. This application has no PayPal credentials, payout
          dispatch or reconciliation integration. No API requests are made.
        </p>
      </div>
    </>
  );
}
