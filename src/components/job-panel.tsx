"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import type { publicJob } from "@/lib/jobs";
import type { Review } from "@/lib/evaluation/reviews";
import { AssessmentReview } from "./assessment-review";

type Job = ReturnType<typeof publicJob>;
export function JobPanel({
  submissionId,
  rubrics,
  initialJobs,
  initialReviews,
}: {
  submissionId: string;
  rubrics: Array<{ id: string; title: string; version: number }>;
  initialJobs: Job[];
  initialReviews: Review[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [reviews, setReviews] = useState(initialReviews);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await apiRequest(
          `/api/evaluations?submissionId=${submissionId}`,
        );
        if (active) {
          setJobs(result.jobs);
          setReviews(result.reviews);
          setPollError("");
        }
      } catch (error) {
        if (active)
          setPollError(
            error instanceof Error ? error.message : "Unable to refresh jobs.",
          );
      }
      if (active) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [submissionId]);
  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest("/api/evaluations", "POST", {
        submissionId,
        rubricVersionId: data.get("rubricVersionId"),
      });
      setJobs((current) => [
        result.job,
        ...current.filter((j) => j.id !== result.job.id),
      ]);
      setMessage(
        result.created
          ? "Evaluation queued. Start the worker to process it."
          : "This submission and rubric already have an evaluation. Its existing status is shown below.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to queue evaluation.",
      );
    } finally {
      setPending(false);
    }
  }
  async function retry(jobId: string) {
    setRetrying(jobId);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest(`/api/evaluations/${jobId}/retry`, "POST");
      setJobs((current) => [result.job, ...current.filter((j) => j.id !== result.job.id)]);
      setMessage(`${result.created ? "Retry queued" : "Existing retry"}: ${result.job.id} (${result.job.status}). The failed evaluation and its diagnostics are preserved.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to retry evaluation.");
    } finally { setRetrying(null); }
  }
  return (
    <div className="p-5 text-xs text-slate-600">
      <p className="mb-4 leading-6">
        Queue a bounded static AI review of the pinned commit against an exact
        rubric version. Draft scores require organizer review. Historical PASS 2
        jobs remain input checks only.
      </p>
      {rubrics.length ? (
        <form onSubmit={queue} className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1">
            Rubric version
            <select
              name="rubricVersionId"
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5"
              defaultValue={rubrics[0].id}
            >
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · v{r.version}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={pending}
            className="rounded-lg bg-teal-800 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Queueing…" : "Queue AI evaluation"}
          </button>
        </form>
      ) : (
        <p>Publish a rubric in Event & rubric to enable queueing.</p>
      )}
      {(error || pollError) && (
        <p role="alert" className="mt-4 leading-5 text-red-700">
          {error || pollError}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 leading-5 text-teal-700">
          {message}
        </p>
      )}
      <ul className="mt-5 divide-y divide-slate-100">
        {jobs.map((job) => (
          <li key={job.id} id={`evaluation-${job.id}`} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold capitalize text-slate-800">
                {job.status}
              </span>
              <span>
                Attempt {job.attempts} / {job.maxAttempts}
              </span>
            </div>
            <p className="break-all text-[10px] text-slate-400">Job {job.id}</p>
            <p>{job.pipelineVersion}</p>
            {job.retry && <p className="break-all">Manual retry {job.retry.number} / {job.maxManualRetries} · Original <a className="text-teal-700 underline" href={`#evaluation-${job.retry.rootJobId}`}>{job.retry.rootJobId}</a> · Retry of <a className="text-teal-700 underline" href={`#evaluation-${job.retry.parentJobId}`}>{job.retry.parentJobId}</a></p>}
            <p>
              Rubric v
              {rubrics.find((r) => r.id === job.rubricVersionId)?.version ??
                "?"}
            </p>
            {job.status === "running" && (
              <p>Lease expires: {job.leaseExpiresAt?.replace("T", " ")}</p>
            )}
            {job.status === "queued" && (
              <p>Next eligible: {job.nextAttemptAt.replace("T", " ")}</p>
            )}
            {job.lastError && (
              <p className="leading-5 text-amber-800">{job.lastError}</p>
            )}
            {job.result && (
              <p className="leading-5 text-slate-500">
                {String(job.result.limitation)}
              </p>
            )}
            {job.canRetry && <button
              type="button"
              disabled={retrying !== null}
              onClick={() => retry(job.id)}
              className="rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-800 disabled:opacity-50"
            >{retrying === job.id ? "Queueing retry…" : jobs.some((j) => j.retry?.parentJobId === job.id) ? "View existing retry" : "Retry evaluation"}</button>}
            {job.status === "failed" && job.retry?.number === job.maxManualRetries && <p className="text-amber-800">Manual retry limit reached for this evaluation.</p>}
            {reviews.filter((r) => r.jobId === job.id).map((review) => <AssessmentReview key={review.id} review={review} />)}
          </li>
        ))}
      </ul>
      {!jobs.length && (
        <p className="mt-5 text-slate-500">No evaluation jobs yet.</p>
      )}
    </div>
  );
}
