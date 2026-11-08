import type { Metadata } from "next";
import Link from "next/link";
import { AwardAllocationForm } from "@/components/award-forms";
import { Card, EmptyState, PageHeading } from "@/components/workspace-ui";
import { getDatabase } from "@/db/client";
import { awardsWorkspace } from "@/lib/awards";
import { formatUsd } from "@/lib/money";
import { requirePageOrganizer } from "@/lib/session";

export const metadata: Metadata = { title: "Awards" };
const linkClass = "font-semibold text-teal-800 underline decoration-teal-200 underline-offset-4 hover:text-teal-950";
const badgeClass = "inline-block rounded-md border px-2 py-1 text-[10px] font-semibold";

export default async function AwardsPage() {
  const organizer = await requirePageOrganizer();
  const workspace = await awardsWorkspace(getDatabase(), organizer.id);
  return <>
    <PageHeading eyebrow="RECOGNIZE & APPROVE" title="Awards" description="Allocate prizes from human decisions. Review and approve every financial term yourself.">
      <Link href="/event" className={linkClass}>Manage prize budget →</Link>
    </PageHeading>
    <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-4 text-xs leading-6 text-teal-900"><strong>SANDBOX · organizer controlled.</strong> Allocate → approve exact terms → separately send sandbox payout → reconcile the individual item. Approval never sends funds.</div>
    {!workspace ? <Card title="Your award workspace"><EmptyState icon="trophy" title="Set up your event first" description="Configure an event and its USD budget, then finalize human assessments before allocating prizes." href="/event" linkLabel="Create your event" /></Card> : (() => {
      const { event, register, eligible, reservedCents, approvedCents } = workspace;
      const approved = register.filter((row) => row.approvalId);
      const choices = eligible.filter((row) => !register.some((award) => award.submissionId === row.submissionId));
      const available = event.budgetCents - reservedCents;
      return <>
        {event.isDemo && <p className="mb-4 text-xs font-medium text-amber-800">DEMO EVENT · All displayed records belong to this event.</p>}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Prize budget", formatUsd(event.budgetCents), `${formatUsd(available)} available`],
            ["Allocated · reserved", formatUsd(reservedCents), `${register.length} awards · ${register.length - approved.length} awaiting approval`],
            ["Approved exact terms", formatUsd(approvedCents), `${approved.length} approved · ${approved.filter((row) => !row.payoutStatus).length} without a payout record`],
            ["Human provenance", String(eligible.length), "Finalized assessments · AI ranking does not designate winners"],
          ].map(([label, value, detail]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-900">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></div>)}
        </div>
        {event.budgetCents === 0 && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900"><strong>No prize funds configured.</strong> A zero budget prevents allocation. <Link href="/event" className={linkClass}>Set the event budget</Link> before reserving an award.</div>}
        {available === 0 && event.budgetCents > 0 && <p role="status" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">All prize funds are reserved. Increase the event budget to allocate another award. Existing allocations can still be reviewed and approved.</p>}
        {available < 0 && <p role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-xs text-red-800">Historical allocations exceed the current budget. Increase the budget before allocating or approving.</p>}
        <div className="mb-6 grid items-start gap-6 xl:grid-cols-2">
          <Card title="1 · Allocate a prize" subtitle="A reservation awaiting your separate approval">
            {!eligible.length ? <EmptyState icon="shield" title="No human-finalized assessments yet" description="Review an AI draft and save a human assessment in Judging. Final scores alone do not allocate awards or declare a winner." href="/judging" linkLabel="Open judging workspace" /> : !choices.length ? <EmptyState icon="trophy" title="All eligible projects have an allocation" description="Each project has one immutable award. Open an existing award below to review its terms." /> : <AwardAllocationForm choices={choices} disabled={available <= 0} />}
          </Card>
          <Card title="Human decisions & provenance" subtitle="Project order is alphabetical; the organizer chooses each award">
            {!eligible.length ? <EmptyState icon="file" title="Finalized decisions will appear here" description="Each award links to the exact finalized assessment, its source evidence and pinned project." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Eligible human-finalized assessments</caption><thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="p-4">Project / team</th><th scope="col" className="p-4">Human score</th><th scope="col" className="p-4">Provenance</th></tr></thead><tbody className="divide-y divide-slate-100">{eligible.map((row) => <tr key={row.id}><td className="p-4"><Link href={`/submissions/${row.submissionId}`} className={linkClass}>{row.project}</Link><p className="mt-1 text-slate-500">{row.team}</p></td><td className="whitespace-nowrap p-4 font-semibold text-slate-800">{row.finalScore} / {row.maxScore}<p className="mt-1 font-normal text-slate-500">Final v{row.version}</p></td><td className="p-4"><Link href={row.sourceDraftId ? `/judging/${row.sourceDraftId}` : `/submissions/${row.submissionId}`} className={linkClass}>Review & evidence</Link><p className="mt-1 text-slate-500">{row.rubricTitle} · v{row.rubricVersion}</p><p className="mt-1 text-slate-500">By {row.reviewer}</p><code className="mt-1 block text-[10px] text-slate-400">{row.commitSha.slice(0, 12)}</code></td></tr>)}</tbody></table></div>}
          </Card>
        </div>
        <Card title="Award register" subtitle="Draft allocation → approved exact terms · SANDBOX payout → item reconciliation">
          {!register.length ? <EmptyState icon="trophy" title="No awards allocated" description="Choose a human-finalized assessment and supply the recipient email to reserve a prize. You will review all terms before approving." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Award allocations and approval status</caption><thead className="bg-slate-50 text-slate-500"><tr>{["Award / project", "Recipient", "Amount", "Approval", "Payout", "Review"].map((heading) => <th key={heading} scope="col" className="p-4">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{register.map((row) => <tr key={row.id}><td className="p-4"><p className="font-semibold text-slate-800">{row.title}</p><p className="mt-1 text-slate-500">{row.project} · revision {row.revision}</p></td><td className="p-4 font-mono text-slate-500">{row.recipient}</td><td className="whitespace-nowrap p-4 font-semibold text-slate-800">{formatUsd(row.amountCents)}</td><td className="p-4"><span className={`${badgeClass} ${row.approvalId ? "border-teal-200 bg-teal-50 text-teal-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{row.approvalId ? "Approved exact terms" : "Draft allocation"}</span></td><td className="p-4"><span className={`${badgeClass} border-slate-200 bg-slate-50 text-slate-600`}>{row.payoutStatus ? `Existing record · ${row.payoutStatus}` : row.approvalId ? "Ready · SANDBOX only" : "Not sent"}</span></td><td className="p-4"><Link href={`/awards/${row.id}`} className={linkClass}>{row.approvalId ? "View sandbox payout" : "Review & approve"}</Link></td></tr>)}</tbody></table></div>}
        </Card>
        <p className="mt-5 text-xs leading-6 text-slate-500">All allocations reserve funds immediately. Approval does not reserve twice or send money. Awards and approvals cannot be edited or removed in this workflow; corrections require a future explicit workflow preserving their history.</p>
      </>;
    })()}
  </>;
}
