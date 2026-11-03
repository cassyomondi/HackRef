import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-controls";
import { Icon } from "@/components/icon";

export const metadata: Metadata = { title: "Organizer sign in" };
export default function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="rounded-xl bg-teal-800 p-2 text-white">
            <Icon name="layers" />
          </span>
          <span className="text-2xl font-bold tracking-tight">
            HackRef<span className="text-teal-600">.</span>
          </span>
        </div>
        <p className="text-[10px] font-semibold tracking-widest text-teal-700">
          ORGANIZER WORKSPACE
        </p>
        <h1 className="mt-2 mb-6 text-2xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <LoginForm />
      </section>
    </main>
  );
}
