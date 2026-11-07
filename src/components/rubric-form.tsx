"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { criterionErrors, criterionKey, rubricPayload, type CriterionDraft } from "@/lib/management-validation";
import { rubricInput } from "@/lib/validation";

const fieldClass = "mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800";
const buttonClass = "rounded-lg bg-teal-800 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50";
type Row = CriterionDraft & { id: number; manualKey: boolean; touched: boolean };
const newRow = (id: number): Row => ({ id, label: "", key: "", maxScore: "10", manualKey: false, touched: false });

export function RubricForm() {
  const router = useRouter();
  const id = useId();
  const nextId = useRef(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Row[]>([newRow(0)]);
  const [title, setTitle] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [publication, setPublication] = useState<ReturnType<typeof rubricPayload> | null>(null);
  const validScores = rows.every((row) => !criterionErrors(row, rows).maxScore);
  const total = rows.reduce((sum, row) => sum + Number(row.maxScore), 0);
  const titleError = !rubricInput.shape.title.safeParse(title).success;

  function update(rowId: number, field: keyof CriterionDraft, value: string) {
    setSaved(false);
    setRows((current) => current.map((row) => row.id !== rowId ? row : { ...row, [field]: value, touched: true, ...(field === "key" ? { manualKey: true } : field === "label" && !row.manualKey ? { key: criterionKey(value) } : {}) }));
  }

  function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setAttempted(true); setError(""); setSaved(false);
    const payload = rubricPayload(title, rows);
    if (!rubricInput.safeParse(payload).success) return;
    setPublication(payload); dialog.current?.showModal();
  }

  async function publish() {
    if (!publication || pending) return;
    setPending(true); setError("");
    try {
      await apiRequest("/api/rubrics", "POST", publication);
      dialog.current?.close(); setPublication(null);
      setTitle(""); setRows([newRow(nextId.current++)]); setAttempted(false); setSaved(true); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to publish rubric.");
    } finally { setPending(false); }
  }

  return <>
    <form onSubmit={review} noValidate className="space-y-4 p-5 text-xs font-medium text-slate-600">
      <label className="block">Rubric title<input name="title" required maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} aria-invalid={attempted && titleError} aria-describedby={`${id}-title-error`} className={fieldClass} /></label>
      <p id={`${id}-title-error`} aria-live="polite" className="text-red-700">{attempted && titleError ? "Enter a rubric title (1–120 characters)." : ""}</p>
      <p className="font-normal leading-5">Add 1–20 criteria in judging order. Keys identify criteria within this snapshot; custom keys stay unchanged as labels are edited.</p>
      <div className="space-y-3">{rows.map((row, index) => {
        const errors = criterionErrors(row, rows);
        return <fieldset key={row.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <legend className="px-1 font-semibold text-slate-800">Criterion {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(100px,0.5fr)]">
            {(["label", "key", "maxScore"] as const).map((field) => {
              const errorId = `${id}-${row.id}-${field}`;
              const visible = (attempted || row.touched) && Boolean(errors[field]);
              return <div key={field} className={field === "label" ? "sm:col-span-2" : "min-w-0"}>
                <label className="block">{field === "label" ? "Criterion label" : field === "key" ? "Criterion key" : "Maximum score"}<input name={`criterion-${row.id}-${field}`} type={field === "maxScore" ? "number" : "text"} min={field === "maxScore" ? 1 : undefined} max={field === "maxScore" ? 100 : undefined} step={field === "maxScore" ? 1 : undefined} required value={row[field]} onChange={(e) => update(row.id, field, e.target.value)} aria-invalid={visible} aria-describedby={errorId} className={fieldClass} /></label>
                <p id={errorId} aria-live="polite" className="mt-1 font-normal leading-5 text-red-700">{visible ? errors[field] : ""}</p>
              </div>;
            })}
          </div>
          <button type="button" disabled={rows.length === 1} aria-label={`Remove criterion ${index + 1}`} onClick={() => { setRows((current) => current.filter((r) => r.id !== row.id)); setSaved(false); }} className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-slate-600 disabled:opacity-50">Remove criterion</button>
        </fieldset>;
      })}</div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={rows.length >= 20} onClick={() => { setRows((current) => [...current, newRow(nextId.current++)]); setSaved(false); }} className="rounded-lg border border-teal-700 px-3 py-2.5 font-semibold text-teal-800 disabled:opacity-50">Add criterion</button>
        <p role="status" className="text-slate-800">{rows.length}/20 criteria · Total: {validScores ? `${total} points` : "check maximum scores"}</p>
      </div>
      <p className="font-normal leading-5 text-slate-500">Publishing creates one immutable new version containing all criteria above. Existing versions, jobs and assessments retain their original rubric.</p>
      {saved && <p role="status" className="text-teal-700">Rubric published as one new version.</p>}
      <button className={buttonClass}>Review publication</button>
    </form>
    <dialog ref={dialog} aria-labelledby={`${id}-confirmation`} onCancel={(e) => { if (pending) e.preventDefault(); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-xl backdrop:bg-slate-950/40">
      <h3 id={`${id}-confirmation`} className="text-lg font-semibold text-slate-900">Publish an immutable rubric version?</h3>
      <p className="mt-3 break-words"><strong>{publication?.title}</strong> · {publication?.criteria.length} criteria · {publication?.criteria.reduce((sum, row) => sum + row.maxScore, 0)} points</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">{publication?.criteria.map((row) => <li key={row.key} className="break-words">{row.label} <code className="text-xs">({row.key})</code> · {row.maxScore} points</li>)}</ol>
      <p className="mt-4 leading-6">All these criteria will be published together in one new version. This snapshot cannot be edited. Later changes require another version. Existing rubric snapshots, evaluations and assessments stay unchanged.</p>
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={pending} onClick={() => { dialog.current?.close(); setPublication(null); }} className="rounded-lg border border-slate-300 px-4 py-2.5 disabled:opacity-50">Keep editing</button><button type="button" disabled={pending} onClick={publish} className={buttonClass}>{pending ? "Publishing…" : "Publish new rubric version"}</button></div>
    </dialog>
  </>;
}
