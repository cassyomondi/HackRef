"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { allocationInput, type approvalInput } from "@/lib/awards-validation";
import { usdToCents } from "@/lib/money";
import type { z } from "zod";

const fieldClass = "mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800";
const buttonClass = "rounded-lg bg-teal-800 px-4 py-3 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-50";

export function AwardAllocationForm({ choices, disabled }: {
  choices: Array<{ id: string; submissionId: string; project: string; version: number; finalScore: number; maxScore: number }>;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const assessment = choices.find((row) => row.id === fields.get("assessmentId"));
      const input = allocationInput.parse({
        assessmentId: assessment?.id, submissionId: assessment?.submissionId,
        title: fields.get("title"), recipientEmail: fields.get("recipientEmail"),
        amountCents: usdToCents(String(fields.get("amount"))), currency: "USD",
        confirmRecipient: fields.get("confirmRecipient") === "on",
      });
      const result = await apiRequest("/api/awards", "POST", input);
      router.push(`/awards/${result.awardId}`); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to allocate award.");
      setPending(false);
    }
  }
  return <form onSubmit={submit} className="space-y-4 p-5 text-xs font-medium text-slate-600">
    <fieldset disabled={disabled || pending} className="space-y-4 disabled:opacity-60">
      <label className="block">Human-finalized assessment<select aria-label="Human-finalized assessment" name="assessmentId" required defaultValue="" className={fieldClass}>
        <option value="" disabled>Select a project and final assessment</option>
        {choices.map((row) => <option key={row.id} value={row.id}>{row.project} · final v{row.version} · {row.finalScore}/{row.maxScore}</option>)}
      </select></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Award title<input name="title" required maxLength={120} placeholder="First prize" className={fieldClass} /></label>
        <label>Prize amount (USD)<input name="amount" type="text" inputMode="decimal" required maxLength={11} placeholder="125.50" className={fieldClass} /></label>
      </div>
      <label className="block">Recipient email<input name="recipientEmail" type="email" autoComplete="off" required maxLength={254} className={fieldClass} /></label>
      <p className="font-normal leading-5 text-slate-500">Supply the recipient directly with the team. GitHub metadata is never used to choose a recipient. The full address appears only in the private confirmation.</p>
      <label className="flex items-start gap-2 font-normal leading-5"><input name="confirmRecipient" type="checkbox" required className="mt-1" /><span>I have checked this recipient email with the team and intend to reserve this exact USD amount.</span></label>
      <p className="rounded-lg bg-slate-50 p-3 font-normal leading-5">Allocation reserves budget and fixes the terms at revision 1. Approval is a separate step. Corrections and replacement awards require a future explicit workflow; check every field before continuing.</p>
      <button className={buttonClass}>{pending ? "Reserving budget…" : "Allocate award · review next"}</button>
    </fieldset>
    {error && <p role="alert" className="font-normal leading-5 text-red-700">{error}</p>}
  </form>;
}

export function AwardApprovalForm({ awardId, terms, disabled }: { awardId: string; terms: Omit<z.infer<typeof approvalInput>, "confirm">; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || saved) return;
    const confirmed = new FormData(event.currentTarget).get("confirm") === "on";
    setPending(true); setError("");
    try {
      await apiRequest(`/api/awards/${awardId}/approve`, "POST", { ...terms, confirm: confirmed });
      setSaved(true); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to approve award.");
    } finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4 border-t border-slate-100 p-5 text-xs">
    <fieldset disabled={disabled || pending || saved} className="space-y-4 disabled:opacity-60">
      <label className="flex items-start gap-2 leading-6 text-slate-700"><input type="checkbox" name="confirm" required className="mt-1.5" /><span>I explicitly approve the project, assessment, award revision, recipient and exact USD amount shown above. I understand this approval is permanent.</span></label>
      <button className={buttonClass}>{pending ? "Recording approval…" : "Approve these exact award terms"}</button>
    </fieldset>
    {error && <p role="alert" className="leading-5 text-red-700">{error}</p>}
    {saved && <p role="status" className="text-teal-800">Exact terms approved. No payout has been sent.</p>}
  </form>;
}
