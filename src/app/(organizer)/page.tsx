import Link from "next/link";
import { Icon } from "@/components/icon";
import {
  Card,
  EmptyState,
  PageHeading,
  PlaceholderNotice,
  PlannedBadge,
  StatCard,
} from "@/components/workspace-ui";

const workflow = [
  { title: "Collect", detail: "Pin submissions & evidence", icon: "file" },
  { title: "Evaluate", detail: "Assess against a rubric", icon: "scale" },
  { title: "Review", detail: "Make the human decision", icon: "shield" },
  { title: "Award", detail: "Approve before settlement", icon: "trophy" },
] as const;

export default function Overview() {
  return (
    <>
      <PageHeading
        eyebrow="YOUR ORGANIZER WORKSPACE"
        title="Overview"
        description="A little structure. A clearer decision. Your hackathon starts here."
      >
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <Icon name="calendar" width="15" height="15" />
          Deadline: Nov 12, 2026
        </span>
      </PageHeading>
      <PlaceholderNotice />
      <section className="relative mb-6 overflow-hidden rounded-xl border border-teal-100 bg-[#edf7f5] px-6 py-7 sm:px-8 sm:py-8">
        <div className="relative z-10 max-w-lg">
          <span className="text-[10px] font-semibold tracking-[0.15em] text-teal-700">
            FROM EVIDENCE TO IMPACT
          </span>
          <h2 className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Great projects deserve
            <br />a thoughtful review.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            Bring submissions, evidence and judging into one place. Keep every
            award connected to a decision you can explain.
          </p>
          <Link
            href="/submissions"
            className="mt-5 inline-flex items-center gap-3 rounded-lg bg-teal-800 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-teal-900"
          >
            Explore submissions
            <Icon name="arrow" width="15" height="15" />
          </Link>
        </div>
        <div
          aria-hidden="true"
          className="absolute top-0 -right-6 hidden h-full w-80 items-center justify-center opacity-80 xl:flex"
        >
          <div className="absolute h-64 w-64 rounded-full border border-teal-200/70" />
          <div className="absolute h-48 w-48 rounded-full border border-teal-200/70" />
          <div className="flex h-27 w-25 rotate-[-9deg] items-center justify-center rounded-2xl border border-teal-200 bg-white/80 text-teal-700 shadow-lg shadow-teal-900/5">
            <Icon name="shield" width="55" height="55" strokeWidth="1.2" />
          </div>
          <div className="absolute top-12 left-5 flex h-12 w-12 rotate-[-12deg] items-center justify-center rounded-xl border border-teal-100 bg-white text-teal-600">
            <Icon name="code" />
          </div>
          <div className="absolute right-8 bottom-10 flex h-12 w-12 rotate-12 items-center justify-center rounded-xl border border-teal-100 bg-white text-teal-600">
            <Icon name="check" />
          </div>
        </div>
      </section>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon="file"
          label="Submissions"
          detail="See Submissions for the live registry"
        />
        <StatCard
          icon="scale"
          label="Assessments"
          detail="AI assessments are not connected"
        />
        <StatCard
          icon="shield"
          label="Reviewed"
          detail="Human review is not connected"
        />
        <StatCard
          icon="trophy"
          label="Awards approved"
          detail="No award workflow connected"
        />
      </div>
      <Card
        title="A clear path to a fair outcome"
        subtitle="Planned workflow · each stage will retain its evidence trail"
        action={<PlannedBadge />}
      >
        <ol className="grid gap-5 px-5 py-6 sm:grid-cols-2 xl:grid-cols-4">
          {workflow.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                <Icon name={step.icon} width="18" height="18" />
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  <span className="mr-1.5 text-[10px] text-slate-400">
                    0{i + 1}
                  </span>
                  {step.title}
                </p>
                <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card
          title="Submissions"
          subtitle="The next great project starts with a first submission."
          action={
            <Link
              href="/submissions"
              className="inline-flex items-center gap-2 text-xs font-medium text-teal-700"
            >
              View workspace
              <Icon name="arrow" width="14" height="14" />
            </Link>
          }
        >
          <EmptyState
            icon="file"
            title="Your project registry is ready"
            description="Open Submissions to register public GitHub repositories and inspect pinned commits. This overview does not display live submission records."
          />
        </Card>
        <Card
          title="Before judging begins"
          subtitle="A look at what comes next"
        >
          <ul className="divide-y divide-slate-100 px-5">
            {[
              {
                title: "Set up your event",
                detail: "Confirm the deadline and prize budget.",
              },
              {
                title: "Define the rubric",
                detail: "Make judging criteria clear and consistent.",
              },
              {
                title: "Prepare the evaluation queue",
                detail: "Register projects and check their pinned inputs.",
              },
            ].map((item, i) => (
              <li key={item.title} className="flex items-start gap-3 py-4">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 text-[10px] text-slate-400">
                  {i + 1}
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-700">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[10px] text-slate-500">
            Event setup and versioned criteria are available in Event & rubric.
          </div>
        </Card>
      </div>
    </>
  );
}
