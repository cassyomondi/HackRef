import { z } from "zod";
import { MAX_CENTS } from "./money";

export const budgetCentsInput = z.number({ error: "Send the budget as a number of integer USD cents." })
  .int({ error: "The budget must be a whole number of USD cents." })
  .min(0, { error: "The budget cannot be negative." })
  .max(MAX_CENTS, { error: "The maximum budget is 2147483647 USD cents (USD 21,474,836.47)." });
const terms = {
  submissionId: z.uuid(),
  assessmentId: z.uuid(),
  title: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/, "Use a title without control characters."),
  amountCents: z.number().int().positive().max(MAX_CENTS),
  currency: z.literal("USD"),
  recipientEmail: z.email().max(254),
};

export const allocationInput = z.object({ ...terms, confirmRecipient: z.literal(true) }).strict();
// The confirmation sends every displayed term, including title and revision.
export const approvalInput = z.object({ ...terms, revision: z.number().int().positive().max(MAX_CENTS), confirm: z.literal(true) }).strict();
