import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const login = await fetch(new URL("/signin-with-chatgpt?return_to=%2F", baseUrl), { redirect: "manual" });
assert.equal(login.status, 302, "start the local app with npm run dev first");
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.match(cookie ?? "", /^__sites_local_auth=1$/);
const headers = { cookie };
const json = async (path, init = {}) => {
  const response = await fetch(new URL(path, baseUrl), { ...init, headers: { ...headers, ...init.headers } });
  return { response, body: await response.json() };
};

const health = await json("/api/health");
assert.ok(health.response.ok, JSON.stringify(health.body));
if (!health.body.llm.configured) {
  console.log("SKIP real Polza smoke: the local Worker has no POLZA_API_KEY configured.");
  process.exit(0);
}

const models = await json("/api/llm/models");
assert.ok(models.response.ok, JSON.stringify(models.body));
assert.ok(models.body.models.some((model) => model.id === "google/gemma-4-26b-a4b-it"), "requested model must be returned by Polza GET /models");

const documents = await json("/api/documents");
assert.ok(documents.response.ok, JSON.stringify(documents.body));
const kfz = documents.body.documents.find((document) => document.id === "kfz-2026-q1");
assert.ok(kfz, "KФЗ demo document must be seeded in D1");
const extract = (mode) => json(`/api/documents/${encodeURIComponent(kfz.id)}/extract`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode }),
});
const assisted = await extract("llm_assisted");
assert.equal(assisted.response.status, 201, JSON.stringify(assisted.body));
assert.equal(assisted.body.stored, true);
const checkRealCall = (extraction, mode) => {
  assert.equal(extraction.mode, mode);
  assert.equal(extraction.extraction_engine.llm.provider, "polza_ai");
  assert.equal(extraction.extraction_engine.llm.model, "google/gemma-4-26b-a4b-it");
  assert.equal(extraction.extraction_engine.llm.called, true);
  assert.equal(extraction.extraction_engine.llm.response_validated, true);
  assert.doesNotMatch(extraction.extraction_engine.llm.validation_status, /filtered/, "the model must not suggest field candidates that fail local source grounding");
  assert.ok(extraction.extraction_engine.llm.duration_ms > 0, "inference must report elapsed time");
  assert.ok(extraction.extraction_engine.llm.usage?.total_tokens > 0, "inference must report provider usage");
  const checkGrounding = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.source_value === "string" && value.status !== "missing") {
      assert.ok(value.provenance?.source_ref, "every proposed non-missing value must retain its source locator");
      assert.ok(value.provenance.source_text?.includes(value.source_value), "the source text must confirm the proposed value");
    }
    if (value.source_method === "conflict") {
      assert.equal(value.status, "review", "conflicts must remain pending review");
      assert.equal(value.value, null, "a conflict must not be automatically accepted");
    }
    for (const child of Object.values(value)) checkGrounding(child);
  };
  checkGrounding(extraction.fields);
  checkGrounding(extraction.tables);
};
checkRealCall(assisted.body.extraction, "llm_assisted");

const compared = await extract("compare");
assert.equal(compared.response.status, 201, JSON.stringify(compared.body));
assert.equal(compared.body.stored, true);
checkRealCall(compared.body.extraction, "compare");
assert.ok(compared.body.extraction.comparison);
assert.deepEqual(Object.keys(compared.body.extraction.comparison.counts).sort(), ["discrepancies", "llm_only", "matches", "rules_only"]);

const detail = await json(`/api/documents/${encodeURIComponent(kfz.id)}`);
assert.equal(detail.response.status, 200);
assert.equal(detail.body.document.latest_extraction.extraction_id, compared.body.extraction.extraction_id, "the latest result must be loaded back from D1");
const history = await json(`/api/documents/${encodeURIComponent(kfz.id)}/extractions`);
assert.equal(history.response.status, 200);
assert.ok(history.body.history.some((item) => (item.id ?? item.extraction_id) === assisted.body.extraction.extraction_id && item.mode === "llm_assisted"), "assisted result must persist in D1 history");
assert.ok(history.body.history.some((item) => (item.id ?? item.extraction_id) === compared.body.extraction.extraction_id && item.mode === "compare"), "compare result must persist in D1 history");
console.log("Polza real inference metrics:", JSON.stringify([assisted.body.extraction, compared.body.extraction].map((extraction) => ({ mode: extraction.mode, model: extraction.extraction_engine.llm.model, duration_ms: extraction.extraction_engine.llm.duration_ms, usage: extraction.extraction_engine.llm.usage, compare_counts: extraction.comparison?.counts ?? null }))));
console.log("Polza integration passed: real llm_assisted and compare completions, grounded values, conflict review, and D1 history/readback.");
