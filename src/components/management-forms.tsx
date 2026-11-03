"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800";
const buttonClass =
  "rounded-lg bg-teal-800 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50";

function ManagementForm({
  kind,
  children,
}: {
  kind: "event" | "rubric" | "submission";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setPending(true);
    setError("");
    setSaved(false);
    try {
      let data: unknown;
      let path: string;
      if (kind === "event") {
        data = {
          name: fields.get("name"),
          slug: fields.get("slug"),
          status: fields.get("status"),
          deadlineAt: new Date(
            `${String(fields.get("deadlineAt"))}Z`,
          ).toISOString(),
        };
        path = "/api/event";
      } else if (kind === "rubric") {
        const criteria = String(fields.get("criteria"))
          .split("\n")
          .filter((v) => v.trim())
          .map((line) => {
            const parts = line.split("|").map((v) => v.trim());
            if (parts.length !== 3)
              throw new Error(
                "Each criterion needs key | label | maximum score.",
              );
            return {
              key: parts[0],
              label: parts[1],
              maxScore: Number(parts[2]),
            };
          });
        data = { title: fields.get("title"), criteria };
        path = "/api/rubrics";
      } else {
        data = {
          name: fields.get("name"),
          teamName: fields.get("teamName"),
          repositoryUrl: fields.get("repositoryUrl"),
          repositoryOwner: fields.get("repositoryOwner"),
          ref: fields.get("ref"),
          claims: String(fields.get("claims"))
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          ownershipAttested: fields.get("ownershipAttested") === "on",
        };
        path = "/api/submissions";
      }
      await apiRequest(path, kind === "event" ? "PUT" : "POST", data);
      setSaved(true);
      if (kind !== "event") form.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 p-5 text-xs font-medium text-slate-600"
    >
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="font-normal leading-5 text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-teal-700">
          {kind === "submission"
            ? "Submission registered and commit pinned."
            : "Saved."}
        </p>
      )}
      <button disabled={pending} className={buttonClass}>
        {pending
          ? kind === "submission"
            ? "Checking GitHub…"
            : "Saving…"
          : kind === "event"
            ? "Save event"
            : kind === "rubric"
              ? "Publish new rubric version"
              : "Register submission"}
      </button>
    </form>
  );
}

export function EventForm({
  event,
}: {
  event?: { name: string; slug: string; status: string; deadlineAt: string };
}) {
  return (
    <ManagementForm kind="event">
      <label className="block">
        Event name
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={event?.name}
          className={fieldClass}
        />
      </label>
      <label className="block">
        Event slug
        <input
          name="slug"
          required
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          defaultValue={event?.slug}
          className={fieldClass}
        />
      </label>
      <label className="block">
        Deadline (UTC)
        <input
          name="deadlineAt"
          type="datetime-local"
          required
          defaultValue={event?.deadlineAt.slice(0, 16)}
          className={fieldClass}
        />
      </label>
      <label className="block">
        Status
        <select
          name="status"
          defaultValue={event?.status ?? "draft"}
          className={fieldClass}
        >
          {["draft", "open", "judging", "completed"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    </ManagementForm>
  );
}

export function RubricForm() {
  return (
    <ManagementForm kind="rubric">
      <label className="block">
        Rubric title
        <input name="title" required maxLength={120} className={fieldClass} />
      </label>
      <label className="block">
        Criteria (one per line: key | label | maximum score)
        <textarea
          name="criteria"
          required
          rows={5}
          maxLength={4000}
          placeholder="quality | Engineering quality | 10"
          className={fieldClass}
        />
      </label>
      <p className="font-normal leading-5 text-slate-500">
        Publishing creates an immutable version. Existing jobs retain their
        original rubric.
      </p>
    </ManagementForm>
  );
}

export function SubmissionForm() {
  return (
    <ManagementForm kind="submission">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Project name
          <input name="name" required maxLength={120} className={fieldClass} />
        </label>
        <label>
          Team name
          <input
            name="teamName"
            required
            maxLength={120}
            className={fieldClass}
          />
        </label>
      </div>
      <label className="block">
        Public GitHub repository
        <input
          name="repositoryUrl"
          type="url"
          required
          maxLength={250}
          placeholder="https://github.com/owner/repository"
          className={fieldClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          GitHub owner (user or organization)
          <input
            name="repositoryOwner"
            required
            maxLength={39}
            className={fieldClass}
          />
        </label>
        <label>
          Commit, branch or tag (optional)
          <input
            name="ref"
            maxLength={200}
            placeholder="Default branch if blank"
            className={fieldClass}
          />
        </label>
      </div>
      <label className="block">
        Explicit project claims (one per line)
        <textarea
          name="claims"
          required
          maxLength={20000}
          rows={4}
          placeholder="Describe what the team says the project does."
          className={fieldClass}
        />
      </label>
      <label className="flex items-start gap-2 font-normal leading-5">
        <input
          type="checkbox"
          name="ownershipAttested"
          required
          className="mt-1"
        />
        <span>
          I confirm that the submitting team is authorized to submit this
          repository. Claims are recorded as unverified statements.
        </span>
      </label>
      <p className="font-normal leading-5 text-slate-500">
        Registration pins an immutable commit and claims snapshot. Repository
        code is never executed.
      </p>
    </ManagementForm>
  );
}
