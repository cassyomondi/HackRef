import { z } from "zod";

const databaseUrl = z.string().superRefine((value, context) => {
  if (!URL.canParse(value)) {
    context.addIssue({ code: "custom", message: "Use a valid PostgreSQL URL" });
    return;
  }
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    context.addIssue({
      code: "custom",
      message: "Use a PostgreSQL URL with a database name",
    });
  }
});

const serverEnvironment = z.object({ DATABASE_URL: databaseUrl });

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
) {
  const result = serverEnvironment.safeParse(input);
  if (!result.success) {
    // Never include input values, connection strings or passwords in errors.
    throw new Error(
      "Invalid server environment: set DATABASE_URL to a valid PostgreSQL connection URL. See .env.example.",
    );
  }
  return result.data;
}
