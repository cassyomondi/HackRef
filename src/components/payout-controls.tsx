"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type { sandboxSendInput } from "@/lib/payout-validation";
import { apiRequest } from "@/lib/api-client";
import { formatUsd, maskRecipient } from "@/lib/money";

const button = "rounded-lg bg-teal-800 px-4 py-3 text-xs font-semibold text-white hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50";
export function SandboxSendForm({ awardId, terms, disabledReason }: {
  awardId: string;
  terms: Omit<z.infer<typeof sandboxSendInput>, "confirm" | "confirmSandboxRecipient" | "confirmSandboxPayout" | "environment">;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || attempted || disabledReason) return;
    const fields = new FormData(event.currentTarget);
    setPending(true); setAttempted(true); setError("");
    try {
      await apiRequest(`/api/awards/${awardId}/send-sandbox`, "POST", { ...terms, environment: "sandbox", confirm: true,
        confirmSandboxRecipient: fields.get("recipientVerified") === "on", confirmSandboxPayout: fields.get("confirmSend") === "on" });
      router.refresh();
    } catch (error) {
      setError(`${error instanceof Error ? error.message : "The request could not be completed."} Refresh to inspect the saved payout record before taking further action.`);
    } finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4 p-5 text-xs leading-6">
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <strong>SANDBOX funds will be sent when you confirm.</strong>
      <p>Send {formatUsd(terms.amountCents)} for “{terms.title}” to {maskRecipient(terms.recipientEmail)} in PayPal sandbox. Check the full recipient in the private award details above. This action permanently consumes this award’s dispatch attempt.</p>
    </div>
    {disabledReason && <p role="status" className="text-slate-600">{disabledReason}</p>}
    <fieldset disabled={!!disabledReason || pending || attempted} className="space-y-4 disabled:opacity-60">
      <label className="flex items-start gap-2"><input className="mt-1.5" type="checkbox" name="recipientVerified" required /><span>I verified the exact approved email against an actual recipient account in PayPal Developer sandbox accounts.</span></label>
      <label className="flex items-start gap-2"><input className="mt-1.5" type="checkbox" name="confirmSend" required /><span>I authorize this separate SANDBOX payout for the award, recipient, revision and exact USD amount above. Approval and assessment finalization alone did not authorize sending.</span></label>
      <button className={button}>{pending ? "Submitting sandbox request…" : "Send sandbox payout"}</button>
    </fieldset>
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </form>;
}
export function ReconcilePayoutForm({ awardId, needsBatchId, disabled }: { awardId: string; needsBatchId: boolean; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || disabled) return;
    const fields = new FormData(event.currentTarget);
    setPending(true); setMessage(""); setError("");
    try {
      const batchId = String(fields.get("batchId") ?? "").trim();
      const { payout } = await apiRequest(`/api/awards/${awardId}/reconcile`, "POST", batchId ? { batchId } : {});
      setMessage(payout.lastOutcome === "RECONCILED" ? `Matched individual item status: ${payout.itemStatus}.` : "Status could not be verified. Preserve this record and ask the operator to investigate. No payout was sent.");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Status could not be retrieved."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-4 border-t border-slate-100 p-5 text-xs leading-6">
    <p className="text-slate-600">Reconciliation reads the original PayPal batch and individual item. It never submits or retries a payout.</p>
    <fieldset disabled={pending || disabled} className="space-y-4 disabled:opacity-60">
      {needsBatchId && <label className="block">Original PayPal sandbox batch ID<input name="batchId" required maxLength={64} pattern="[A-Za-z0-9_-]+" autoComplete="off" className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-2 block text-slate-500">The operator must recover this ID from sender sandbox activity using the permanent sender batch ID. The app will verify all original terms.</span></label>}
      <button className={button}>{pending ? "Checking individual item…" : "Reconcile status"}</button>
    </fieldset>
    {message && <p role="status" className="text-teal-900">{message}</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </form>;
}
