import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const getJson = async (path) => {
  const response = await fetch(new URL(path, baseUrl));
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(body)}`);
  return body;
};

const health = await getJson("/api/health");
assert.equal(health.storage, "Cloudflare D1");

const list = await getJson("/api/documents");
assert.equal(list.storage, "Cloudflare D1");
assert.ok(list.documents.length >= 6);
const kfz = list.documents.find((document) => document.id === "kfz-2026-q1");
assert.ok(kfz);

const before = await getJson(`/api/documents/${encodeURIComponent(kfz.id)}`);
assert.equal(before.document.parser_json.document_id, kfz.id);
assert.equal(before.document.parser_json.logical_tables.find((table) => table.id === "kfz-items").rows.length, 18);

const existingVersion = before.document.extraction_version ?? 0;
const firstResponse = await fetch(new URL(`/api/documents/${encodeURIComponent(kfz.id)}/extract`, baseUrl), { method: "POST" });
const first = await firstResponse.json();
assert.equal(firstResponse.status, 201, JSON.stringify(first));
assert.equal(first.extraction.version, existingVersion + 1);
assert.equal(first.extraction.line_items.length, 18);

const secondResponse = await fetch(new URL(`/api/documents/${encodeURIComponent(kfz.id)}/extract`, baseUrl), { method: "POST" });
const second = await secondResponse.json();
assert.equal(secondResponse.status, 201, JSON.stringify(second));
assert.equal(second.extraction.version, existingVersion + 2);

const reloaded = await getJson(`/api/documents/${encodeURIComponent(kfz.id)}`);
assert.equal(reloaded.document.extraction_version, existingVersion + 2);
assert.equal(reloaded.document.latest_extraction.extraction_id, second.extraction.extraction_id);
const history = await getJson(`/api/documents/${encodeURIComponent(kfz.id)}/extractions`);
assert.ok(history.history.some((entry) => entry.id === first.extraction.extraction_id));
assert.ok(history.history.some((entry) => entry.id === second.extraction.extraction_id));
const stored = await getJson(`/api/extractions/${encodeURIComponent(second.extraction.extraction_id)}`);
assert.equal(stored.extraction.document_id, kfz.id);

const rawFixture = JSON.parse(await readFile(new URL("../data/parser-results/invoice-2026-0408.json", import.meta.url), "utf8"));
const importedId = `api-smoke-${Date.now()}`;
function updateDocumentReferences(value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key === "document_id") value[key] = importedId;
    else updateDocumentReferences(value[key]);
  }
}
updateDocumentReferences(rawFixture);
rawFixture.document_id = importedId;
rawFixture.document.name = importedId;
rawFixture.title = "API smoke · подготовленный счёт";
rawFixture.file_name = `${importedId}.json`;
const importResponse = await fetch(new URL("/api/parser-json", baseUrl), {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parser_json: rawFixture }),
});
const imported = await importResponse.json();
assert.equal(importResponse.status, 201, JSON.stringify(imported));
const importedDoc = await getJson(`/api/documents/${encodeURIComponent(importedId)}`);
assert.equal(importedDoc.document.is_demo, false);
assert.equal(importedDoc.document.parser_json.document_id, importedId);
const importedExtractionResponse = await fetch(new URL(`/api/documents/${encodeURIComponent(importedId)}/extract`, baseUrl), { method: "POST" });
const importedExtraction = await importedExtractionResponse.json();
assert.equal(importedExtractionResponse.status, 201, JSON.stringify(importedExtraction));
assert.equal(importedExtraction.extraction.document_type, "invoice");

console.log("API smoke passed: D1 seed/read, extraction versions, persisted reload, history, parser JSON import, and imported-document extraction.");
