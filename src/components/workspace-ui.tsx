import Link from "next/link";
import { Icon, type IconName } from "./icon";

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-teal-700">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function PlaceholderNotice() {
  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
      <Icon
        name="info"
        width="16"
        height="16"
        className="mt-0.5 shrink-0 text-slate-400"
      />
      <p>
        <strong className="font-semibold text-slate-700">
          Planned judging workspace.
        </strong>{" "}
        Metrics on this page are placeholders. Manage real records in
        Submissions and Event & rubric. AI assessment, judging, analytics and
        awards remain planned.
      </p>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_2px_4px_0_rgb(15_23_42/0.015)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  href,
  linkLabel,
}: {
  icon: IconName;
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
        <Icon name={icon} width="23" height="23" />
      </span>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
        {description}
      </p>
      {href && (
        <Link
          href={href}
          className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-teal-700 hover:text-teal-900"
        >
          {linkLabel}
          <Icon name="arrow" width="15" height="15" />
        </Link>
      )}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  detail,
}: {
  icon: IconName;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon name={icon} width="18" height="18" className="text-slate-400" />
      </div>
      <p
        className="mt-4 text-3xl font-semibold tracking-tight text-slate-800"
        aria-label="No data"
      >
        —
      </p>
      <p className="mt-2 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

export function PlannedBadge() {
  return (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500">
      Planned
    </span>
  );
}
