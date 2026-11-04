import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadEnvConfig, updateInitialEnv } from "@next/env";
import { loadOperatorEnvironment } from "../../src/lib/evaluation/operator-environment";
import { describeDiagnostic, runProviderDiagnostic } from "../../src/lib/evaluation/provider-diagnostic";
import { describeProviderContract } from "../../src/lib/evaluation/contract-smoke";
import { geminiGenerationConfig, MODEL_BUDGET, SYSTEM_INSTRUCTION, type ModelRequest } from "../../src/lib/evaluation/model";
import { providerResponseSchema } from "../../src/lib/evaluation/provider-schema";
import { modelDraft } from "../helpers/model";

const sentinel = "private-provider-payload-do-not-log";
const syntheticProbe = {
  summary: sentinel, limitations: ["Synthetic only."], criteria: [{ key: "probe", status: "NOT_EVALUATED", suggestedScore: null,
    rationale: "Synthetic only.", uncertainty: "No project evaluated.", citations: [], findings: [] }],
};
function success(text: string, finishReason = "STOP") {
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }], modelVersion: "mock-model" });
}
function fullDraft(body: { contents: Array<{ parts: Array<{ text: string }> }> }) {
  return modelDraft({ model: "gemini-3.5-flash", input: body.contents[0].parts[0].text,
    systemInstruction: SYSTEM_INSTRUCTION, responseJsonSchema: providerResponseSchema(), signal: new AbortController().signal });
}
async function withConfiguration(run: () => Promise<void>) {
  const previousKey = process.env.GEMINI_API_KEY, previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "mock-diagnostic-key"; process.env.GEMINI_MODEL = "gemini-3.5-flash";
  try { await run(); } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previousModel;
  }
}

test("offline A/B/C descriptions select the configured model and make zero SDK/provider calls", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected network access."); });
    const plans = describeDiagnostic();
    assert.deepEqual(plans.map((p) => p.case), ["A", "B", "C"]);
    assert.ok(plans.every((p) => p.selectedModel === "gemini-3.5-flash" && p.maxOutputTokens === 12000 && p.candidateCount === 1 && p.timeoutMs === 40000));
    assert.equal(plans[0].schemaHash, null); assert.equal(plans[0].responseMimeType, "text/plain");
    assert.equal(plans[1].schemaHash, plans[2].schemaHash); assert.equal(plans[1].schemaBytes, 1407);
    assert.ok(plans[0].inputBytes < plans[1].inputBytes && plans[1].inputBytes < plans[2].inputBytes);
    assert.equal(plans[2].inputBytes, describeProviderContract().inputBytes);
    const rows = await runProviderDiagnostic(); assert.ok(rows.every((r) => r.status === "NOT_RUN" && r.httpStatus === null));
    assert.equal(calls, 0); assert.ok(!JSON.stringify(rows).includes("mock-diagnostic-key"));
  });
});

test("controlled A/B/C calls use the production SDK, selected model, exact schema and equal default budgets", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      assert.equal(String(input), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generationConfig.maxOutputTokens, MODEL_BUDGET.outputTokens);
      assert.equal(body.generationConfig.candidateCount, 1);
      assert.equal(body.generationConfig.thinkingConfig, undefined); assert.equal(body.tools, undefined);
      assert.ok(!String(init?.body).includes("mock-diagnostic-key"));
      if (calls === 1) {
        assert.equal(body.generationConfig.responseJsonSchema, undefined); assert.equal(body.generationConfig.responseMimeType, "text/plain");
        return success("OK");
      }
      assert.deepEqual(body.generationConfig.responseJsonSchema, providerResponseSchema());
      assert.equal(body.generationConfig.responseSchema, undefined); assert.equal(body.generationConfig.responseMimeType, "application/json");
      if (calls === 2) return success(JSON.stringify(syntheticProbe));
      assert.deepEqual(body.systemInstruction.parts, [{ text: SYSTEM_INSTRUCTION }]);
      const draft = fullDraft(body); draft.summary = sentinel;
      return success(JSON.stringify(draft));
    });
    const emitted: unknown[] = [];
    const rows = await runProviderDiagnostic({ live: true }, (row) => emitted.push(row));
    assert.equal(calls, 3); assert.equal(emitted.length, 3);
    assert.ok(rows.every((r) => r.status === "PASS" && r.httpStatus === 200 && r.category === "SUCCESS" && r.elapsedMs >= 0));
    assert.ok(!JSON.stringify(rows).includes(sentinel)); assert.ok(!JSON.stringify(rows).includes("export function add"));
  });
});

test("503 remains serving unavailability and does not trigger hidden retries or a schema verdict", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (calls === 1) return success("OK");
      if (calls === 2) return Response.json({ error: { code: 503, status: "UNAVAILABLE", message: `API_KEY_INVALID invalid schema ${sentinel}` } }, { status: 503 });
      return success(JSON.stringify(fullDraft(JSON.parse(String(init?.body)))));
    });
    const rows = await runProviderDiagnostic({ live: true });
    assert.equal(calls, 3); assert.equal(rows[0].status, "PASS"); assert.equal(rows[2].status, "PASS");
    assert.equal(rows[1].httpStatus, 503); assert.equal(rows[1].category, "GEMINI_UNAVAILABLE");
    assert.ok(!JSON.stringify(rows).includes("API_KEY_INVALID")); assert.ok(!JSON.stringify(rows).includes(sentinel));
  });
});

test("400 is distinguished from 503 while a successful HTTP response with invalid citations remains a validation failure", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (calls === 1) return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: sentinel } }, { status: 400 });
      const draft = fullDraft(JSON.parse(String(init?.body))); draft.criteria[0].citations[0].path = "absent.ts";
      return success(JSON.stringify(draft));
    });
    const invalid = await runProviderDiagnostic({ live: true, cases: ["B"] });
    assert.equal(invalid[0].httpStatus, 400); assert.equal(invalid[0].category, "GEMINI_INVALID_REQUEST");
    const uncited = await runProviderDiagnostic({ live: true, cases: ["C"] });
    assert.equal(uncited[0].httpStatus, 200); assert.equal(uncited[0].category, "OUTPUT_VALIDATION_FAILED");
    assert.equal(calls, 2);
  });
});

test("an explicit single-case output-budget control never changes production configuration", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body)); assert.equal(body.generationConfig.maxOutputTokens, 1024);
      assert.deepEqual(body.generationConfig.responseJsonSchema, providerResponseSchema());
      return success("{}", "MAX_TOKENS");
    });
    const rows = await runProviderDiagnostic({ live: true, cases: ["B"], maxOutputTokens: 1024 });
    assert.equal(calls, 1); assert.equal(rows.length, 1); assert.equal(rows[0].maxOutputTokens, 1024);
    assert.equal(rows[0].httpStatus, 200); assert.equal(rows[0].category, "OUTPUT_INCOMPLETE");
    assert.equal(geminiGenerationConfig({} as ModelRequest).maxOutputTokens, 12000);
  });
});

test("access, quota and rate failures stop later probes; invalid limits never make a call", async (t) => {
  await withConfiguration(async () => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: sentinel } }, { status: 429 }); });
    const rows = await runProviderDiagnostic({ live: true });
    assert.equal(calls, 1); assert.equal(rows[0].category, "GEMINI_RATE_LIMITED");
    assert.ok(rows.slice(1).every((r) => r.status === "NOT_RUN" && r.httpStatus === null));
    for (const maxOutputTokens of [0, 255, 12001, Infinity, NaN]) await assert.rejects(runProviderDiagnostic({ live: true, maxOutputTokens }));
    await assert.rejects(runProviderDiagnostic({ live: true, cases: ["A", "A"] }));
    assert.equal(calls, 1);
  });
});

test("operator loading uses Next's real env convention and reports file selection or inherited override without secrets", async () => {
  const saved = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "hackref-diagnostic-env-"));
  try {
    delete process.env.GEMINI_MODEL;
    updateInitialEnv({ ...process.env });
    await writeFile(join(directory, ".env"), "GEMINI_MODEL=gemini-3.5-flash\nGEMINI_API_KEY=private-fixture-credential\n");
    const reload: typeof loadEnvConfig = (dir, dev, logger) => loadEnvConfig(dir, dev, logger, true);
    const selected = loadOperatorEnvironment(directory, reload);
    assert.deepEqual(selected, { selectedModel: "gemini-3.5-flash", modelSource: "ENV_FILE", modelEnvFile: ".env" });
    assert.ok(!JSON.stringify(selected).includes("private-fixture-credential"));
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    updateInitialEnv({ ...saved, GEMINI_MODEL: "gemini-2.5-flash" });
    const overridden = loadOperatorEnvironment(directory, reload);
    assert.deepEqual(overridden, { selectedModel: "gemini-2.5-flash", modelSource: "PROCESS_ENVIRONMENT", modelEnvFile: null });
  } finally {
    updateInitialEnv(saved);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(directory, { recursive: true, force: true });
  }
});
