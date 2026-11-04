import type { DraftOutput, ModelRequest, ModelTransport } from "../../src/lib/evaluation/model";
import type { SourceBundle } from "../../src/lib/evaluation/source";

export function modelDraft(request: ModelRequest): DraftOutput {
  const data = JSON.parse(request.input) as { source: { files: SourceBundle["files"] }; rubric: { criteria: Array<{ key: string; maxScore: number }> } };
  const file = data.source.files.find((f) => f.path === "src/app.ts") ?? data.source.files[0];
  const citation = { evidenceId: file.id, runId: file.runId, commitSha: file.commitSha, path: file.path, startLine: file.startLine, endLine: file.endLine };
  return {
    summary: "A provisional static review from the mocked provider.",
    limitations: ["No tests or integrations were executed."],
    criteria: data.rubric.criteria.map((criterion) => ({
      key: criterion.key, status: "UNVERIFIED", suggestedScore: Math.min(4, criterion.maxScore),
      rationale: "The collected excerpt provides limited static support.", uncertainty: "Runtime functionality is unknown.",
      citations: [citation], findings: [{ summary: "Static source is present; runtime behavior is unverified.", citation }],
    })),
  };
}
export const modelFixture: ModelTransport = async (request) => ({ text: JSON.stringify(modelDraft(request)), modelVersion: "mock-gemini-test-version", finishReason: "STOP" });
export const modelOptions = { transport: modelFixture, model: "mock-gemini" };
