import test from "node:test";
import assert from "node:assert/strict";
import { adaptDocumentParserResult } from "../lib/parser/document-parser-adapter.mjs";
import { classifyDocument, extractStructuredDocument } from "../lib/extraction/structured-extraction.mjs";

test("Document Parser mirrored table views do not duplicate physical rows or equal rows at distinct locations", () => {
  const parsed = {
    document_id: "mirrored-table-regression",
    parts: [{ kind: "table", id: "parts-copy" }],
    model_parts: [{ kind: "table", ref: "#/tables/0" }],
    visual_layout: { parts: [{ kind: "table", id: "visual-copy" }] },
    logical_tables: [{
      id: "canonical-table",
      caption: "Показатели",
      headers: [["Показатель", "Количество"], ["Наименование", "Факт"]],
      rows: [
        { page_no: 1, source_row_index: 2, values: ["Работа A", "10"], provenance: [{ source_ref: "#/logical_tables/0/rows/0", page_no: 1 }] },
        { page_no: 1, source_row_index: 3, values: ["Работа A", "10"], provenance: [{ source_ref: "#/logical_tables/0/rows/1", page_no: 1 }] },
      ],
      fragments: [{ page_no: 1, rows: [
        { page_no: 1, source_row_index: 2, values: ["Работа A", "10"] },
        { page_no: 1, source_row_index: 3, values: ["Работа A", "10"] },
      ] }],
    }],
  };
  const table = adaptDocumentParserResult(parsed).tables[0];
  assert.equal(table.rows.length, 2, "canonical rows and fragment copies collapse by source locator");
  assert.equal(table.rows[0].cells[0].text, table.rows[1].cells[0].text, "equal source text at distinct physical rows is retained");
  assert.notEqual(table.rows[0].row_id, table.rows[1].row_id);
  assert.deepEqual(table.headers, ["Показатель · Наименование", "Количество · Факт"]);
});

test("KFS-like target row keeps all 15 checked numeric cells and marks incomplete rows honestly", () => {
  const headers = ["Этап", ...Array.from({ length: 15 }, (_, index) => `Финансовый показатель ${index + 1}, руб.`)];
  const values = ["3 этап", ...Array.from({ length: 15 }, (_, index) => String((index + 1) * 100))];
  const parsed = {
    document_id: "kfz-15-cell-regression",
    parts: [{ kind: "paragraph", text: "Карточка учета фактических затрат. Трудоемкость по этапам" }],
    logical_tables: [{ id: "kfz-target", caption: "Показатели этапа", role: "line_items", headers, rows: [
      { page_no: 1, source_row_index: 1, values, provenance: [{ page_no: 1, source_ref: "#/logical_tables/0/rows/0" }] },
      { page_no: 1, source_row_index: 2, values: ["4 этап", "200", ...Array(14).fill("")] },
      { page_no: 1, source_row_index: 3, values: Array(16).fill("") },
    ] }],
  };
  assert.equal(classifyDocument({ ...parsed, file_name: "renamed.bin" }).type, "kfz_report");
  const result = extractStructuredDocument(parsed, { mode: "rules_only" });
  const table = result.tables.find((item) => item.id === "kfz-target");
  assert.equal(table.role, "line_items");
  assert.equal(table.rows[0].source_cells.length, 16);
  const checked = table.rows[0].source_cells.slice(1);
  assert.equal(checked.length, 15);
  assert.deepEqual(checked.map((cell) => cell.extracted.source_value), values.slice(1));
  assert.ok(checked.every((cell) => cell.extracted.provenance?.source_ref && cell.extracted.provenance.source_text === cell.extracted.source_value));
  assert.equal(table.rows[0].row_status, "extracted");
  assert.equal(table.rows[1].row_status, "review");
  assert.equal(table.empty_rows[0].row_status, "missing");
  assert.ok(result.missing_fields.includes(`tables.kfz-target.rows.${table.empty_rows[0].row_id}`));
  assert.ok(result.review_required.some((item) => item.path === `tables.kfz-target.rows.${table.empty_rows[0].row_id}`));
});

test("authentic logical-table fragment shape merges headers, removes mirrored rows and grounds all target values", () => {
  const width = 17;
  const grid = [
    ["Этап", "Месяц", "Трудоемкость", "Материальные затраты", "Затраты на оплату труда", "", "", "", "", "Страховые взносы", "", "", "", "", "Общехозяйственные затраты", "Итого"],
    ["", "", "", "", "Фонд оплаты труда", "", "Прочие начисления", "", "", "Пенсионное страхование", "", "Медицинское страхование", "", "", "", "", ""],
    ["", "", "", "", "План", "Факт", "План", "Факт", "План", "Факт", "План", "Факт", "План", "Факт", "План", "Факт", ""],
    ["", "", "", "", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб.", "руб."],
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "", "16", "17"],
    ["1 этап", "2026 г.", "10,00", "20,00", "100,00", "101,00", "110,00", "111,00", "120,00", "121,00", "130,00", "131,00", "140,00", "141,00", "150,00", "151,00", "1 500,00"],
    ["2 этап", "2026 г.", "11,00", "21,00", "200,00", "201,00", "210,00", "211,00", "220,00", "221,00", "230,00", "231,00", "240,00", "241,00", "250,00", "251,00", "2 500,00"],
    ["3 этап", "2026 г.", "12,00", "22,00", "300,00", "301,00", "310,00", "311,00", "320,00", "321,00", "330,00", "331,00", "340,00", "341,00", "350,00", "351,00", "3 500,00"],
    ["Итого", "", "33,00", "63,00", "600,00", "603,00", "630,00", "633,00", "660,00", "663,00", "690,00", "693,00", "720,00", "723,00", "750,00", "753,00", "7 500,00"],
  ];
  const rows = grid.map((values, row) => {
    const cells = values.map((text, column) => ({ row, column, text, ...(row === 0 && column === 4 ? { col_span: 5 } : {}), ...(row === 0 && column === 0 ? { row_span: 4 } : {}) }));
    return { values, fragments: [{ page_no: 1, row, cells }] };
  });
  const parsed = {
    document_id: "kfz-authentic-shape",
    markdown: "Карточка учета фактических затрат по этапам",
    parts: [{ kind: "table", id: "parts-view" }],
    model_parts: [{ kind: "table", ref: "#/tables/0" }],
    visual_layout: { parts: [{ kind: "table", id: "visual-view" }] },
    logical_tables: [{ rows, fragments: [{ page_no: 1, rows: grid, cells: rows.flatMap((row) => row.fragments[0].cells) }] }],
  };
  const view = adaptDocumentParserResult(parsed);
  assert.equal(view.tables.length, 1);
  assert.equal(view.tables[0].rows.length, 4);
  assert.equal(view.tables[0].headers.length, width);
  assert.match(view.tables[0].headers[4], /Затраты на оплату труда/);
  assert.equal(view.tables[0].role, "line_items");
  const result = extractStructuredDocument(parsed, { mode: "rules_only" });
  const target = result.line_items.find((row) => row.source_cells[0]?.extracted.source_value === "3 этап");
  assert.ok(target);
  const numericSourceCells = target.source_cells.slice(2, 17);
  assert.equal(numericSourceCells.length, 15);
  assert.ok(numericSourceCells.every((cell) => cell.extracted.source_value && cell.extracted.provenance?.source_ref && cell.extracted.provenance.source_text === cell.extracted.source_value));
  assert.equal(result.line_items.at(-1).row_status, "review", "a total row with a missing cell needs review instead of being accepted as complete");
});

test("supported document classes use body signals when filenames are removed", () => {
  const cases = [
    ["kfz_report", "Карточка учета фактических затрат. Трудоемкость, этап, план, факт"],
    ["invoice", "Счет на оплату № 47. Итого к оплате"],
    ["invoice_act", "Счёт-акт № 174. Итого к оплате"],
    ["upd", "Универсальный передаточный документ УПД"],
    ["payroll_register", "Ведомость начисления заработной платы. Сотрудник, начислено"],
    ["contribution_register", "Ведомость страховых взносов. База начисления"],
    ["service_memo", "Служебная записка. Кому, от кого, тема"],
    ["certificate", "Справка о подтверждении сведений"],
  ];
  for (const [type, text] of cases) {
    const parsed = { document_id: `renamed-${type}`, file_name: "random-name.dat", parts: [{ kind: "paragraph", text }] };
    assert.equal(classifyDocument(parsed).type, type, type);
  }
  const unknown = { document_id: "unknown", file_name: "invoice.pdf", parts: [{ kind: "paragraph", text: "Общие условия, без признаков типа" }] };
  assert.equal(classifyDocument(unknown).type, "unknown", "filename is not a classification signal");
});
