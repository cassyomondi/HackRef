"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import type { publicJob } from "@/lib/jobs";

type Job = ReturnType<typeof publicJob>;
export function JobPanel({
  submissionId,
  rubrics,
  initialJobs,
}: {
  submissionId: string;
  rubrics: Array<{ id: string; title: string; version: number }>;
  initialJobs: Job[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
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
          setError("");
        }
      } catch (error) {
        if (active)
          setError(
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
  return (
    <div className="p-5 text-xs text-slate-600">
      <p className="mb-4 leading-6">
        PASS 2 checks stored input structure and pinned repository identity.
        Completed jobs have no AI assessment, scores or findings. Claims remain
        not evaluated.
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
            {pending ? "Queueing…" : "Queue evaluation"}
          </button>
        </form>
      ) : (
        <p>Publish a rubric in Event & rubric to enable queueing.</p>
      )}
      {error && (
        <p role="alert" className="mt-4 leading-5 text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 leading-5 text-teal-700">
          {message}
        </p>
      )}
      <ul className="mt-5 divide-y divide-slate-100">
        {jobs.map((job) => (
          <li key={job.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold capitalize text-slate-800">
                {job.status}
              </span>
              <span>
                Attempt {job.attempts} / {job.maxAttempts}
              </span>
            </div>
            <p className="break-all text-[10px] text-slate-400">Job {job.id}</p>
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
          </li>
        ))}
      </ul>
      {!jobs.length && (
        <p className="mt-5 text-slate-500">No evaluation jobs yet.</p>
      )}
    </div>
  );
}
