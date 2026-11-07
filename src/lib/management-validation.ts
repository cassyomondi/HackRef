import { eventInput, rubricInput } from "./validation";

function asciiWords(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function eventSlug(name: string) {
  return asciiWords(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/g, "");
}

export function slugError(slug: string) {
  if (!slug) return "Enter an event slug.";
  if (slug.length > 80) return "Use 80 characters or fewer.";
  if (!eventInput.shape.slug.safeParse(slug).success || slug !== slug.trim())
    return "Use lowercase letters and numbers separated by single hyphens. Spaces, underscores and leading or trailing hyphens are not allowed.";
  return "";
}

export function criterionKey(label: string) {
  let key = asciiWords(label).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (key && !/^[a-z]/.test(key)) key = `criterion_${key}`;
  return key.slice(0, 40).replace(/_$/g, "");
}

export type CriterionDraft = { label: string; key: string; maxScore: string };

export function criterionErrors(row: CriterionDraft, rows: CriterionDraft[]) {
  const shape = rubricInput.shape.criteria.element.shape;
  return {
    label: shape.label.safeParse(row.label).success ? "" : "Enter a criterion label (1–120 characters).",
    key: !shape.key.safeParse(row.key).success
      ? "Use 1–40 characters: start with a lowercase letter, then lowercase letters, numbers or underscores."
      : rows.filter((other) => other.key === row.key).length > 1 ? "This key is already used. Each criterion needs a unique key." : "",
    maxScore: shape.maxScore.safeParse(Number(row.maxScore)).success ? "" : "Enter a whole number from 1 to 100.",
  };
}

export function rubricPayload(title: string, rows: CriterionDraft[]) {
  return { title, criteria: rows.map((row) => ({ label: row.label, key: row.key, maxScore: Number(row.maxScore) })) };
}
