import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HackRef · Overview", template: "HackRef · %s" },
  description:
    "An organizer workspace for evidence-based hackathon judging and human-approved awards.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
