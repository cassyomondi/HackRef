"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">Workspace unavailable</h1>
      <p className="my-4 text-sm text-slate-500">
        Check the server environment and PostgreSQL connection, then try again.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-teal-800 px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </main>
  );
}
