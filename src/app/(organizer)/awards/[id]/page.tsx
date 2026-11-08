import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReconcilePayoutForm, SandboxSendForm } from "@/components/payout-controls";
import { sandboxReadiness } from "@/lib/payouts";
import { payoutExplanation } from "@/lib/payout-presentation";
import { maskRecipient } from "@/lib/money";
import { and, asc, eq } from "drizzle-orm";
import { auditEvents } from "@/db/schema";
import { AwardApprovalForm } from "@/components/award-forms";
import { Card, PageHeading } from "@/components/workspace-ui";
import { getDatabase } from "@/db/client";
import { awardPreview } from "@/lib/awards";
import { AppError } from "@/lib/errors";
import { formatUsd } from "@/lib/money";
import { requirePageOrganizer } from "@/lib/session";
import { uuidInput } from "@/lib/validation";

export const metadata: Metadata = { title: "Review award terms" };
const linkClass = "font-semibold text-teal-800 underline underline-offset-4";

export default async function AwardPage({ params }: { params: Promise<{ id: string }> }) {
  const organizer = await requirePageOrganizer();
  const { id } = await params;
  if (!uuidInput.safeParse(id).success) notFound();
  const preview = await awardPreview(getDatabase(), organizer.id, id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const { award, event, project, assessment, reservedCents, approval, approver, payoutStatus, payout } = preview;
  const history = payout ? await getDatabase().select({ id: auditEvents.id, action: auditEvents.action, metadata: auditEvents.metadata, createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.eventId, event.id), eq(auditEvents.entityId, payout.id), eq(auditEvents.entityType, "payout"))).orderBy(asc(auditEvents.createdAt)) : [];
  const blocked = !assessment || reservedCents > event.budgetCents;
  return <>
    <PageHeading eyebrow="EXACT-TERM ORGANIZER APPROVAL" title={approval ? "Award approved" : "Review award terms"} description="Check every detail. Approval records your decision permanently and sends no payment.">
      <Link href="/awards" className={linkClass}>← Award register</Link>
    </PageHeading>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card title={award.title} subtitle={`${project} · award revision ${award.revision}`}>
        <dl className="grid gap-5 p-5 text-sm sm:grid-cols-2">
          {[
            ["Project", project], ["Award title", award.title],
            ["Exact amount", formatUsd(award.amountCents)], ["Recipient email · private", award.recipientEmail],
            ["Award revision", String(award.revision)], ["Human-finalized assessment", assessment ? `v${assessment.version} · ${assessment.finalScore} / ${assessment.maxScore} points` : "Unavailable · approval blocked"],
            ["Assessment ID", award.assessmentId], ["Assessment finalized by", assessment?.reviewer ?? "Unavailable"],
            ["Finalized at (UTC)", assessment?.finalizedAt?.toISOString() ?? "Unavailable"],
            ["Payout state", payoutStatus ? `Existing record · ${payoutStatus}` : "Not sent · no payout record"],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1.5 break-words font-semibold text-slate-800">{value}</dd></div>)}
        </dl>
        {assessment && <p className="px-5 pb-5 text-xs leading-6 text-slate-500"><Link href={assessment.sourceDraftId ? `/judging/${assessment.sourceDraftId}` : `/submissions/${assessment.submissionId}`} className={linkClass}>Open finalized decision & evidence</Link><br />{assessment.rubricTitle} · rubric v{assessment.rubricVersion} · pinned commit <code>{assessment.commitSha.slice(0, 12)}</code>. AI suggestions are supporting evidence; the award is your decision.</p>}
        {approval ? <div role="status" className="border-t border-teal-100 bg-teal-50 p-5 text-xs leading-6 text-teal-900"><strong>Approved exact terms · revision {approval.awardRevision}</strong><br />Approved by {approver ?? approval.approvedBy} on {approval.approvedAt.toISOString()} (UTC).<br />{payoutStatus ? "An existing payout record is shown above." : "No payout has been sent."}</div> : <>
          {blocked && <p role="alert" className="px-5 pb-4 text-xs text-red-800">Approval is blocked: the assessment must be human-finalized and all reserved awards must fit the event budget.</p>}
          <AwardApprovalForm awardId={award.id} disabled={blocked} terms={{ title: award.title, submissionId: award.submissionId, assessmentId: award.assessmentId, revision: award.revision, amountCents: award.amountCents, currency: "USD", recipientEmail: award.recipientEmail }} />
        </>}
      </Card>
      <div className="space-y-5">
        <Card title="SANDBOX payout" subtitle={payout ? "Submitted / Unknown → Reconciled" : approval ? "Approved → Ready for sandbox payout" : "Approve exact terms first"}>
          {payout ? <>
            <div role="status" className="space-y-3 p-5 text-xs leading-6 text-slate-700"><p>{payoutExplanation(payout)}</p>
              <span className={`inline-flex rounded-md border px-2.5 py-1 text-[10px] font-semibold ${payout.itemStatus === "SUCCESS" && payout.lastOutcome === "RECONCILED" ? "border-teal-200 bg-teal-50 text-teal-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>SANDBOX · {payout.lastOutcome === "RECONCILED" ? "Item reconciled" : "Payment unconfirmed"}</span>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{[
                ["Approved amount", formatUsd(award.amountCents)], ["Recipient", maskRecipient(award.recipientEmail)],
                ["Individual item status", payout.itemStatus ?? "Not yet verified"],
                ["Last matched item observation (UTC)", payout.reconciledAt?.toISOString() ?? "Not yet reconciled"],
              ].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="break-all font-semibold">{value}</dd></div>)}</dl>
              <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-semibold text-teal-800">Provider identifiers & authorization</summary><dl className="mt-4 space-y-3">{[
                ["PayPal batch ID", payout.paypalBatchId ?? "Unknown · operator lookup required"], ["PayPal item ID", payout.paypalItemId ?? "Not yet verified"],
                ["Sender batch ID", payout.senderBatchId], ["Sender item ID", payout.senderItemId],
                ["Authorized by", payout.authorizedBy ?? "Historical record"], ["Authorized at (UTC)", payout.authorizedAt?.toISOString() ?? "Historical record"],
                ["Dispatch state", payout.dispatchState], ["Latest request outcome", payout.lastOutcome ?? "Unavailable"],
                ["Dispatch started at (UTC)", payout.dispatchStartedAt?.toISOString() ?? "No dispatch claim"],
              ].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="break-all font-medium">{value}</dd></div>)}</dl></details>
              <p className="rounded-lg bg-slate-50 p-3">This award has a permanent payout record. Sending is disabled. Keep the original IDs even after a rejection, timeout or restart.</p>
            </div>
            <ReconcilePayoutForm awardId={award.id} needsBatchId={!payout.paypalBatchId} disabled={payout.dispatchState === "prepared"} />
            <details className="border-t border-slate-100 p-5 text-xs"><summary className="cursor-pointer font-semibold text-teal-800">Payout audit history</summary><ol className="mt-3 space-y-3">{history.map(entry => <li key={entry.id} className="break-words text-slate-600"><span>{entry.action}</span>{typeof entry.metadata.itemStatus === "string" && <span className="ml-2 font-semibold">{entry.metadata.itemStatus}</span>}<br /><time dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toISOString()} UTC</time></li>)}</ol></details>
          </> : approval ? <SandboxSendForm awardId={award.id} disabledReason={blocked ? "The assessment and budget must pass validation before sending." : sandboxReadiness(award.recipientEmail)} terms={{ approvalId: approval.id, title: award.title, submissionId: award.submissionId, assessmentId: award.assessmentId, revision: award.revision, amountCents: award.amountCents, currency: "USD", recipientEmail: award.recipientEmail }} /> : <p className="p-5 text-xs leading-6 text-slate-500">A finalized assessment is evidence for an award. Approve the exact award terms, then separately authorize a sandbox payout here.</p>}
        </Card>
        <Card title="Event budget impact" subtitle={event.name}><dl className="space-y-4 p-5 text-xs">{[
          ["Total USD budget", formatUsd(event.budgetCents)], ["Reserved by this award", formatUsd(award.amountCents)],
          ["Total reserved · includes this award", formatUsd(reservedCents)], ["Available after allocation", formatUsd(event.budgetCents - reservedCents)],
          ["Extra reserved on approval", formatUsd(0)],
        ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-slate-800">{value}</dd></div>)}</dl><p className="px-5 pb-5 text-xs leading-6 text-slate-500">Allocation already reserved these funds. Approval rechecks the full budget under a database lock.</p></Card>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-xs leading-6 text-amber-900"><strong>Need to correct a recipient or amount?</strong><p>Do not approve incorrect terms. HackRef preserves allocations and approvals without edits, cancellation or replacement. A future explicit correction workflow must retain this history.</p></div>
      </div>
    </div>
  </>;
}
