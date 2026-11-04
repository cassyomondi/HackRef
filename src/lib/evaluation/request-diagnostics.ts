import "server-only";
import { providerResponseSchema } from "./provider-schema";

type Reason = "UNSUPPORTED_SCHEMA_KEYWORD" | "SCHEMA_COMPLEXITY" | "INVALID_SCHEMA" |
  "INVALID_GENERATION_SETTING" | "INVALID_REQUEST_FIELD" | "INVALID_ARGUMENT";
export type RequestDiagnostics = { category: Reason; fieldPaths: string[]; reasons: Reason[] };
export type ValidationDetail = {
  reason?: string;
  fieldViolations?: Array<{ field?: string; description?: string }>;
};

const aliases: Record<string, string> = {
  generation_config: "generationConfig", response_json_schema: "responseJsonSchema",
  response_schema: "responseSchema", response_mime_type: "responseMimeType",
  max_output_tokens: "maxOutputTokens", candidate_count: "candidateCount",
  thinking_config: "thinkingConfig", thinking_budget: "thinkingBudget", thinking_level: "thinkingLevel",
  system_instruction: "systemInstruction", additional_properties: "additionalProperties",
  min_length: "minLength", max_length: "maxLength", min_items: "minItems", max_items: "maxItems",
};
const tokens = new Set([
  "generationConfig", "responseJsonSchema", "responseSchema", "responseMimeType", "maxOutputTokens",
  "candidateCount", "thinkingConfig", "thinkingBudget", "thinkingLevel", "temperature", "topK", "topP",
  "systemInstruction", "contents", "parts", "text", "role", "model",
  "type", "properties", "items", "required", "additionalProperties", "enum", "anyOf", "oneOf",
  "$schema", "$ref", "$defs", "format", "pattern", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum",
]);
function addPropertyNames(schema: ReturnType<typeof providerResponseSchema>) {
  for (const [name, child] of Object.entries(schema.properties ?? {})) { tokens.add(name); addPropertyNames(child); }
  if (schema.items) addPropertyNames(schema.items);
}
addPropertyNames(providerResponseSchema());

// Field paths can themselves contain user content or credentials. Accept only
// known request/schema/property tokens and bounded numeric positions, never
// arbitrary property names, headers, descriptions or provider reason strings.
export function safeValidationPath(raw: string): string | undefined {
  if (raw.length > 240 || !/^[A-Za-z0-9_.$[\]"/]+$/.test(raw)) return;
  const normalized = raw.replaceAll(/\["?([A-Za-z0-9_$]+)"?\]/g, ".$1").replaceAll("/", ".").replace(/^\./, "");
  const parts = normalized.split(".").map((part) => aliases[part] ?? part);
  if (!["generationConfig", "systemInstruction", "contents", "model"].includes(parts[0])) return;
  if (parts.some((part) => !tokens.has(part) && !/^(?:0|[1-9][0-9]?)$/.test(part))) return;
  return parts.join(".").replaceAll(/\.(\d+)(?=\.|$)/g, "[$1]");
}

export function invalidRequestDiagnostics(message: string, details: ValidationDetail[]): RequestDiagnostics {
  const fieldPaths = new Set<string>();
  const reasons = new Set<Reason>();
  const complexity = (text: string) => /too (?:many states|complex|deep)|schema.{0,80}(?:complexity|nesting|state limit)|(?:state|nesting).{0,40}(?:limit|exceed)|SCHEMA_TOO_COMPLEX/i.test(text);
  const record = (rawPath: string | undefined, description: string) => {
    const path = rawPath ? safeValidationPath(rawPath) : undefined;
    if (path && fieldPaths.size < 8) fieldPaths.add(path);
    if (complexity(description)) reasons.add("SCHEMA_COMPLEXITY");
    else if (path?.includes("Schema")) reasons.add(/unsupported|not supported|unknown (?:name|field|keyword)|not allowed/i.test(description) ? "UNSUPPORTED_SCHEMA_KEYWORD" : "INVALID_SCHEMA");
    else if (path?.startsWith("generationConfig")) reasons.add("INVALID_GENERATION_SETTING");
    else if (path) reasons.add("INVALID_REQUEST_FIELD");
  };
  for (const detail of details.slice(0, 16)) {
    if (detail.reason === "SCHEMA_TOO_COMPLEX") reasons.add("SCHEMA_COMPLEXITY");
    for (const violation of (detail.fieldViolations ?? []).slice(0, 16)) record(violation.field, (violation.description ?? "").slice(0, 2000));
  }
  // Some SDK errors contain field paths only in their message, not BadRequest.
  // Extract candidates through the same strict allowlist; never retain the text.
  for (const match of message.slice(0, 65_536).matchAll(/\b(?:generation_config|generationConfig|system_instruction|systemInstruction|contents)\.[A-Za-z0-9_.$[\]"]+/g))
    record(match[0], message.slice(0, 2000));
  if (complexity(message.slice(0, 2000))) reasons.add("SCHEMA_COMPLEXITY");
  if (!reasons.size) reasons.add("INVALID_ARGUMENT");
  const category = reasons.has("SCHEMA_COMPLEXITY") ? "SCHEMA_COMPLEXITY" : [...reasons][0];
  return { category, fieldPaths: [...fieldPaths], reasons: [...reasons] };
}
