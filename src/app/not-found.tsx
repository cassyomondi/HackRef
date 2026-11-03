import { EmptyState } from "@/components/workspace-ui";

export default function NotFound() {
  return (
    <>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <EmptyState
        icon="file"
        title="This page is outside the workspace"
        description="Use the navigation to explore the foundation preview."
        href="/"
        linkLabel="Back to overview"
      />
    </>
  );
}
