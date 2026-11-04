import "server-only";
import { createHash } from "node:crypto";
import { assessmentInput, assessSource, configuredGeminiModel, geminiGenerationConfig, SYSTEM_INSTRUCTION, type ModelTransport, type RubricSnapshot } from "./model";
import { providerResponseSchema, PROVIDER_SCHEMA_VERSION } from "./provider-schema";
import { PROMPT_VERSION } from "./versions";
import { SOURCE_VERSION, type SourceBundle } from "./source";
import { AppError } from "../errors";

// Synthetic data only. No database, queue, retry, filesystem source collector,
// GitHub request or participant repository is involved in this contract check.
export function syntheticContractInputs(): { source: SourceBundle; rubric: RubricSnapshot; claims: string[] } {
  const runId = "11111111-1111-4111-8111-111111111111";
  const commitSha = createHash("sha1").update("HackRef synthetic contract commit").digest("hex");
  const contents = [
    { id: "22222222-2222-4222-8222-222222222222", path: "src/app.ts", text: 'export function add(a: number, b: number) {\n  return a + b;\n}', documentation: false },
    { id: "33333333-3333-4333-8333-333333333333", path: "tests/app.test.ts", text: '// Synthetic test declaration only; never executed.\n// Intended assertion: add(2, 3) equals 5.', documentation: false },
    { id: "44444444-4444-4444-8444-444444444444", path: "README.md", text: '# Synthetic addition example\nClaim: adds two numbers. Runtime correctness is not verified.', documentation: true },
  ];
  const files = contents.map(({ id, path, text, documentation }) => ({
    id, runId, path, commitSha,
    blobSha: createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex"),
    contentHash: createHash("sha256").update(text).digest("hex"),
    sourceUri: `urn:hackref:synthetic:${path}`, excerpt: text,
    startLine: 1, endLine: text.split("\n").length, truncated: false, documentation,
  }));
  return {
    source: {
      version: SOURCE_VERSION, runId, commitSha,
      treeSha: createHash("sha1").update("HackRef synthetic tree").digest("hex"), files, checks: [],
      coverage: { treeTruncated: false, listedEntries: files.length, requests: 0,
        fetchedBytes: 0, excerptBytes: files.reduce((sum, f) => sum + Buffer.byteLength(f.excerpt), 0),
        omittedCount: 0, omissions: [], limitations: ["Synthetic contract test only. No repository, tests or integrations were executed."] },
    },
    rubric: { id: "55555555-5555-4555-8555-555555555555", version: 1, title: "Synthetic provider contract rubric",
      criteria: [{ key: "quality", label: "Static source clarity", maxScore: 10 }, { key: "tests", label: "Static test evidence", maxScore: 5 }] },
    claims: ["Synthetic example declares an addition function; successful execution is not verified."],
  };
}

export function describeProviderContract(model = configuredGeminiModel()) {
  const schema = providerResponseSchema();
  const { source, rubric, claims } = syntheticContractInputs();
  const dataBytes = Buffer.byteLength(assessmentInput(source, rubric, claims));
  const promptBytes = Buffer.byteLength(SYSTEM_INSTRUCTION);
  const config = geminiGenerationConfig({ model: "unused", input: "", systemInstruction: SYSTEM_INSTRUCTION, responseJsonSchema: schema, signal: new AbortController().signal });
  return {
    selectedModel: model, dataBytes, promptBytes,
    inputBytes: dataBytes + promptBytes + Buffer.byteLength(JSON.stringify(schema)),
    providerSchemaVersion: PROVIDER_SCHEMA_VERSION, promptVersion: PROMPT_VERSION,
    schemaHash: createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
    schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
    promptHash: createHash("sha256").update(SYSTEM_INSTRUCTION).digest("hex"),
    settings: { responseMimeType: config.responseMimeType, maxOutputTokens: config.maxOutputTokens,
      candidateCount: config.candidateCount, automaticContinuation: config.automaticContinuation,
      timeoutMs: config.httpOptions?.timeout },
  };
}

export async function runContractSmoke(options: { live?: boolean; model?: string; transport?: ModelTransport } = {}) {
  const description = describeProviderContract(options.model);
  if (options.live !== true) return { status: "NOT_RUN", ...description } as const;
  const model = options.model ?? configuredGeminiModel();
  const { source, rubric, claims } = syntheticContractInputs();
  const result = await assessSource(source, rubric, claims, { model, transport: options.transport });
  if (!result.draft.criteria.some((c) => c.status === "UNVERIFIED" && c.suggestedScore !== null && c.citations.length > 0))
    throw new AppError(422, "Provider responded, but no cited synthetic criterion received a validated provisional score. The contract check did not pass.");
  return {
    status: "PASS", ...description, requestedModel: result.requestedModel,
    returnedModel: /^(?:models\/)?gemini-[A-Za-z0-9._-]{1,180}$/.test(result.modelVersion) ? result.modelVersion : "[unavailable]",
    inputBytes: result.inputBytes, criteriaValidated: result.draft.criteria.length,
    citationsValidated: result.draft.criteria.reduce((sum, c) => sum + c.citations.length + c.findings.length, 0),
  } as const;
}
