import "server-only";
import { createHash } from "node:crypto";
import type { GenerateContentConfig } from "@google/genai";
import { runContractSmoke, syntheticContractInputs } from "./contract-smoke";
import { assessmentInput, configuredGeminiModel, generateGeminiContent, geminiGenerationConfig, MODEL_BUDGET, SYSTEM_INSTRUCTION, validateDraft, type ModelRequest, type ModelTransport } from "./model";
import { GeminiError } from "./provider-errors";
import { providerResponseSchema } from "./provider-schema";
import { AppError } from "../errors";

export type DiagnosticCase = "A" | "B" | "C";
export type DiagnosticOptions = { live?: boolean; cases?: DiagnosticCase[]; maxOutputTokens?: number };
const minimalInput = "Return only the word OK.";
const structuredInput = 'Return one synthetic assessment. Use a short nonempty summary and one limitation. Include exactly one criterion with key probe, status NOT_EVALUATED, suggestedScore null, short nonempty rationale and uncertainty, and empty citations and findings arrays. No extra fields.';
const minimalSystem = "Be concise.";
const structuredSystem = "Return only JSON conforming to the provided schema.";

export function diagnosticOptions(input: DiagnosticOptions) {
  const cases = input.cases ?? ["A", "B", "C"];
  const maxOutputTokens = input.maxOutputTokens ?? MODEL_BUDGET.outputTokens;
  if (!cases.length || cases.length > 3 || new Set(cases).size !== cases.length || cases.some((item) => !["A", "B", "C"].includes(item)))
    throw new AppError(400, "Select one diagnostic case A, B or C, or the three-case comparison.");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > MODEL_BUDGET.outputTokens)
    throw new AppError(400, "Diagnostic output budget must be an integer from 256 to 12000 tokens.");
  return { cases, maxOutputTokens };
}

function requestFor(probe: DiagnosticCase, model: string): ModelRequest {
  const { source, rubric, claims } = syntheticContractInputs();
  return {
    model, input: probe === "A" ? minimalInput : probe === "B" ? structuredInput : assessmentInput(source, rubric, claims),
    systemInstruction: probe === "A" ? minimalSystem : probe === "B" ? structuredSystem : SYSTEM_INSTRUCTION,
    responseJsonSchema: providerResponseSchema(), signal: new AbortController().signal,
  };
}

function configFor(probe: DiagnosticCase, request: ModelRequest, maxOutputTokens: number): GenerateContentConfig {
  const config = { ...geminiGenerationConfig(request), maxOutputTokens };
  if (probe === "A") { delete config.responseJsonSchema; config.responseMimeType = "text/plain"; }
  return config;
}

export function describeDiagnostic(input: DiagnosticOptions = {}) {
  const { cases, maxOutputTokens } = diagnosticOptions(input);
  const selectedModel = configuredGeminiModel();
  return cases.map((probe) => {
    const request = requestFor(probe, selectedModel);
    const config = configFor(probe, request, maxOutputTokens);
    const schema = config.responseJsonSchema ? JSON.stringify(config.responseJsonSchema) : "";
    const promptBytes = Buffer.byteLength(request.systemInstruction);
    const dataBytes = Buffer.byteLength(request.input);
    return {
      case: probe, selectedModel,
      schemaHash: schema ? createHash("sha256").update(schema).digest("hex") : null,
      schemaBytes: Buffer.byteLength(schema), promptBytes, dataBytes,
      inputBytes: promptBytes + dataBytes + Buffer.byteLength(schema),
      maxOutputTokens, candidateCount: config.candidateCount, timeoutMs: MODEL_BUDGET.timeoutMs,
      responseMimeType: config.responseMimeType, schemaField: schema ? "responseJsonSchema" : null,
      sdk: "@google/genai", sdkAttempts: 1, automaticContinuation: false,
      apiHost: "https://generativelanguage.googleapis.com", vertexai: false,
    } as const;
  });
}

export async function runProviderDiagnostic(input: DiagnosticOptions = {}, onResult?: (result: DiagnosticResult) => void) {
  const plans = describeDiagnostic(input);
  const results: DiagnosticResult[] = [];
  let stop = false;
  for (const plan of plans) {
    if (input.live !== true || stop) {
      const row = { ...plan, status: "NOT_RUN", elapsedMs: 0, httpStatus: null, category: stop ? "SKIPPED_AFTER_ACCESS_OR_LIMIT_ERROR" : "OPT_IN_REQUIRED" } as const;
      results.push(row); onResult?.(row); continue;
    }
    let httpStatus: number | null = null;
    let category = "SUCCESS";
    const start = performance.now();
    const signal = AbortSignal.timeout(MODEL_BUDGET.timeoutMs);
    const request = { ...requestFor(plan.case, plan.selectedModel), signal };
    const transport: ModelTransport = async (actual) => {
      const config = configFor(plan.case, actual, plan.maxOutputTokens);
      config.httpOptions = { ...config.httpOptions, fetch: async (url, init) => {
        // Observe only status. Do not inspect/print headers or provider bodies.
        const response = await fetch(url, init); httpStatus = response.status; return response;
      } };
      const response = await generateGeminiContent(actual.model, actual.input, config);
      if (response.candidates?.[0]?.finishReason !== "STOP") category = "OUTPUT_INCOMPLETE";
      return { text: response.text ?? "", modelVersion: response.modelVersion ?? actual.model, finishReason: response.candidates?.[0]?.finishReason ?? "UNKNOWN" };
    };
    let abort: (() => void) | undefined;
    try {
      const operation = async () => {
        if (plan.case === "C") { await runContractSmoke({ live: true, model: plan.selectedModel, transport }); return; }
        const response = await transport(request);
        if (response.finishReason !== "STOP") throw new AppError(422, "Incomplete diagnostic output.");
        if (!response.text.trim() || Buffer.byteLength(response.text) > MODEL_BUDGET.outputBytes) throw new AppError(422, "Invalid diagnostic output.");
        if (plan.case === "B") {
          const { source, rubric } = syntheticContractInputs();
          validateDraft(response.text, { ...source, files: [] }, { ...rubric, criteria: [{ key: "probe", label: "Synthetic probe", maxScore: 1 }] });
        }
      };
      await Promise.race([operation(), new Promise<never>((_, reject) => {
        abort = () => reject(new GeminiError("GEMINI_TIMEOUT", "Diagnostic deadline exceeded.", true));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      })]);
    } catch (error) {
      category = error instanceof GeminiError ? error.code : category === "SUCCESS" ? "OUTPUT_VALIDATION_FAILED" : category;
      if (httpStatus === null && error instanceof GeminiError) httpStatus = error.providerStatus ?? null;
      stop = error instanceof GeminiError && ["GEMINI_KEY_MISSING", "GEMINI_KEY_INVALID", "GEMINI_PERMISSION_DENIED", "GEMINI_MODEL_NOT_FOUND", "GEMINI_QUOTA_EXHAUSTED", "GEMINI_RATE_LIMITED"].includes(error.code);
    } finally { if (abort) signal.removeEventListener("abort", abort); }
    const row = { ...plan, status: category === "SUCCESS" ? "PASS" : "FAIL", elapsedMs: Math.round(performance.now() - start), httpStatus, category } as const;
    results.push(row); onResult?.(row);
  }
  return results;
}

export type DiagnosticResult = ReturnType<typeof describeDiagnostic>[number] & {
  status: "PASS" | "FAIL" | "NOT_RUN"; elapsedMs: number; httpStatus: number | null; category: string;
};
