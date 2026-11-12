import { schemaRegistry, validateExtraction } from "./schema-registry.mjs";
import { adaptDocumentParserResult, parserInputShapeErrors } from "../parser/document-parser-adapter.mjs";

const adaptedCache = new WeakMap();
function adapted(parsed) {
  if (!parsed || typeof parsed !== "object") return adaptDocumentParserResult(parsed);
  if (!adaptedCache.has(parsed)) adaptedCache.set(parsed, adaptDocumentParserResult(parsed));
  return adaptedCache.get(parsed);
}

const monthMap = {
  январь: "01", января: "01", февраль: "02", февраля: "02", март: "03", марта: "03",
  апрель: "04", апреля: "04", май: "05", мая: "05", июнь: "06", июня: "06",
  июль: "07", июля: "07", август: "08", августа: "08", сентябрь: "09", сентября: "09",
  октябрь: "10", октября: "10", ноябрь: "11", ноября: "11", декабрь: "12", декабря: "12",
};

const fieldsByType = {
  kfz_report: [
    ["report_number", "Номер отчёта", ["номер отчёта", "регистрационный номер", "номер формы"], "identifier"],
    ["report_date", "Дата составления", ["дата составления", "дата отчёта", "дата документа"], "date"],
    ["reporting_period", "Отчётный период", ["отчётный период", "отчетный период", "период"], "date_range"],
    ["reporting_organization", "Отчитывающаяся организация", ["отчитывающаяся организация", "исполнитель", "организация"], "text"],
    ["customer", "Заказчик", ["заказчик"], "text"],
    ["supplier_inn", "ИНН исполнителя", ["инн исполнителя", "инн поставщика"], "inn"],
    ["customer_inn", "ИНН заказчика", ["инн заказчика"], "inn"],
    ["contract_reference", "Договор", ["договор", "основание"], "identifier"],
    ["currency", "Валюта отчёта", ["валюта отчёта", "валюта"], "currency"],
    ["reported_total", "Общая сумма по отчёту", ["общая сумма по отчёту", "итого по отчёту", "итого"], "money"],
    ["responsible", "Ответственный", ["ответственный", "составитель"], "text"],
    ["customer_signatory", "Подписант заказчика", ["подписант заказчика", "представитель заказчика"], "text"],
  ],
  contract: [
    ["contract_number", "Номер договора", ["номер договора", "договор"], "identifier"],
    ["contract_date", "Дата договора", ["дата договора", "дата подписания"], "date"],
    ["contractor", "Подрядчик", ["подрядчик", "исполнитель"], "text"],
    ["contractor_inn", "ИНН подрядчика", ["инн подрядчика", "инн исполнителя"], "inn"],
    ["customer", "Заказчик", ["заказчик"], "text"],
    ["customer_inn", "ИНН заказчика", ["инн заказчика"], "inn"],
    ["contract_amount", "Цена договора", ["цена договора", "сумма договора"], "money"],
    ["vat_rate", "Ставка НДС", ["ставка ндс", "ндс"], "percentage"],
    ["contract_term", "Срок выполнения", ["срок выполнения", "срок действия"], "date_range"],
    ["object_address", "Адрес объекта", ["адрес объекта", "место выполнения"], "text"],
    ["payment_terms", "Условия оплаты", ["условия оплаты", "порядок оплаты"], "text"],
    ["bank_account", "Расчётный счёт подрядчика", ["расчётный счёт подрядчика", "расчетный счет", "р/с"], "bank_account"],
    ["bank_bik", "БИК банка", ["бик банка", "бик"], "bank_bik"],
  ],
  act: [
    ["act_number", "Номер акта", ["номер акта", "номер документа"], "identifier"],
    ["act_date", "Дата акта", ["дата акта", "дата"], "date"],
    ["contract_reference", "Договор", ["договор", "основание"], "identifier"],
    ["execution_period", "Период выполнения", ["период выполнения", "отчётный период", "период"], "date_range"],
    ["contractor", "Исполнитель", ["исполнитель", "подрядчик"], "text"],
    ["customer", "Заказчик", ["заказчик"], "text"],
    ["amount_due", "Итого к оплате", ["итого к оплате", "всего к оплате", "итого"], "money"],
    ["vat_amount", "НДС", ["ндс", "в том числе ндс"], "money"],
    ["contractor_representative", "Представитель исполнителя", ["представитель исполнителя", "представитель подрядчика"], "text"],
    ["customer_representative", "Представитель заказчика", ["представитель заказчика", "подписант заказчика"], "text"],
    ["customer_remarks", "Замечания заказчика", ["замечания заказчика", "замечания"], "text"],
  ],
  invoice: [
    ["invoice_number", "Номер счёта", ["номер счёта", "номер счета"], "identifier"],
    ["invoice_date", "Дата счёта", ["дата счёта", "дата счета", "дата"], "date"],
    ["supplier", "Поставщик", ["поставщик", "исполнитель"], "text"],
    ["supplier_inn", "ИНН поставщика", ["инн поставщика"], "inn"],
    ["buyer", "Покупатель", ["покупатель", "заказчик"], "text"],
    ["buyer_inn", "ИНН покупателя", ["инн покупателя", "инн заказчика"], "inn"],
    ["contract_reference", "Основание", ["основание", "договор"], "identifier"],
    ["payment_deadline", "Срок оплаты", ["срок оплаты", "оплатить до"], "date"],
    ["total_amount", "Итого с НДС", ["итого с ндс", "сумма счёта", "сумма счета"], "money"],
    ["vat_amount", "В том числе НДС", ["в том числе ндс", "ндс"], "money"],
    ["payee_bank", "Банк получателя", ["банк получателя", "банк"], "text"],
    ["correspondent_account", "Корреспондентский счёт", ["корреспондентский счёт", "корреспондентский счет"], "bank_account"],
  ],
  addendum: [
    ["addendum_number", "Номер соглашения", ["номер соглашения", "дополнительное соглашение", "номер"], "identifier"],
    ["signing_date", "Дата подписания", ["дата подписания", "дата"], "date"],
    ["base_contract", "Основной договор", ["основной договор", "договор"], "identifier"],
    ["party_1", "Сторона 1", ["сторона 1", "подрядчик", "исполнитель"], "text"],
    ["party_2", "Сторона 2", ["сторона 2", "заказчик"], "text"],
    ["previous_amount", "Цена до изменения", ["цена до изменения", "прежняя цена", "цена договора"], "money"],
    ["new_amount", "Цена после изменения", ["цена после изменения", "новая цена"], "money"],
    ["effective_date", "Дата вступления в силу", ["дата вступления в силу", "вступает в силу"], "date"],
    ["change_reason", "Причина изменения", ["причина изменения", "основание изменения"], "text"],
  ],
  registry: [
    ["registry_name", "Наименование реестра", ["наименование реестра", "реестр"], "text"],
    ["reporting_period", "Период", ["период", "отчётный период"], "date_range"],
    ["organization", "Организация", ["организация", "исполнитель"], "text"],
    ["counterparty", "Контрагент", ["контрагент", "заказчик", "покупатель"], "text"],
    ["contract_reference", "Договор", ["договор", "основание"], "identifier"],
    ["registry_total", "Итого по реестру", ["итого по реестру", "итого", "общая сумма"], "money"],
    ["registry_status", "Статус", ["статус"], "text"],
  ],
};

export const fieldDefinitions = fieldsByType;

function clean(value) {
  return String(value ?? "").replace(/\u00a0|\u202f/g, " ").trim();
}

function canonical(value) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function provenanceOf(cell, documentId) {
  let input = Array.isArray(cell?.provenance) ? cell.provenance[0] : cell?.provenance;
  if (!input && (cell?.bbox || cell?.address || cell?.cell_address)) input = {
    document_id: documentId, source_part_id: cell?.id, source_ref: cell?.source_ref,
    page_no: cell?.page_no ?? null, sheet_name: cell?.sheet_name ?? null,
    cell_address: cell?.cell_address ?? cell?.address ?? null, bbox: cell?.bbox ?? null,
    coordinate_origin: cell?.bbox?.coord_origin ?? null, table_id: cell?.table_id,
    row_id: cell?.row_id, column_index: cell?.column, source_text: cell?.text ?? cell?.value ?? "",
    confidence: cell?.confidence ?? 0.75,
  };
  if (!input) return null;
  const sourceText = String(input.source_text ?? cell?.text ?? cell?.value ?? "");
  return {
    document_id: String(input.document_id ?? documentId),
    source_part_id: input.source_part_id ?? cell?.id,
    source_ref: input.source_ref,
    page_no: input.page_no ?? null,
    sheet_name: input.sheet_name ?? null,
    cell_address: input.cell_address ?? cell?.address ?? null,
    bbox: input.bbox ?? cell?.bbox ?? null,
    coordinate_origin: input.coordinate_origin ?? input.bbox?.coord_origin ?? null,
    page_size: input.page_size ?? null,
    table_id: input.table_id ?? cell?.table_id,
    row_id: input.row_id ?? cell?.row_id,
    column_index: input.column_index ?? cell?.column,
    source_text: sourceText,
    confidence: Number(input.confidence ?? cell?.confidence ?? 0.75),
  };
}

function getSourceTables(parsed) {
  return adapted(parsed).tables;
}

function allText(parsed) {
  const source = adapted(parsed);
  const strings = source.elements.map((item) => item.text);
  for (const table of source.tables) {
    strings.push(...(table.headers ?? []));
    for (const row of table.rows ?? []) strings.push(...(row.cells ?? []).map((cell) => cell.text ?? cell.value ?? ""));
  }
  strings.push(source.title, source.file_name);
  if (typeof parsed.markdown === "string") strings.push(parsed.markdown);
  return strings.join(" \n ").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

export function classifyDocument(parsed, llmClassification = null) {
  const text = allText(parsed);
  const rules = [
    ["addendum", /дополнительн.{0,20}соглаш|(?:^|[^а-яёa-z])дс\s*[-№]?\s*\d|\baddendum\b|\bsupplementary agreement\b/i, "Дополнительное соглашение", 0.97],
    ["kfz_report", /(?:кфз|контрольно[- ]финансов.{0,20}отчет|отчет.{0,20}кфз)/i, "Отчёт КФЗ", 0.98],
    ["invoice", /счет\s+на\s+оплат|счет-фактур|номер\s+счета|\binvoice\b|\binv\s*[№#-]/i, "Счёт", 0.95],
    ["act", /акт\s+(?:сдачи|приемки|приёмки|выполненных|оказанных)|номер\s+акта|\bakt\s*(?:n|№|#|-)|\bact\s+(?:of|n|№|-)/i, "Акт", 0.95],
    ["contract", /договор\s+(?:подряда|оказания|поставки|обслуживания)|номер\s+договора|\bcontract\s*(?:n|№|#|-)/i, "Договор", 0.94],
    ["registry", /реестр\s+(?:выполненных|работ|поставок|операций)|наименование\s+реестра|\bregister\s+of\b/i, "Реестр", 0.92],
  ];
  for (const [type, pattern, label, confidence] of rules) {
    if (pattern.test(text)) return { type, label, confidence, status: confidence >= 0.9 ? "classified" : "review" };
  }
  if (llmClassification?.document_type && schemaRegistry[llmClassification.document_type]) {
    const confidence = Math.max(0, Math.min(1, Number(llmClassification.confidence ?? 0.65)));
    return { type: llmClassification.document_type, label: schemaRegistry[llmClassification.document_type].label, confidence, status: confidence < 0.8 ? "review" : "classified", method: "llm" };
  }
  return { type: "unknown", label: "Тип не определён", confidence: 0.42, status: "review" };
}

function parseDecimalString(raw) {
  let value = clean(raw).replace(/[\s'’]/g, "");
  if (!value || /\?|\/|\bили\b/i.test(value)) return null;
  value = value.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(value)) return null;
  const sign = value.startsWith("-") ? "-" : "";
  value = value.replace(/-/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if ((comma >= 0 && dot < 0 && value.indexOf(",") === comma && value.length - comma - 1 === 3)
    || (dot >= 0 && comma < 0 && value.indexOf(".") === dot && value.length - dot - 1 === 3)) return null;
  let decimalAt = Math.max(comma, dot);
  if (comma >= 0 && dot >= 0) decimalAt = Math.max(comma, dot);
  const hasDecimal = decimalAt >= 0 && value.length - decimalAt - 1 > 0 && value.length - decimalAt - 1 <= 6;
  let integerPart = hasDecimal ? value.slice(0, decimalAt) : value;
  let fraction = hasDecimal ? value.slice(decimalAt + 1) : "";
  integerPart = integerPart.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "") || "0";
  fraction = fraction.replace(/[.,]/g, "");
  return `${sign}${integerPart}${fraction ? `.${fraction}` : ""}`;
}

function firstNumericToken(raw) {
  const value = clean(raw);
  const match = value.match(/[+-]?\d[\d\s\u00a0\u202f.,?]*(?:\d|\?)/);
  return match?.[0]?.trim() ?? "";
}

function dateResult(raw) {
  const value = clean(raw);
  if (!value) return { value: null, status: "missing", note: null };
  const validDate = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
  };
  const outputDate = (year, month, day) => {
    if (!validDate(year, month, day)) return { value: null, status: "review", note: "Дата выходит за допустимые границы календаря" };
    return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, status: "extracted", note: null };
  };
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return outputDate(iso[1], iso[2], iso[3]);
  const words = value.toLocaleLowerCase("ru-RU").match(/\b(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\b/);
  if (words && monthMap[words[2]]) return outputDate(words[3], monthMap[words[2]], words[1]);
  const numeric = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (!numeric) return { value: null, status: "review", note: "Дата не распознана однозначно" };
  const [, first, second, rawYear] = numeric;
  let year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  let day = Number(first);
  let month = Number(second);
  if (value.includes("/") && day <= 12 && month <= 12) return { value: null, status: "review", note: "Порядок дня и месяца неоднозначен" };
  if (day > 12 && month <= 12) { day = Number(first); month = Number(second); }
  else if (month > 12 && day <= 12) { day = Number(second); month = Number(first); }
  return outputDate(year, month, day);
}

function normalize(raw, kind) {
  const value = clean(raw);
  if (!value) return { value: null, status: "missing", note: null };
  if (kind === "date") return dateResult(value);
  if (kind === "date_range") {
    const parts = value.split(/\s*(?:—|–|\bпо\b|\bдо\b)\s*/i).filter(Boolean);
    if (parts.length < 2) return { value: null, status: "review", note: "Период указан без однозначных границ" };
    const start = dateResult(parts[0]);
    const end = dateResult(parts[1]);
    if (start.status !== "extracted" || end.status !== "extracted") return { value: null, status: "review", note: "Одна или обе границы периода требуют проверки" };
    return { value: { start: start.value, end: end.value }, status: "extracted", note: null };
  }
  if (kind === "money") {
    if (value.includes("?") || /\d\s*\/\s*\d/.test(value)) return { value: null, status: "review", note: "Сумма распознана неоднозначно" };
    const numeric = firstNumericToken(value);
    const decimal = parseDecimalString(numeric);
    if (decimal === null) return { value: null, status: "review", note: "Не удалось безопасно нормализовать сумму" };
    return { value: { amount: decimal, currency: "RUB" }, status: "extracted", note: null };
  }
  if (kind === "percentage") {
    const decimal = parseDecimalString(firstNumericToken(value));
    return decimal === null ? { value: null, status: "review", note: "Процент требует проверки" } : { value: decimal, status: "extracted", note: null };
  }
  if (kind === "quantity") {
    const decimal = parseDecimalString(value);
    return decimal === null ? { value: null, status: "review", note: "Количество распознано неоднозначно" } : { value: decimal, status: "extracted", note: null };
  }
  if (kind === "unit") {
    const key = value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s/g, "");
    const map = { "шт.": "piece", шт: "piece", штука: "piece", штуки: "piece", "компл.": "set", компл: "set", комплект: "set", "чел.-ч": "person_hour", "чел-ч": "person_hour", "м³": "cubic_meter", "м3": "cubic_meter", м: "meter", кг: "kilogram", т: "tonne", тонна: "tonne", объект: "object", точка: "point", смена: "shift", рейс: "trip", линия: "line" };
    return { value: map[key] ?? value, status: "extracted", note: map[key] ? null : "Единица сохранена без преобразования" };
  }
  if (kind === "inn" || kind === "bank_bik" || kind === "bank_account") {
    const digits = value.replace(/\D/g, "");
    return digits ? { value: digits, status: "extracted", note: null } : { value: null, status: "review", note: "Ожидались цифровые реквизиты" };
  }
  if (kind === "identifier") return { value: value.toLocaleUpperCase("ru-RU").replace(/\s+/g, " "), status: "extracted", note: null };
  if (kind === "currency") {
    const key = value.toLocaleLowerCase("ru-RU");
    if (/руб|российск|₽/.test(key)) return { value: "RUB", status: "extracted", note: null };
    if (/евро|eur|€/.test(key)) return { value: "EUR", status: "extracted", note: null };
    if (/доллар|usd|\$/.test(key)) return { value: "USD", status: "extracted", note: null };
    return { value: value, status: "review", note: "Код валюты не определён однозначно" };
  }
  return { value, status: "extracted", note: null };
}

function valueObject(parsed, cell, sourceValue, kind, fallbackReason = null) {
  const provenance = provenanceOf(cell, parsed.document_id);
  if (!cell) return { value: null, source_value: null, status: "missing", confidence: null, provenance: null, normalization_note: fallbackReason };
  if (!clean(sourceValue)) return { value: null, source_value: null, status: "missing", confidence: provenance?.confidence ?? null, provenance, normalization_note: fallbackReason };
  if (cell?.calculation_status === "missing_cached_result" || (cell?.formula && cell?.value == null && cell?.cached_value == null)) {
    return { value: null, source_value: String(sourceValue), status: "review", confidence: provenance?.confidence ?? 0.9, provenance, normalization_note: "У формулы отсутствует сохранённый результат; значение не вычислялось" };
  }
  const normalized = normalize(sourceValue, kind);
  const confidence = provenance?.confidence ?? Number(cell.confidence ?? 0.75);
  const lowConfidence = confidence < 0.8;
  const status = normalized.status === "missing" ? "missing" : normalized.status === "review" || lowConfidence ? "review" : "extracted";
  return {
    value: normalized.value,
    source_value: String(sourceValue),
    status,
    confidence,
    provenance,
    normalization_note: normalized.note ?? (lowConfidence ? "Низкая уверенность источника" : null),
  };
}

function metadataRows(tables) {
  return tables.filter((table) => table.role === "metadata" || canonical(table.caption).includes("реквизиты документа"));
}

function lookupMetadata(tables, aliases) {
  const aliasSet = aliases.map(canonical);
  for (const table of metadataRows(tables)) {
    for (const row of table.rows ?? []) {
      const cells = [...(row.cells ?? [])].sort((a, b) => (a.column ?? 0) - (b.column ?? 0));
      if (cells.length < 2) continue;
      const label = canonical(cells[0].text ?? cells[0].value);
      if (aliasSet.some((alias) => label === alias || label.includes(alias))) {
        return { cell: cells[1], text: cells[1].text ?? cells[1].value ?? "" };
      }
    }
  }
  return null;
}

function lookupFreeText(parsed, aliases) {
  const aliasSet = aliases.map(canonical);
  for (const element of adapted(parsed).elements) {
    const text = clean(element.text);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const delimiter = line.search(/[:：=]/);
      if (delimiter < 1) continue;
      const label = canonical(line.slice(0, delimiter));
      if (!aliasSet.some((alias) => label === alias || label.includes(alias) || alias.includes(label))) continue;
      const value = clean(line.slice(delimiter + 1));
      return { cell: { id: element.id, text: value, provenance: { ...element.provenance, source_text: text }, confidence: element.provenance?.confidence ?? 0.82 }, text: value };
    }
  }
  return null;
}

function groundedFieldCandidate(parsed, fieldKey, llm) {
  const candidate = llm?.field_candidates?.find((item) => item.field_key === fieldKey);
  if (!candidate) return null;
  const element = adapted(parsed).elements.find((item) => item.id === candidate.source_element_id);
  const sourceValue = String(candidate.source_value ?? "");
  if (!element || !sourceValue || !String(element.text ?? "").includes(sourceValue)) return null;
  const confidence = Math.min(Number(candidate.confidence ?? 0.75), Number(element.provenance?.confidence ?? 0.75));
  const provenance = { ...element.provenance, source_text: element.text, confidence };
  return { cell: { id: element.id, text: sourceValue, provenance, confidence: provenance.confidence }, text: sourceValue };
}

function fieldValue(parsed, tables, [key, label, aliases, kind], llm) {
  const found = lookupMetadata(tables, aliases) ?? lookupFreeText(parsed, aliases) ?? groundedFieldCandidate(parsed, key, llm);
  return { key, label, extracted: found ? valueObject(parsed, found.cell, found.text, kind) : valueObject(parsed, null, null, kind) };
}

function findHeader(headers, pattern, excluded = null) {
  const normalized = headers.map((header) => canonical(header));
  return normalized.findIndex((header) => pattern.test(header) && !(excluded && excluded.test(header)));
}

function lineItems(parsed, table, options = {}) {
  const headers = table.headers ?? [];
  const mapping = options.llm?.table_mappings?.find((item) => item.table_id === table.id);
  const mapped = new Map();
  for (const column of mapping?.columns ?? []) {
    const index = (table.header_cells ?? []).findIndex((cell) => cell.id === column.source_element_id || cell.source_element_ids?.includes(column.source_element_id));
    if (index >= 0 && Number(column.confidence ?? 0) >= 0.65) mapped.set(column.semantic_key, index);
  }
  const mappedIndex = (key, fallback) => mapped.has(key) ? mapped.get(key) : fallback;
  const idIndex = mappedIndex("identifier", findHeader(headers, /идентификатор|код|артикул|номер\s*позиции/));
  const lineIndex = mappedIndex("line_number", headers.findIndex((header) => /^\s*№\s*$/.test(header) || /^(номер|этап|строка)$/.test(canonical(header))));
  const descriptionIndex = mappedIndex("description", findHeader(headers, /наимен|описан|содержание|показател|работ/));
  const unitIndex = mappedIndex("unit", findHeader(headers, /единиц|^ед изм$|^ед$/));
  const plannedIndex = mappedIndex("planned_quantity", findHeader(headers, /план|запланир/));
  const actualIndex = mappedIndex("actual_quantity", findHeader(headers, /факт|выполнен|колич|кол\s*во|^объем$/));
  const quantityIndex = mappedIndex("quantity", actualIndex >= 0 ? actualIndex : findHeader(headers, /колич|кол\s*во|объем/));
  const unitPriceIndex = mappedIndex("unit_price", findHeader(headers, /цена|тариф|стоимость\s*(?:за|ед)/, /сумм|итого/));
  const amountIndex = mappedIndex("amount", findHeader(headers, /сумм|стоимость|итого|к\s*оплате/));
  const selectCell = (row, index) => index < 0 ? null : row.cells?.find((cell) => cell.column === index) ?? row.cells?.[index] ?? null;

  return (table.rows ?? []).filter((row) => (row.cells ?? []).some((cell) => clean(cell.text ?? cell.value))).map((row, rowIndex) => {
    const cellValue = (index, kind) => {
      const cell = selectCell(row, index);
      return valueObject(parsed, cell, cell?.text ?? cell?.value ?? null, kind);
    };
    const sourceCells = (row.cells ?? []).sort((a, b) => (a.column ?? 0) - (b.column ?? 0)).map((cell) => ({
      header: String(headers[cell.column] ?? cell.column_name ?? `Колонка ${Number(cell.column ?? 0) + 1}`),
      extracted: valueObject(parsed, cell, cell.text ?? cell.value ?? null, inferHeaderKind(headers[cell.column] ?? "")),
    }));
    const canonicalId = idIndex >= 0 ? cellValue(idIndex, "identifier") : lineIndex >= 0 ? cellValue(lineIndex, "identifier") : valueObject(parsed, null, null, "identifier");
    const rowStatus = sourceCells.some((entry) => entry.extracted.status === "review") ? "review" : sourceCells.every((entry) => entry.extracted.status === "missing") ? "missing" : "extracted";
    return {
      row_id: row.row_id ?? `${table.id}-r${String(rowIndex + 1).padStart(3, "0")}`,
      line_number: lineIndex >= 0 ? cellValue(lineIndex, "quantity") : valueObject(parsed, null, null, "quantity"),
      identifier: canonicalId,
      description: cellValue(descriptionIndex, "text"),
      unit: cellValue(unitIndex, "unit"),
      quantity: cellValue(quantityIndex, "quantity"),
      plan_quantity: plannedIndex >= 0 ? cellValue(plannedIndex, "quantity") : valueObject(parsed, null, null, "quantity"),
      actual_quantity: actualIndex >= 0 ? cellValue(actualIndex, "quantity") : valueObject(parsed, null, null, "quantity"),
      unit_price: cellValue(unitPriceIndex, "money"),
      amount: cellValue(amountIndex, "money"),
      source_cells: sourceCells,
      row_status: rowStatus,
    };
  });
}

function inferHeaderKind(header) {
  const key = canonical(header);
  if (/единиц|^ед изм$|^ед$/.test(key)) return "unit";
  if (/колич|кол\s*во|план|факт|объем/.test(key)) return "quantity";
  if (/цена|сумм|стоимость|итого|к оплате/.test(key)) return "money";
  if (/дата|срок/.test(key)) return "date";
  if (/код|идентификатор|артикул|договор|номер/.test(key)) return "identifier";
  return "text";
}

function extractedTables(parsed, tables, type, llm) {
  return tables.filter((table) => table.role !== "metadata").map((table) => ({
    id: table.id,
    title: table.caption ?? table.id,
    role: type === "kfz_report" && table.rows?.length ? "line_items" : table.role ?? "table",
    headers: table.headers ?? [],
    rows: lineItems(parsed, table, { llm }),
  }));
}

function collectReviewAndMissing(fields, tables) {
  const missing = [];
  const review = [];
  for (const [key, field] of Object.entries(fields)) {
    if (field.status === "missing") missing.push(key);
    if (field.status === "review") review.push({ path: `fields.${key}`, reason: field.normalization_note ?? "Нужна проверка источника", source_value: field.source_value, provenance: field.provenance });
  }
  for (const table of tables) for (const [rowIndex, row] of table.rows.entries()) {
    for (const [cellIndex, cell] of row.source_cells.entries()) {
      if (cell.extracted.status === "review") review.push({ path: `tables.${table.id}.rows.${rowIndex}.cells.${cellIndex}`, reason: cell.extracted.normalization_note ?? "Нужна проверка источника", source_value: cell.extracted.source_value, provenance: cell.extracted.provenance });
    }
  }
  return { missing, review };
}

function indicators(fields, tables) {
  const preferred = ["reported_total", "contract_amount", "amount_due", "total_amount", "new_amount", "registry_total", "vat_amount", "reporting_period"];
  const rows = [];
  for (const key of preferred) if (fields[key] && fields[key].status !== "missing") rows.push({ key, label: fields[key].label ?? key, extracted: fields[key] });
  const itemRows = tables.find((table) => table.role === "line_items")?.rows ?? [];
  rows.push({ key: "extracted_line_count", label: "Извлечено строк", extracted: { value: String(itemRows.length), source_value: String(itemRows.length), status: "extracted", confidence: 1, provenance: null, normalization_note: "Количество строк структурированной таблицы" } });
  return rows;
}

function outputKey(type) {
  return type === "contract" ? "payment_schedule" : type === "addendum" ? "changes" : "line_items";
}

export function extractStructuredDocument(parsed, options = {}) {
  if (!parsed || typeof parsed !== "object") throw new Error("Parser result must be a JSON object");
  const source = adapted(parsed);
  const documentId = source.document_id;
  const llm = options.llm ?? null;
  const modelClassification = llm?.document_type ? { document_type: llm.document_type, confidence: llm.classification_confidence } : null;
  const typeResult = classifyDocument(parsed, modelClassification);
  const registration = schemaRegistry[typeResult.type];
  if (!registration) throw new Error("Document type is not supported by the extraction schemas");
  const tables = source.tables;
  const fields = Object.fromEntries(fieldsByType[typeResult.type].map((definition) => {
    const extracted = fieldValue(parsed, tables, definition, llm);
    extracted.extracted.label = definition[1];
    return [extracted.key, extracted.extracted];
  }));
  const parsedTables = extractedTables(parsed, tables, typeResult.type, llm);
  const targetTables = parsedTables.filter((table) => ["line_items", "payment_schedule", "amendments"].includes(table.role));
  const rows = targetTables.flatMap((table) => table.rows);
  const { missing, review } = collectReviewAndMissing(fields, parsedTables);
  const result = {
    extraction_id: options.extractionId ?? globalThis.crypto.randomUUID(),
    document_id: documentId,
    version: options.version ?? 1,
    schema_version: registration.version,
    extracted_at: options.extractedAt ?? new Date().toISOString(),
    document_type: typeResult.type,
    classification: typeResult,
    extraction_engine: {
      rules_executed: true,
      llm: {
        provider: llm?.provider ?? "not_called",
        model: llm?.model ?? null,
        called: Boolean(llm?.called),
        response_validated: Boolean(llm?.response_validated),
      },
      parser_adapter: source.adapter_version,
    },
    fields,
    tables: parsedTables,
    indicators: indicators(fields, parsedTables),
    missing_fields: missing,
    review_required: review,
    [outputKey(typeResult.type)]: rows,
  };
  return validateExtraction(typeResult.type, result);
}

export function parserJsonShapeErrors(value) {
  return parserInputShapeErrors(value);
}

export function normalizeDate(raw) { return dateResult(raw); }
export function normalizeMoney(raw) { return normalize(raw, "money"); }
export function normalizeUnit(raw) { return normalize(raw, "unit"); }

