import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { callPolzaForExtraction, listPolzaModels, PolzaAiError } from "../lib/extraction/polza-ai.mjs";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8").then(JSON.parse);
const okResponse = (value) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200, headers: { "content-type": "application/json" } });
const valid = { document_type: "act", classification_confidence: 0.9, field_candidates: [], table_mappings: [] };

test("Polza JSON object fallback remains locally schema-checked and grounded", async () => {
  const parsed = await fixture("document-parser-native-pdf.analysis.json");
  const requestFormats = [];
  let calls = 0;
  const llm = await callPolzaForExtraction(parsed, {
    POLZA_API_KEY: "unit-test-key",
    POLZA_FETCH: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      requestFormats.push(body.response_format.type);
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "response_format json_schema is not supported" } }), { status: 400 });
      return okResponse(valid);
    },
  });
  assert.deepEqual(requestFormats, ["json_schema", "json_object"]);
  assert.equal(llm.validation_status, "json_mode_locally_validated_and_grounded");
});

test("Polza JSON parsing accepts fenced output while preserving local schema validation", async () => {
  const parsed = await fixture("document-parser-native-pdf.analysis.json");
  const llm = await callPolzaForExtraction(parsed, {
    POLZA_API_KEY: "unit-test-key",
    POLZA_FETCH: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: `Here is the result:\n\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`` } }] }), { status: 200 }),
  });
  assert.equal(llm.validation_status, "strict_schema_and_grounded");
  assert.deepEqual(llm.field_candidates, []);
});

test("Polza maps authentication, balance, model, rate-limit and server errors", async () => {
  const parsed = await fixture("document-parser-native-pdf.analysis.json");
  const expected = [[401, 401, "POLZA_UNAUTHORIZED"], [402, 402, "POLZA_PAYMENT_REQUIRED"], [404, 404, "POLZA_MODEL_NOT_FOUND"], [429, 429, "POLZA_RATE_LIMITED"], [500, 502, "POLZA_UPSTREAM_ERROR"]];
  for (const [upstream, status, code] of expected) {
    await assert.rejects(callPolzaForExtraction(parsed, {
      POLZA_API_KEY: "unit-test-key",
      POLZA_FETCH: async () => new Response(JSON.stringify({ error: { message: "provider test response" } }), { status: upstream }),
    }), (error) => error instanceof PolzaAiError && error.status === status && error.code === code);
  }
});

test("Polza retries transient network errors only within the configured bound", async () => {
  const parsed = await fixture("document-parser-native-pdf.analysis.json");
  let calls = 0;
  await assert.rejects(callPolzaForExtraction(parsed, {
    POLZA_API_KEY: "unit-test-key",
    POLZA_FETCH: async () => { calls++; throw new TypeError("network unavailable"); },
  }), (error) => error instanceof PolzaAiError && error.code === "POLZA_NETWORK_ERROR");
  assert.equal(calls, 2);
});

test("Polza models endpoint requests the model catalog without exposing the API key", async () => {
  let request;
  const models = await listPolzaModels({
    POLZA_API_KEY: "unit-test-key",
    POLZA_FETCH: async (url, init) => {
      request = { url, method: init.method, authorization: init.headers.authorization };
      return new Response(JSON.stringify({ data: [{ id: "deepseek/deepseek-v4-flash" }] }), { status: 200 });
    },
  });
  assert.deepEqual(request, { url: "https://polza.ai/api/v1/models", method: "GET", authorization: "Bearer unit-test-key" });
  assert.equal(models[0].id, "deepseek/deepseek-v4-flash");
});
