import { AppShell } from "@/components/app-shell";
import { requirePageOrganizer } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OrganizerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizer = await requirePageOrganizer();
  return <AppShell organizerName={organizer.displayName}>{children}</AppShell>;
}
