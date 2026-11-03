import Link from "next/link";
import { Icon } from "./icon";
import { Navigation } from "./navigation";
import { LogoutButton } from "./auth-controls";

export function AppShell({
  children,
  organizerName,
}: {
  children: React.ReactNode;
  organizerName: string;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <Link
          href="/"
          aria-label="HackRef overview"
          className="flex items-center gap-2.5 px-6 py-5 lg:px-7 lg:py-8"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-800 text-white">
            <Icon name="layers" width="22" height="22" />
          </span>
          <span className="text-[23px] font-bold tracking-[-1px] text-slate-900">
            HackRef<span className="text-teal-600">.</span>
          </span>
        </Link>
        <div className="mx-5 mb-7 hidden rounded-lg border border-slate-200 bg-slate-50/70 p-3 lg:flex lg:items-center lg:gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-600">
            HR
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-800">
              Organizer workspace
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">{organizerName}</p>
          </div>
        </div>
        <p className="mb-3 hidden px-8 text-[10px] font-semibold tracking-[0.16em] text-slate-400 lg:block">
          WORKSPACE
        </p>
        <Navigation />
        <div className="mt-auto hidden px-5 pb-5 lg:block">
          <div className="mb-5 rounded-xl border border-teal-100 bg-teal-50/60 p-4">
            <Icon name="shield" className="mb-3 text-teal-700" />
            <p className="text-xs font-semibold text-slate-800">
              Evidence before decisions
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Human review stays at the heart of judging and award approval.
            </p>
          </div>
          <div className="flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            PASS 2 · Organizer workspace
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-17 flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white/80 px-5 py-3 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Workspace</span>
            <Icon name="chevron" width="12" height="12" />
            <span className="font-medium text-slate-800">Hackathon 2026</span>
          </div>
          <LogoutButton />
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-9 lg:px-10"
        >
          {children}
        </main>
        <footer className="mx-5 mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-200 py-5 text-[11px] text-slate-500 sm:mx-8 lg:mx-10">
          <span>HackRef · Thoughtful judging. Traceable decisions.</span>
          <span>PASS 2 · November 2026</span>
        </footer>
      </div>
    </div>
  );
}
