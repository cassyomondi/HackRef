"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section
      role="alert"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <h2 className="text-sm font-semibold">The workspace could not load</h2>
      <p className="mt-2 text-xs text-slate-500">
        Check the server configuration and database connection, then try again.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-teal-800 px-4 py-2 text-xs text-white"
      >
        Try again
      </button>
    </section>
  );
}
