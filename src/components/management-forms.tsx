"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";

const fieldClass =
  "mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-800";
const buttonClass =
  "rounded-lg bg-teal-800 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50";

function ManagementForm({
  children,
}: {
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
      const data = {
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
      await apiRequest("/api/submissions", "POST", data);
      setSaved(true);
      form.reset();
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
          Submission registered and commit pinned.
        </p>
      )}
      <button disabled={pending} className={buttonClass}>
        {pending ? "Checking GitHub…" : "Register submission"}
      </button>
    </form>
  );
}

export { EventForm } from "./event-form";
export { RubricForm } from "./rubric-form";

export function SubmissionForm() {
  return (
    <ManagementForm>
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
