import Link from "next/link";
import type { Review } from "@/lib/evaluation/reviews";

export function AssessmentReview({ review }: { review: Review }) {
  return <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 text-xs leading-6 text-slate-600">
    <div className="flex flex-wrap justify-between gap-2">
      <Link className="font-semibold text-teal-800 underline" href={`/submissions/${review.submissionId}`}>{review.submissionName}</Link>
      <span className="rounded bg-amber-50 px-2 font-semibold text-amber-800">DRAFT · Human review required</span>
    </div>
    <p>{review.rationale}</p>
    <p>{review.rubric.title} · v{review.rubric.version}</p>
    <p className="break-all font-mono text-[10px]">Commit {review.commitSha}<br />Run {review.jobId}<br />{review.modelVersion} · {review.promptVersion} · {review.evidenceVersion}</p>
    {review.draft.criteria.map((criterion) => <section key={criterion.key} className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex justify-between gap-3 font-semibold text-slate-800">
        <span>{review.rubric.criteria.find((c) => c.key === criterion.key)?.label}</span>
        <span>{criterion.suggestedScore === null ? "Not scored" : `${review.scores[criterion.key]} / ${review.rubric.criteria.find((c) => c.key === criterion.key)?.maxScore}`} · {criterion.status}</span>
      </div>
      <p>{criterion.rationale}</p><p className="text-amber-800">Uncertainty: {criterion.uncertainty}</p>
      <ul className="space-y-1">{criterion.citations.map((ref, i) => {
        const file = review.evidence.find((e) => e.id === ref.evidenceId);
        return <li key={i}>{file && <a className="break-all text-teal-700 underline" href={`${file.sourceUri.split("#")[0]}#L${ref.startLine}-L${ref.endLine}`} target="_blank" rel="noreferrer">{ref.path}:{ref.startLine}–{ref.endLine}</a>}</li>;
      })}</ul>
      {review.findings.filter((f) => f.criterionKey === criterion.key).map((f) => <p key={f.id} className="whitespace-pre-wrap">{f.status}: {f.summary}</p>)}
    </section>)}
    <section className="border-t border-slate-100 pt-3">
      <p className="font-semibold text-slate-800">Coverage & limitations</p>
      <p>{review.evidence.length} collected files · {review.coverage.omittedCount} omissions · {review.coverage.requests} GitHub requests · {review.coverage.fetchedBytes} source bytes · tree {review.coverage.treeTruncated ? "truncated" : "listed"}</p>
      <ul className="list-disc pl-4">{[...review.coverage.limitations, ...review.draft.limitations].map((text, i) => <li key={i}>{text}</li>)}</ul>
      <details className="mt-3"><summary className="cursor-pointer text-teal-800">Deterministic presence checks</summary>
        <ul className="list-disc pl-4">{review.checks.map((check, i) => <li key={i}>{check.status}: {check.statement}</li>)}</ul>
      </details>
      <details className="mt-3"><summary className="cursor-pointer text-teal-800">Excluded or unavailable evidence</summary>
        <ul>{review.coverage.omissions.map((o, i) => <li key={i} className="break-all">{o.path}: {o.reason}</li>)}</ul>
        {review.coverage.omittedCount > review.coverage.omissions.length && <p>Additional omissions counted; detail list is bounded.</p>}
      </details>
    </section>
    <details><summary className="cursor-pointer font-semibold text-teal-800">Collected excerpts & provenance</summary>
      {review.evidence.map((file) => <section key={file.id} className="mt-3 space-y-2">
        <p className="break-all font-semibold">{file.path}</p><p className="break-all font-mono text-[10px]">SHA-256 {file.contentHash}</p>
        <p>{file.limitations}</p>
        <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-3 text-[10px]">{file.excerpt?.split("\n").map((line, i) => `${file.startLine + i}: ${line}`).join("\n")}</pre>
      </section>)}
    </details>
    <p className="text-amber-800">Provisional static review. Source code and tests were never executed. Successful integrations are unverified. No award or payout action is available.</p>
  </article>;
}
