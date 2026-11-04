import "server-only";

export const PROVIDER_SCHEMA_VERSION = "gemini-draft-structure-v2";

type Shape = {
  type: string | string[];
  properties?: Record<string, Shape>;
  required?: string[];
  additionalProperties?: false;
  items?: Shape;
  enum?: string[];
};
const object = (properties: Record<string, Shape>): Shape => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const string = (): Shape => ({ type: "string" });
const array = (items: Shape): Shape => ({ type: "array", items });
const citation = () => object({
  evidenceId: string(), runId: string(), commitSha: string(), path: string(),
  startLine: { type: "integer" }, endLine: { type: "integer" },
});

// Deliberately structural: no Zod dialect, regex/format/length constraints,
// numeric/array bounds, references or recursive types enter the provider grammar.
// Every rich/contextual constraint remains mandatory in draftSchema/validateDraft.
// Return a fresh object so callers/the SDK cannot mutate the shared contract.
export function providerResponseSchema(): Shape {
  return object({
    summary: string(), limitations: array(string()),
    criteria: array(object({
      key: string(), status: { type: "string", enum: ["UNVERIFIED", "NOT_EVALUATED"] },
      suggestedScore: { type: ["number", "null"] },
      rationale: string(), uncertainty: string(), citations: array(citation()),
      findings: array(object({ summary: string(), citation: citation() })),
    })),
  });
}

// These rules guide generation; enforcement belongs to the strict server schema.
export const OUTPUT_BOUNDS_INSTRUCTION = `Output bounds: summary, rationale and finding summary must be 1-1200 characters; uncertainty and each limitation 1-500 characters. Include 1-12 limitations and exactly the rubric's criteria (1-20), with keys 1-40 characters. Per criterion use at most 4 citations and 3 findings. Suggested scores must be null or between zero and that criterion's maxScore. Citation paths must exactly match collected paths (at most 240 characters); UUIDs, commit SHAs and positive integer line references must match the evidence. Unsupported criteria must have null score, no citations and no findings. All fields are required; additional fields are forbidden.`;
