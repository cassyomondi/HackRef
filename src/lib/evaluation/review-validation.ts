import { z } from "zod";
import { AppError } from "../errors";
import { rubricInput } from "../validation";
import type { DraftOutput } from "./model";

export const humanReviewInput = z.object({
  criteria: z.array(z.object({
    key: z.string().min(1).max(40),
    action: z.enum(["accept", "override"]),
    score: z.number().min(0).max(100),
    reason: z.string().trim().max(1200).default(""),
  }).strict()).min(1).max(20),
  rationale: z.string().trim().min(10).max(4000),
  confirm: z.literal(true),
}).strict();

export function validateHumanReview(rubric: z.infer<typeof rubricInput>, draft: DraftOutput, input: unknown) {
  const data = humanReviewInput.parse(input);
  const invalid = (message: string): never => { throw new AppError(422, message); };
  const keys = new Set(data.criteria.map((c) => c.key));
  if (keys.size !== rubric.criteria.length || data.criteria.length !== rubric.criteria.length || rubric.criteria.some((c) => !keys.has(c.key)))
    invalid("Address every rubric criterion exactly once, without additional keys.");
  for (const criterion of rubric.criteria) {
    const decision = data.criteria.find((c) => c.key === criterion.key)!;
    const ai = draft.criteria.find((c) => c.key === criterion.key);
    if (decision.score > criterion.maxScore) invalid(`${criterion.label}: score must be between 0 and ${criterion.maxScore}.`);
    if (decision.action === "accept" && (!ai || ai.suggestedScore === null || ai.status === "NOT_EVALUATED" || decision.score !== ai.suggestedScore))
      invalid(`${criterion.label}: an unscored or changed suggestion requires an explicit override.`);
    if (decision.action === "override" && decision.reason.length < 10)
      invalid(`${criterion.label}: explain the override, including how you addressed evidence gaps (at least 10 characters).`);
  }
  return {
    scores: Object.fromEntries(data.criteria.map((c) => [c.key, c.score])),
    criterionDecisions: Object.fromEntries(data.criteria.map((c) => [c.key, { action: c.action, reason: c.reason }])),
    rationale: data.rationale,
  };
}
