import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { describeProviderContract, runContractSmoke, syntheticContractInputs } from "../../src/lib/evaluation/contract-smoke";
import { assessSource, configuredGeminiModel, draftSchema, geminiGenerationConfig, MODEL_BUDGET, SYSTEM_INSTRUCTION, validateDraft, type ModelRequest } from "../../src/lib/evaluation/model";
import { providerResponseSchema, PROVIDER_SCHEMA_VERSION } from "../../src/lib/evaluation/provider-schema";
import { GeminiError, providerError } from "../../src/lib/evaluation/provider-errors";
import { safeValidationPath } from "../../src/lib/evaluation/request-diagnostics";
import { modelDraft, modelFixture } from "../helpers/model";

type Schema = { type?: unknown; enum?: unknown; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: unknown; items?: Schema; anyOf?: Schema[]; [key: string]: unknown };
function shape(schema: Schema): unknown {
  return {
    type: schema.anyOf ? schema.anyOf.map((s) => s.type) : schema.type,
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, shape(child)])), required: schema.required, additionalProperties: schema.additionalProperties } : {}),
    ...(schema.items ? { items: shape(schema.items) } : {}),
  };
}
function requestForSynthetic(): ModelRequest {
  const { source, rubric } = syntheticContractInputs();
  return { model: "mock", input: JSON.stringify({ source, rubric }), systemInstruction: SYSTEM_INSTRUCTION, responseJsonSchema: providerResponseSchema(), signal: new AbortController().signal };
}

test("provider schema is a minimal documented structural subset of the full internal Zod schema", () => {
  const rich = z.toJSONSchema(draftSchema) as Schema;
  const provider = providerResponseSchema();
  assert.deepEqual(shape(provider), shape(rich));
  assert.ok(JSON.stringify(rich).includes('"maxLength"'));
  assert.ok(JSON.stringify(rich).includes('9007199254740991'));
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
  const walk = (node: Schema) => {
    for (const key of Object.keys(node)) assert.ok(allowed.has(key), `Unexpected provider schema keyword ${key}`);
    if (node.properties) {
      assert.deepEqual(node.required, Object.keys(node.properties)); assert.equal(node.additionalProperties, false);
      Object.values(node.properties).forEach(walk);
    }
    if (node.items) walk(node.items);
  };
  walk(provider);
  assert.ok(Buffer.byteLength(JSON.stringify(provider)) < Buffer.byteLength(JSON.stringify(rich)));
  const changed = providerResponseSchema(); changed.properties!.summary.type = "number";
  assert.equal(providerResponseSchema().properties!.summary.type, "string");
});

test("server constraints survive removal of provider lengths, patterns, formats and numeric/array bounds", () => {
  const { source, rubric } = syntheticContractInputs(); const original = modelDraft(requestForSynthetic());
  const mutations = [
    (d: typeof original) => { d.summary = "x".repeat(1201); },
    (d: typeof original) => { d.limitations = []; },
    (d: typeof original) => { d.criteria[0].citations[0].evidenceId = "not-a-uuid"; },
    (d: typeof original) => { d.criteria[0].citations[0].commitSha = "not-a-sha"; },
    (d: typeof original) => { d.criteria[0].citations[0].startLine = -1; },
    (d: typeof original) => { d.criteria[0].citations[0].endLine = 9007199254740992; },
    (d: typeof original) => { d.criteria[0].citations.push(...Array(4).fill(d.criteria[0].citations[0])); },
    (d: typeof original) => { d.criteria[0].suggestedScore = 11; },
    (d: typeof original) => { d.criteria[1].suggestedScore = 6; },
    (d: typeof original) => { d.criteria[0].citations[0].path = "absent.ts"; },
    (d: typeof original) => { d.criteria[0].key = "other_rubric"; },
    (d: typeof original) => { Object.assign(d.criteria[0], { status: "VERIFIED" }); },
    (d: typeof original) => { Object.assign(d, { payout: "approved" }); },
  ];
  for (const change of mutations) { const draft = structuredClone(original); change(draft); assert.throws(() => validateDraft(JSON.stringify(draft), source, rubric)); }
});

test("model configuration stays explicit and avoids model-specific tuning fields", () => {
  const previous = process.env.GEMINI_MODEL;
  try {
    for (const model of ["gemini-3.5-flash", "gemini-2.5-flash", "operator-selected-model"]) {
      process.env.GEMINI_MODEL = model;
      assert.equal(configuredGeminiModel(), model);
      const config = geminiGenerationConfig(requestForSynthetic());
      assert.equal(config.responseMimeType, "application/json"); assert.equal(config.responseSchema, undefined);
      assert.equal(config.maxOutputTokens, MODEL_BUDGET.outputTokens); assert.equal(config.candidateCount, 1);
      assert.equal(config.automaticContinuation, false);
      assert.equal(config.thinkingConfig, undefined); assert.equal(config.temperature, undefined); assert.equal(config.tools, undefined);
      assert.deepEqual(config.responseJsonSchema, providerResponseSchema());
    }
  } finally { if (previous === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previous; }
});

test("production SDK wire request and smoke share the actual schema/settings and validate structured evidence output", async (t) => {
  const previous = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "mock-contract-key";
  try {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++; assert.match(String(input), /\/v1beta\/models\/gemini-3.5-flash:generateContent$/);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.generationConfig.responseJsonSchema, providerResponseSchema());
      assert.deepEqual(Object.keys(body.generationConfig).sort(), ["candidateCount", "maxOutputTokens", "responseJsonSchema", "responseMimeType"]);
      assert.equal(body.generationConfig.maxOutputTokens, MODEL_BUDGET.outputTokens);
      assert.deepEqual(body.systemInstruction.parts, [{ text: SYSTEM_INSTRUCTION }]);
      const request = { ...requestForSynthetic(), input: body.contents[0].parts[0].text };
      const envelope = JSON.parse(request.input);
      assert.equal(envelope.source.files.length, 3); assert.equal(envelope.rubric.criteria.length, 2);
      assert.ok(!String(init?.body).includes("mock-contract-key"));
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(modelDraft(request)) }] }, finishReason: "STOP" }], modelVersion: "mock-contract-response" });
    });
    const result = await runContractSmoke({ live: true, model: "gemini-3.5-flash" });
    assert.equal(result.status, "PASS"); assert.equal(result.criteriaValidated, 2); assert.ok(result.citationsValidated! > 0);
    assert.equal(result.providerSchemaVersion, PROVIDER_SCHEMA_VERSION); assert.equal(calls, 1);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});

test("contract smoke is offline by default, has no source/network dependency and never prints generated assessment text", async () => {
  let calls = 0;
  assert.equal((await runContractSmoke({ transport: async () => { calls++; throw new Error("unexpected"); } })).status, "NOT_RUN");
  assert.equal(calls, 0);
  const result = await runContractSmoke({ live: true, model: "mock", transport: modelFixture });
  assert.equal(result.status, "PASS"); assert.equal(JSON.stringify(result).includes("provisional static review"), false);
  assert.equal(describeProviderContract().settings.maxOutputTokens, MODEL_BUDGET.outputTokens);
  await assert.rejects(runContractSmoke({ live: true, model: "mock", transport: async (request) => {
    const draft = modelDraft(request);
    draft.criteria.forEach((c) => { c.status = "NOT_EVALUATED"; c.suggestedScore = null; c.citations = []; c.findings = []; });
    return { text: JSON.stringify(draft), modelVersion: "mock", finishReason: "STOP" };
  } }), /contract check did not pass/);
});

test("SDK automatic continuation cannot silently make more contract requests", async (t) => {
  const previous = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "mock-contract-key";
  try {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json({ continuationToken: "synthetic-continuation", candidates: [{ content: { role: "model", parts: [{ text: "{}" }] }, finishReason: "CONTINUATION" }], modelVersion: "mock" });
    });
    await assert.rejects(runContractSmoke({ live: true, model: "gemini-3.5-flash" }), /blocked, incomplete/);
    assert.equal(calls, 1);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});

test("400 diagnostics retain only known field paths/reason categories and never echo provider text or credentials", () => {
  const secret = "sensitive-key-and-source-value";
  const error = providerError(Object.assign(new Error(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: secret, details: [
    { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [
      { field: 'generation_config.response_json_schema.properties["criteria"].items.properties.citations.maxItems', description: `Unknown name maxItems. ${secret}` },
      { field: "generation_config.max_output_tokens", description: secret },
      { field: `generation_config.${secret}`, description: secret },
      { field: "headers.authorization", description: secret },
    ] },
  ] } })), { status: 400 }));
  assert.equal(error.code, "GEMINI_INVALID_REQUEST"); assert.equal(error.providerStatus, 400); assert.equal(error.retryable, false);
  assert.deepEqual(error.diagnostics?.fieldPaths, ["generationConfig.responseJsonSchema.properties.criteria.items.properties.citations.maxItems", "generationConfig.maxOutputTokens"]);
  assert.ok(error.diagnostics?.reasons.includes("UNSUPPORTED_SCHEMA_KEYWORD"));
  assert.ok(error.diagnostics?.reasons.includes("INVALID_GENERATION_SETTING"));
  assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.stack?.includes(secret));
  const complex = providerError(Object.assign(new Error(JSON.stringify({ error: { code: 400, message: "Schema too complex; nesting state limit exceeded." } })), { status: 400 }));
  assert.equal(complex.diagnostics?.category, "SCHEMA_COMPLEXITY");
  const generic = providerError(Object.assign(new Error(secret), { status: 400 }));
  assert.deepEqual(generic.diagnostics, { category: "INVALID_ARGUMENT", fieldPaths: [], reasons: ["INVALID_ARGUMENT"] });
  for (const field of [secret, "headers.authorization", "generationConfig.api_key", "contents[0].parts[0].text.sensitive", "https://example.test/key", "generationConfig.responseJsonSchema.properties.constructor", "generationConfig.responseJsonSchema.properties.__proto__"])
    assert.equal(safeValidationPath(field), undefined);
});

test("SDK 400 responses carry sanitized contract diagnostics through the real assessment path", async (t) => {
  const previous = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "mock-contract-key";
  try {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++; assert.deepEqual(JSON.parse(String(init?.body)).generationConfig.responseJsonSchema, providerResponseSchema());
      return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "sensitive rejected payload", details: [{ fieldViolations: [{ field: "generation_config.response_json_schema", description: "Schema too complex" }] }] } }, { status: 400 });
    });
    const { source, rubric, claims } = syntheticContractInputs();
    await assert.rejects(assessSource(source, rubric, claims, { model: "gemini-3.5-flash" }), (error: unknown) => {
      assert.ok(error instanceof GeminiError); assert.equal(error.code, "GEMINI_INVALID_REQUEST");
      assert.equal(error.diagnostics?.category, "SCHEMA_COMPLEXITY"); assert.ok(!JSON.stringify(error).includes("sensitive")); return true;
    });
    assert.equal(calls, 1);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});
