import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { demoBlueprints } from "../data/demo-blueprints.mjs";
import { classifyDocument, compareExtractionResults, extractStructuredDocument, normalizeDate, normalizeMoney, normalizeUnit, parserJsonShapeErrors } from "../lib/extraction/structured-extraction.mjs";

async function parserResult(id) {
  return JSON.parse(await readFile(new URL(`../data/parser-results/${id}.json`, import.meta.url), "utf8"));
}

test("all six parser fixtures are classified from their parsed content", async () => {
  const expected = { "kfz-2026-q1": "kfz_report", "contract-2026-0315": "contract", "act-2026-0424": "act", "invoice-2026-0408": "invoice", "addendum-2026-04": "addendum", "registry-2026-04": "registry" };
  for (const [id, type] of Object.entries(expected)) {
    const parsed = await parserResult(id);
    assert.equal(classifyDocument(parsed).type, type, id);
    assert.equal(extractStructuredDocument(parsed, { extractionId: `test-${id}` }).document_type, type, id);
  }
  assert.equal(demoBlueprints.length, 6);
});

test("date, currency and unit normalization keeps exact decimal strings", () => {
  assert.deepEqual(normalizeDate("31 марта 2026 г."), { value: "2026-03-31", status: "extracted", note: null });
  assert.deepEqual(normalizeDate("04/05/2026"), { value: null, status: "review", note: "Порядок дня и месяца неоднозначен" });
  assert.deepEqual(normalizeMoney("5 742 183,40 руб."), { value: { amount: "5742183.40", currency: "RUB" }, status: "extracted", note: null });
  assert.equal(normalizeMoney("1,234 руб.").status, "review");
  assert.equal(normalizeMoney("56 4?0,00 руб.").status, "review");
  assert.equal(normalizeUnit("чел.-ч").value, "person_hour");
  assert.equal(normalizeUnit("м³").value, "cubic_meter");
  assert.equal(normalizeDate("31.02.2026").status, "review");
  assert.equal(normalizeMoney("1234,56").status, "review");
  assert.equal(normalizeMoney("1234,56").value.currency, null);
  assert.equal(normalizeMoney("1234,56", "Сумма, руб.").value.currency, "RUB");
  assert.equal(normalizeUnit("неизвестная единица").status, "review");
});

test("grounded rules and LLM candidates reconcile to review when evidence conflicts", async () => {
  const parsed = await parserResult("kfz-2026-q1");
  parsed.parts.push({ kind: "paragraph", id: "alternate-report-number", text: "КФЗ-02/2026" });
  const source = (await import("../lib/parser/document-parser-adapter.mjs")).adaptDocumentParserResult(parsed);
  const alternate = source.elements.find((element) => element.text === "КФЗ-02/2026");
  const llm = {
    document_type: "kfz_report",
    field_candidates: [{ field_key: "report_number", source_element_id: alternate.id, source_value: "КФЗ-02/2026", confidence: 1 }],
    table_mappings: [],
  };
  const rules = extractStructuredDocument(parsed, { extractionId: "rules", mode: "rules_only" });
  const hybrid = extractStructuredDocument(parsed, { extractionId: "hybrid", mode: "llm_assisted", llm });
  assert.equal(hybrid.fields.report_number.status, "review");
  assert.equal(hybrid.fields.report_number.value, null);
  assert.equal(hybrid.fields.report_number.conflict.rules.source_value, "КФЗ-01/2026");
  assert.equal(hybrid.fields.report_number.conflict.llm.source_value, "КФЗ-02/2026");
  assert.ok(hybrid.fields.report_number.conflict.rules.provenance);
  assert.ok(hybrid.fields.report_number.conflict.llm.provenance);
  const comparison = compareExtractionResults(rules, hybrid);
  assert.ok(comparison.discrepancies.some((item) => item.path === "fields.report_number"));
});

test("LLM cannot turn a key-value metadata table into checked line items", async () => {
  const parsed = await parserResult("kfz-2026-q1");
  const source = (await import("../lib/parser/document-parser-adapter.mjs")).adaptDocumentParserResult(parsed);
  const table = source.tables.find((item) => item.id === "document-metadata");
  const mapping = {
    table_id: table.id,
    role: "line_items",
    columns: table.header_cells.map((cell, index) => ({ source_element_id: cell.id, semantic_key: index === 0 ? "identifier" : "amount", label: table.headers[index], confidence: 1 })),
  };
  const result = extractStructuredDocument(parsed, { mode: "llm_assisted", llm: { document_type: "kfz_report", field_candidates: [], table_mappings: [mapping] } });
  const metadata = result.tables.find((item) => item.id === table.id);
  assert.equal(metadata.role, "metadata");
  assert.equal(metadata.role_source, "rules_or_parser");
  assert.equal(result.line_items.length, 18);
});

test("every KFS source row and all quantitative indicators are retained with provenance", async () => {
  const parsed = await parserResult("kfz-2026-q1");
  const result = extractStructuredDocument(parsed, { extractionId: "test-kfz", extractedAt: "2026-11-12T00:00:00.000Z" });
  assert.equal(result.line_items.length, 18);
  assert.equal(result.tables.find((table) => table.id === "kfz-items").rows.length, 18);
  for (const row of result.line_items) {
    assert.ok(row.identifier.source_value, `Missing identifier for ${row.row_id}`);
    assert.ok(row.description.source_value, `Missing description for ${row.row_id}`);
    assert.ok(row.identifier.provenance?.document_id === parsed.document_id);
    assert.ok([2, 3].includes(row.identifier.provenance.page_no));
    assert.ok(row.identifier.provenance.bbox.r > row.identifier.provenance.bbox.l);
    assert.ok(row.source_cells.length === 9, `Not all source columns retained for ${row.row_id}`);
  }
  assert.equal(result.line_items[13].actual_quantity.value, null);
  assert.equal(result.line_items[13].actual_quantity.status, "missing");
  assert.equal(result.line_items[17].amount.value, null);
  assert.equal(result.line_items[17].amount.status, "review");
  assert.equal(result.fields.reported_total.source_value, "5 742 183,40 руб.");
  assert.equal(result.fields.reported_total.value.amount, "5742183.40");
  assert.equal(result.fields.customer_inn.value, "7728406195");
  assert.equal(result.fields.customer_signatory.value, null);
  assert.equal(result.fields.customer_signatory.status, "missing");
});

test("XLSX provenance uses stable sheet names and cell addresses", async () => {
  const parsed = await parserResult("registry-2026-04");
  const result = extractStructuredDocument(parsed, { extractionId: "test-registry" });
  const first = result.line_items[0];
  assert.equal(result.line_items.length, 14);
  assert.equal(first.identifier.provenance.sheet_name, "Реестр");
  assert.equal(first.identifier.provenance.cell_address, "B7");
  assert.equal(first.identifier.source_value, "Р-110");
  assert.equal(first.amount.value.amount, "286500.00");
  assert.equal(result.line_items[13].amount.status, "review");
});

test("empty fields remain null and ambiguous dates are flagged", async () => {
  const parsed = await parserResult("addendum-2026-04");
  const result = extractStructuredDocument(parsed, { extractionId: "test-addendum" });
  assert.equal(result.fields.signing_date.value, null);
  assert.equal(result.fields.signing_date.source_value, "04/05/2026");
  assert.equal(result.fields.signing_date.status, "review");
  assert.equal(result.fields.effective_date.value, null);
  assert.equal(result.fields.effective_date.status, "missing");
  assert.ok(result.review_required.some((item) => item.path === "fields.signing_date"));
  assert.ok(result.missing_fields.includes("effective_date"));
});

test("parser JSON importer shape checks distinguish parsed JSON from source files", async () => {
  const parsed = await parserResult("invoice-2026-0408");
  assert.deepEqual(parserJsonShapeErrors(parsed), []);
  assert.ok(parserJsonShapeErrors({ filename: "scan.pdf", bytes: "..." }).length > 0);
});
