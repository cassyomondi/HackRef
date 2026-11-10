"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import type { Review } from "@/lib/evaluation/reviews";

export function FinalizeReview({ review }: { review: Review }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState(() => review.rubric.criteria.map((c) => {
    const ai = review.draft.criteria.find((a) => a.key === c.key);
    return { key: c.key, action: ai?.suggestedScore != null ? "accept" : "override", score: ai?.suggestedScore?.toString() ?? "", reason: "" };
  }));
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const change = (index: number, patch: Partial<(typeof decisions)[number]>) => {
    setPreview(false);
    setDecisions((current) => current.map((d, i) => i === index ? { ...d, ...patch } : d));
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) { setPreview(true); return; }
    setPending(true); setError("");
    try {
      await apiRequest(`/api/assessments/${review.id}/finalize`, "POST", {
        criteria: decisions.map((d) => ({ ...d, score: Number(d.score) })), rationale, confirm: true,
      });
      setSaved(true); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to finalize this assessment."); }
    finally { setPending(false); }
  }
  if (saved) return <p role="status" className="rounded-lg bg-teal-50 p-4 font-semibold text-teal-800">Human decision saved. This finalization is immutable. Refresh to view the full audit record.</p>;
  return <form onSubmit={submit} className="space-y-5 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
    <div><h3 className="text-sm font-semibold text-teal-900">Your human decision</h3><p>Review the evidence and its limitations above. For each criterion, accept the AI suggestion or set your own score.</p></div>
    {review.rubric.criteria.map((c, i) => {
      const ai = review.draft.criteria.find((a) => a.key === c.key);
      const d = decisions[i];
      const canAccept = ai?.suggestedScore != null && ai.status !== "NOT_EVALUATED";
      return <fieldset key={c.key} className="space-y-3 border-t border-teal-100 pt-3" disabled={pending}>
        <legend className="px-1 font-semibold text-slate-800">{c.label} · maximum {c.maxScore}</legend>
        <p className="text-amber-800">AI suggestion: {ai?.suggestedScore ?? "Not scored"}{canAccept ? ` / ${c.maxScore}` : " · evidence gap requires a human decision"}</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex-1">Decision<select aria-label={`${c.label} decision`} value={d.action} onChange={(e) => change(i, { action: e.target.value, ...(e.target.value === "accept" ? { score: String(ai!.suggestedScore), reason: "" } : {}) })} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2">
            <option value="accept" disabled={!canAccept}>Accept AI suggestion</option><option value="override">Set my own score</option>
          </select></label>
          <label>Final score<input aria-label={`${c.label} final score`} type="number" step="any" required min={0} max={c.maxScore} value={d.score} readOnly={d.action === "accept"} onChange={(e) => change(i, { score: e.target.value })} className="mt-1 block w-28 rounded border border-slate-300 bg-white p-2 read-only:bg-slate-100" /></label>
        </div>
        {d.action === "override" && <div><label className="block">Reason for your decision<textarea aria-label={`${c.label} reason for your decision`} aria-describedby={`decision-help-${c.key}`} required minLength={10} maxLength={1200} value={d.reason} onChange={(e) => change(i, { reason: e.target.value })} className="mt-1 block min-h-20 w-full rounded border border-slate-300 bg-white p-2" /></label><p id={`decision-help-${c.key}`} className="mt-2 text-xs leading-5 text-slate-600">{canAccept ? "When you change a score, explain which evidence supports your decision and any gaps you considered." : "The AI did not score this criterion. Enter your score and explain the evidence you used, including any gaps."} Use at least 10 characters.</p></div>}
      </fieldset>;
    })}
    <div><label className="block font-semibold">Overall reason for your scores<textarea aria-describedby="overall-decision-help" required minLength={10} maxLength={4000} value={rationale} disabled={pending} onChange={(e) => { setRationale(e.target.value); setPreview(false); }} className="mt-1 block min-h-24 w-full rounded border border-slate-300 bg-white p-2 font-normal" placeholder="What stood out, what evidence supports your scores, and what could you not verify?" /></label><p id="overall-decision-help" className="mt-2 text-xs leading-5 text-slate-600">Summarize your judgment across all criteria, including strengths and any evidence limitations. Use at least 10 characters.</p></div>
    {preview && <div className="space-y-2 rounded-lg border border-teal-200 bg-white p-4" role="status">
      <p className="font-semibold text-teal-900">Confirm your final assessment</p>
      <ul>{decisions.map((d) => <li key={d.key}>{review.rubric.criteria.find((c) => c.key === d.key)?.label}: {d.score} · {d.action === "accept" ? "AI suggestion accepted" : "Human override"}</li>)}</ul>
      <p className="font-semibold">Final total: {decisions.reduce((sum, d) => sum + Number(d.score), 0)} / {review.rubric.criteria.reduce((sum, c) => sum + c.maxScore, 0)}</p>
      <p>Finalizing records your identity, reasoning and timestamp permanently. It does not select a winner or authorize an award or payment.</p>
    </div>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-3"><button disabled={pending} className="rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50">{pending ? "Saving decision…" : preview ? "Finalize human assessment" : "Review final decision"}</button>
      {preview && <button type="button" disabled={pending} onClick={() => setPreview(false)} className="rounded-lg border border-teal-700 px-4 py-2 text-teal-800">Back to review</button>}
    </div>
  </form>;
}
