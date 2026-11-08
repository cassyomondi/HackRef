"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api-client";
import { eventSlug, slugError } from "@/lib/management-validation";
import { centsToUsdInput, formatUsd, usdToCents } from "@/lib/money";

const fieldClass = "mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800";

export function EventForm({ event }: { event?: { name: string; slug: string; status: string; deadlineAt: string; budgetCents: number } }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(event?.name ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  // A saved slug is always intentional, even when it matches the generated name.
  const [manualSlug, setManualSlug] = useState(Boolean(event));
  const [slugTouched, setSlugTouched] = useState(false);
  const [budget, setBudget] = useState(centsToUsdInput(event?.budgetCents ?? 0));
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [serverBudgetError, setServerBudgetError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const invalidSlug = slugError(slug);
  let budgetCents: number | undefined;
  let invalidBudget = "";
  try { budgetCents = usdToCents(budget); }
  catch (error) { invalidBudget = (error as Error).message; }
  const budgetError = serverBudgetError || (budgetTouched ? invalidBudget : "");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSlugTouched(true);
    setBudgetTouched(true);
    if (invalidSlug || invalidBudget || budgetCents === undefined || !e.currentTarget.reportValidity()) return;
    const fields = new FormData(e.currentTarget);
    setPending(true); setError(""); setSaved(false); setServerBudgetError("");
    setBudget(centsToUsdInput(budgetCents));
    try {
      const deadline = String(fields.get("deadlineAt"));
      // The control displays minutes. A budget-only save must preserve any
      // existing deadline seconds/milliseconds when the user did not edit it.
      const deadlineAt = event && deadline === event.deadlineAt.slice(0, 16)
        ? event.deadlineAt : new Date(`${deadline}Z`).toISOString();
      await apiRequest("/api/event", "PUT", { name, slug, status: fields.get("status"), deadlineAt, budgetCents });
      setManualSlug(true); setSaved(true); router.refresh();
    } catch (error) {
      const fieldError = error instanceof ApiError ? error.fields.find((field) => field.field === "budgetCents") : undefined;
      if (fieldError) setServerBudgetError(fieldError.message);
      else setError(error instanceof Error ? error.message : "Unable to save event.");
    } finally { setPending(false); }
  }

  return <form onSubmit={submit} noValidate className="space-y-4 p-5 text-xs font-medium text-slate-600">
    <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
      <label className="block">Event name<input name="name" required maxLength={120} value={name} onChange={(e) => {
        setName(e.target.value); setSaved(false);
        if (!manualSlug) setSlug(eventSlug(e.target.value));
      }} className={fieldClass} /></label>
      <label className="block">Event slug<input name="slug" required value={slug} aria-invalid={Boolean((slugTouched || name) && invalidSlug)} aria-describedby={`${id}-slug-help ${id}-slug-error`} onChange={(e) => { setSlug(e.target.value); setManualSlug(true); setSlugTouched(true); setSaved(false); }} onBlur={() => setSlugTouched(true)} className={fieldClass} /></label>
      <p id={`${id}-slug-help`} className="font-normal leading-5 text-slate-500">Lowercase letters, numbers and hyphens · 1–80 characters. {event || saved ? "This saved slug stays unchanged when you rename the event. Edit it only if you intend to change it." : manualSlug ? "Your custom slug stays unchanged when the event name changes." : "Generated from the event name. You can edit it."}</p>
      <p id={`${id}-slug-error`} aria-live="polite" className="font-normal text-red-700">{(slugTouched || name) && invalidSlug}</p>
      <label className="block">Deadline (UTC)<input name="deadlineAt" type="datetime-local" required defaultValue={event?.deadlineAt.slice(0, 16)} className={fieldClass} /></label>
      <label className="block">Status<select name="status" defaultValue={event?.status ?? "draft"} className={fieldClass}>{["draft", "open", "judging", "completed"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="block">Prize budget (USD)<input name="budget" type="text" inputMode="decimal" required maxLength={64} value={budget} aria-invalid={Boolean(budgetError)} aria-describedby={`${id}-budget-help ${id}-budget-value ${id}-budget-error`} onChange={(e) => {
        setBudget(e.target.value); setServerBudgetError(""); setSaved(false);
      }} onBlur={() => {
        setBudgetTouched(true);
        if (budgetCents !== undefined) setBudget(centsToUsdInput(budgetCents));
      }} className={fieldClass} /></label>
      <output id={`${id}-budget-value`} aria-label="Prize budget in dollars and cents" aria-live="polite" className="block font-normal text-slate-600">{budgetCents === undefined ? "No valid USD amount yet." : formatUsd(budgetCents)}</output>
      <p id={`${id}-budget-error`} role={budgetError ? "alert" : undefined} className="font-normal leading-5 text-red-700">{budgetError}</p>
      <p id={`${id}-budget-help`} className="font-normal leading-5 text-slate-500">Zero means no prize funds configured; awards cannot be allocated. Enter up to two decimal places, maximum USD 21,474,836.47. Allocated awards reserve budget immediately, including those awaiting approval. You can increase the budget, or reduce it only as far as the reserved total.</p>
    </fieldset>
    {error && <p role="alert" className="font-normal leading-5 text-red-700">{error}</p>}
    {saved && <p role="status" className="text-teal-700">Event saved.</p>}
    <button disabled={pending} className="rounded-lg bg-teal-800 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save event"}</button>
  </form>;
}
