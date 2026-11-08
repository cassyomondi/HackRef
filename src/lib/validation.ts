import { z } from "zod";
import { budgetCentsInput } from "./awards-validation";

export function validationFields(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "request",
    // Unknown keys can contain arbitrary text; do not echo them or Zod internals.
    message: issue.code === "unrecognized_keys" ? "Remove unsupported fields from this request." : issue.message,
  }));
}

const label = z.string().trim().min(1).max(120);
export const uuidInput = z.uuid();
export function parseRepositoryUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Use https://github.com/owner/repository.");
  }
  const match =
    /^https:\/\/github[.]com(?::443)?\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})\/?$/i.exec(
      input,
    );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    input.includes("%")
  ) {
    throw new Error(
      "Use a public https://github.com/owner/repository URL without credentials, query strings or fragments.",
    );
  }
  const owner = match[1].toLowerCase();
  const repository = match[2].replace(/\.git$/i, "").toLowerCase();
  if (
    !repository ||
    [".", ".."].includes(repository) ||
    owner.endsWith("-") ||
    owner.includes("--")
  )
    throw new Error("Invalid GitHub owner or repository name.");
  return {
    owner,
    repository,
    url: `https://github.com/${owner}/${repository}`,
  };
}

export const submissionInput = z
  .object({
    name: label,
    teamName: label,
    repositoryUrl: z
      .string()
      .trim()
      .max(250)
      .transform((value, ctx) => {
        try {
          return parseRepositoryUrl(value).url;
        } catch (error) {
          ctx.addIssue({ code: "custom", message: (error as Error).message });
          return z.NEVER;
        }
      }),
    repositoryOwner: z
      .string()
      .trim()
      .min(1)
      .max(39)
      .transform((v) => v.toLowerCase()),
    ref: z
      .string()
      .trim()
      .max(200)
      .regex(
        /^(?:[A-Za-z0-9][A-Za-z0-9._/-]*)?$/,
        "Use a commit SHA, branch or tag; leave blank for the default branch.",
      )
      .default(""),
    claims: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    ownershipAttested: z.literal(true, {
      error: "Confirm that the team is authorized to submit this repository.",
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (parseRepositoryUrl(value.repositoryUrl).owner !== value.repositoryOwner)
      ctx.addIssue({
        code: "custom",
        path: ["repositoryOwner"],
        message: "The declared GitHub owner must match the repository URL.",
      });
  });

export const eventInput = z
  .object({
    name: label,
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    deadlineAt: z.iso.datetime({ offset: true }),
    status: z.enum(["draft", "open", "judging", "completed"]),
    // Omission preserves existing budgets for older clients.
    budgetCents: budgetCentsInput.optional(),
  })
  .strict();

export const rubricInput = z
  .object({
    title: label,
    criteria: z
      .array(
        z
          .object({
            key: z
              .string()
              .min(1)
              .max(40)
              .regex(/^[a-z][a-z0-9_]*$/),
            label,
            maxScore: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.criteria.map((c) => c.key)).size !== v.criteria.length)
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Criterion keys must be unique.",
      });
  });

export const queueInput = z
  .object({ submissionId: uuidInput, rubricVersionId: uuidInput })
  .strict();
