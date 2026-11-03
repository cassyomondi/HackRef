"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError("");
    try {
      await apiRequest("/api/auth/login", "POST", {
        email: values.get("email"),
        password: values.get("password"),
      });
      form.reset();
      router.replace("/submissions");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-xs font-medium text-slate-600">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          className="mt-2 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className="mt-2 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={pending}
        className="w-full rounded-lg bg-teal-800 px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs leading-5 text-slate-500">
        Organizer access is provisioned locally. Contact the workspace
        administrator if you need access.
      </p>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      await apiRequest("/api/auth/logout", "POST");
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex items-center gap-3 text-xs">
      <span role="alert" className="text-red-700">
        {error}
      </span>
      <button
        onClick={logout}
        disabled={pending}
        className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
