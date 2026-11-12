import { z } from "zod";
import { adaptDocumentParserResult } from "../parser/document-parser-adapter.mjs";
import { classifyDocument, fieldDefinitions } from "./structured-extraction.mjs";

export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const semanticKeys = ["line_number", "identifier", "description", "unit", "planned_quantity", "actual_quantity", "quantity", "unit_price", "amount", "parameter", "old_value", "new_value", "reason", "unknown"];
const tableRoles = ["metadata", "line_items", "payment_schedule", "amendments", "reference", "summary", "appendix", "table"];
const groundedResponseSchema = z.object({
  document_type: z.enum(["kfz_report", "contract", "act", "invoice", "addendum", "registry", "unknown"]),
  classification_confidence: z.number().min(0).max(1),
  field_candidates: z.array(z.object({
    field_key: z.string().min(1),
    source_element_id: z.string().min(1),
    source_value: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }).strict()),
  table_mappings: z.array(z.object({
    table_id: z.string().min(1),
    role: z.enum(tableRoles),
    confidence: z.number().min(0).max(1),
    columns: z.array(z.object({
      source_element_id: z.string().min(1),
      semantic_key: z.enum(semanticKeys),
      label: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }).strict()),
  }).strict()),
}).strict();

export const workersAiJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document_type", "classification_confidence", "field_candidates", "table_mappings"],
  properties: {
    document_type: { type: "string", enum: ["kfz_report", "contract", "act", "invoice", "addendum", "registry", "unknown"] },
    classification_confidence: { type: "number", minimum: 0, maximum: 1 },
    field_candidates: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["field_key", "source_element_id", "source_value", "confidence"], properties: {
        field_key: { type: "string" }, source_element_id: { type: "string" }, source_value: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
      } },
    },
    table_mappings: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["table_id", "role", "confidence", "columns"], properties: {
        table_id: { type: "string" }, role: { type: "string", enum: tableRoles }, confidence: { type: "number", minimum: 0, maximum: 1 },
        columns: { type: "array", items: { type: "object", additionalProperties: false, required: ["source_element_id", "semantic_key", "label", "confidence"], properties: {
          source_element_id: { type: "string" }, semantic_key: { type: "string", enum: semanticKeys }, label: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        } } },
      } },
    },
  },
};

export class WorkersAiError extends Error {
  constructor(message, code = "WORKERS_AI_ERROR", status = 502, details = {}) {
    super(message);
    this.name = "WorkersAiError";
    this.code = code;
    this.status = status;
    this.details = {
      provider: details.provider ?? null,
      model: details.model ?? WORKERS_AI_MODEL,
      duration_ms: details.duration_ms ?? null,
      validation_status: details.validation_status ?? "not_run",
      reason: details.reason ?? message,
      ...details,
    };
  }
}

export function workersAiReadiness(env = {}) {
  if (env.AI && typeof env.AI.run === "function") return { configured: true, provider: "workers_ai_binding", model: WORKERS_AI_MODEL };
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) return { configured: true, provider: "workers_ai_rest", model: WORKERS_AI_MODEL };
  return { configured: false, provider: null, model: WORKERS_AI_MODEL, required: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] };
}

function clipText(value, max = 2400) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…[усечено]` : text;
}

export function buildGroundedContext(parsed) {
  const source = adaptDocumentParserResult(parsed);
  const ruleType = classifyDocument(parsed);
  const budget = { chars: 34000 };
  const tableSourceIds = new Set();
  const tables = [];

  for (const table of source.tables) {
    const headers = (table.header_cells ?? []).map((cell, index) => {
      tableSourceIds.add(cell.id);
      const sourceIds = [...new Set([cell.id, ...(cell.source_element_ids ?? [])])];
      sourceIds.forEach((id) => tableSourceIds.add(id));
      return { source_element_id: cell.id, source_element_ids: sourceIds, label: clipText(table.headers[index] ?? cell.text, 500) };
    });
    const allRows = table.rows ?? [];
    const chosenRows = new Set();
    allRows.slice(0, 8).forEach((_, index) => chosenRows.add(index));
    if (allRows.length) chosenRows.add(allRows.length - 1);
    const firstRowByPage = new Set();
    allRows.forEach((row, index) => {
      const key = `${row.page_no ?? "no-page"}|${row.sheet_name ?? ""}`;
      if (!firstRowByPage.has(key)) { firstRowByPage.add(key); chosenRows.add(index); }
    });
    const rows = [];
    for (const rowIndex of [...chosenRows].sort((a, b) => a - b)) {
      const row = allRows[rowIndex];
      const cells = [];
      for (const cell of row.cells ?? []) {
        tableSourceIds.add(cell.id);
        if (!cell.text && !cell.address) continue;
        const text = clipText(cell.text, 600);
        const cost = text.length + 64;
        if (budget.chars < cost) continue;
        budget.chars -= cost;
        cells.push({ source_element_id: cell.id, text });
      }
      if (cells.length) rows.push({ row_id: row.row_id, page_no: row.page_no ?? null, sheet_name: row.sheet_name ?? null, cells });
    }
    tables.push({ table_id: table.id, title: clipText(table.caption, 300), role: table.role, pages: table.page_numbers ?? [...new Set((table.rows ?? []).map((row) => row.page_no).filter(Number.isFinite))], headers, rows });
  }

  const fields = fieldDefinitions[ruleType.type] ?? Object.values(fieldDefinitions).flat();
  const sourceElements = [];
  for (const element of source.elements) {
    if (tableSourceIds.has(element.id) || !element.text.trim()) continue;
    const text = clipText(element.text, 1000);
    if (budget.chars < text.length + 50 || sourceElements.length >= 180) continue;
    budget.chars -= text.length + 50;
    sourceElements.push({ source_element_id: element.id, kind: element.kind, text });
  }

  return {
    document_id: source.document_id,
    detected_type_by_rules: ruleType.type,
    possible_field_keys: fields.map(([key, label, aliases, kind]) => ({ key, label, aliases, kind })),
    source_elements: sourceElements,
    tables,
  };
}

function parseModelResult(payload) {
  const candidate = payload?.result?.response ?? payload?.response ?? payload?.result ?? payload;
  if (typeof candidate === "string") {
    try { return JSON.parse(candidate); }
    catch { throw new WorkersAiError("Workers AI вернул невалидный JSON", "WORKERS_AI_INVALID_JSON"); }
  }
  if (candidate && typeof candidate === "object") return candidate;
  throw new WorkersAiError("Workers AI вернул пустой ответ", "WORKERS_AI_EMPTY_RESPONSE");
}

function timed(promise, ms, provider) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new WorkersAiError("Истекло время ожидания Workers AI", "WORKERS_AI_TIMEOUT", 504, { provider, validation_status: "not_run" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runBound(env, input) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await timed(env.AI.run(WORKERS_AI_MODEL, input), 25_000, "workers_ai_binding");
    } catch (error) {
      if (error instanceof WorkersAiError && error.code === "WORKERS_AI_TIMEOUT") throw error;
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      const upstreamStatus = Number(error?.status ?? error?.statusCode);
      lastError = new WorkersAiError(`Workers AI binding завершился ошибкой: ${message}`, "WORKERS_AI_BINDING_FAILED", upstreamStatus === 429 ? 503 : 502, { provider: "workers_ai_binding", upstream_status: Number.isFinite(upstreamStatus) ? upstreamStatus : null, attempt, validation_status: "not_run" });
      if (![429, 500, 502, 503, 504].includes(upstreamStatus) || attempt === 2) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError ?? new WorkersAiError("Workers AI завершил binding вызов без ответа", "WORKERS_AI_EMPTY_RESPONSE", 502, { provider: "workers_ai_binding" });
}

async function runRest(env, input, options = {}) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const token = String(env.CLOUDFLARE_API_TOKEN ?? "").trim();
  if (!accountId || !token) throw new WorkersAiError("Workers AI не настроен. Добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в серверные Secrets.", "WORKERS_AI_NOT_CONFIGURED", 503);
  const modelPath = WORKERS_AI_MODEL.split("/").map(encodeURIComponent).join("/");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelPath}`;
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(25_000) : undefined;
      response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      lastError = new WorkersAiError(timeout ? "Истекло время ожидания Cloudflare Workers AI" : "Не удалось подключиться к Cloudflare Workers AI", timeout ? "WORKERS_AI_TIMEOUT" : "WORKERS_AI_NETWORK_ERROR", timeout ? 504 : 502, { provider: "workers_ai_rest", attempt, validation_status: "not_run" });
      if (attempt < maxAttempts && !timeout) { await new Promise((resolve) => setTimeout(resolve, 150 * attempt)); continue; }
      throw lastError;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const upstreamMessage = payload?.errors?.[0]?.message ?? `HTTP ${response.status}`;
      lastError = new WorkersAiError(`Cloudflare Workers AI отклонил запрос: ${upstreamMessage}`, response.status === 429 ? "WORKERS_AI_RATE_LIMITED" : "WORKERS_AI_UPSTREAM_ERROR", response.status === 429 ? 503 : response.status >= 500 ? 502 : 422, { provider: "workers_ai_rest", attempt, upstream_status: response.status, validation_status: "not_run" });
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxAttempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, retryAfter > 0 ? retryAfter * 1000 : 180 * attempt)));
        continue;
      }
      throw lastError;
    }
    try { return await response.json(); }
    catch { throw new WorkersAiError("Workers AI вернул повреждённый JSON HTTP-ответа", "WORKERS_AI_INVALID_HTTP_JSON", 502, { provider: "workers_ai_rest", attempt, validation_status: "not_run" }); }
  }
  throw lastError ?? new WorkersAiError("Workers AI завершил запрос без ответа", "WORKERS_AI_EMPTY_RESPONSE");
}

function validateGrounding(result, context, parsed) {
  const source = adaptDocumentParserResult(parsed);
  const elements = new Map(source.elements.map((element) => [element.id, element]));
  const tables = new Map(source.tables.map((table) => [table.id, table]));
  const validFields = new Set(Object.values(fieldDefinitions).flat().map(([key]) => key));
  const fieldCandidates = result.field_candidates.filter((candidate) => {
    const element = elements.get(candidate.source_element_id);
    return validFields.has(candidate.field_key) && element && String(element.text).includes(candidate.source_value);
  });
  const tableMappings = result.table_mappings.map((mapping) => {
    const table = tables.get(mapping.table_id);
    if (!table) throw new WorkersAiError(`Workers AI сослался на неизвестную таблицу ${mapping.table_id}`, "WORKERS_AI_UNGROUNDED_OUTPUT");
    const headerIds = new Set((table.header_cells ?? []).flatMap((cell) => [cell.id, ...(cell.source_element_ids ?? [])]));
    const columns = mapping.columns.filter((column) => headerIds.has(column.source_element_id));
    if (columns.length !== mapping.columns.length) throw new WorkersAiError("Workers AI сослался на неизвестный заголовок таблицы", "WORKERS_AI_UNGROUNDED_OUTPUT");
    return { ...mapping, columns };
  });
  const sourceIds = new Set([
    ...context.source_elements.map((element) => element.source_element_id),
    ...context.tables.flatMap((table) => [...table.headers.flatMap((header) => header.source_element_ids ?? [header.source_element_id]), ...table.rows.flatMap((row) => row.cells.map((cell) => cell.source_element_id))]),
  ]);
  const groundedFields = fieldCandidates.filter((item) => sourceIds.has(item.source_element_id));
  const groundedTables = tableMappings.map((mapping) => ({
    ...mapping,
    columns: mapping.columns.filter((column) => sourceIds.has(column.source_element_id)),
  }));
  return {
    document_type: result.document_type,
    classification_confidence: result.classification_confidence,
    field_candidates: groundedFields,
    table_mappings: groundedTables,
  };
}

export async function callWorkersAiForExtraction(parsed, env = {}) {
  const readiness = workersAiReadiness(env);
  if (!readiness.configured) throw new WorkersAiError("Workers AI не настроен. Добавьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в серверные Secrets или подключите AI binding.", "WORKERS_AI_NOT_CONFIGURED", 503, { provider: null, validation_status: "not_run" });
  const started = Date.now();
  const context = buildGroundedContext(parsed);
  const input = {
    messages: [
      {
        role: "system",
        content: "Ты извлекаешь реквизиты и семантическую структуру финансовых документов на русском языке. Используй только приведённые source_element_id. Для поля верни точную подстроку текста источника, без перефразирования и нормализации. Не придумывай ID, координаты, страницы, адреса ячеек и отсутствующие значения. Для таблиц сопоставляй смысл заголовков; неизвестные колонки помечай unknown, а роли определяй как metadata, line_items, payment_schedule, amendments, reference, summary, appendix или table. Таблицы могут продолжаться на разных страницах внутри одного table_id: используй представительные строки только для понимания схемы, не смешивай разные table_id. Для изменений выделяй parameter, old_value, new_value и reason. Самооценка confidence не является доказательством. Если доказательства нет, не создавай запись. Верни только JSON по схеме.",
      },
      { role: "user", content: JSON.stringify(context) },
    ],
    response_format: { type: "json_schema", json_schema: workersAiJsonSchema },
    temperature: 0,
    max_tokens: 2048,
  };
  let raw;
  let provider = readiness.provider;
  if (env.AI && typeof env.AI.run === "function") {
    try {
      raw = await runBound(env, input);
    } catch (error) {
      if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN || error?.code === "WORKERS_AI_TIMEOUT") throw error;
      try { raw = await runRest(env, input); provider = "workers_ai_rest"; }
      catch (restError) { throw restError; }
    }
  } else {
    raw = await runRest(env, input);
  }
  let parsedResponse;
  try { parsedResponse = groundedResponseSchema.parse(parseModelResult(raw)); }
  catch (error) {
    if (error instanceof WorkersAiError) throw new WorkersAiError(error.message, error.code, error.status, { ...error.details, provider, model: WORKERS_AI_MODEL, duration_ms: Date.now() - started, validation_status: "invalid_json" });
    throw new WorkersAiError("Ответ Workers AI не прошёл строгую проверку выходной схемы", "WORKERS_AI_SCHEMA_INVALID", 502, { provider, model: WORKERS_AI_MODEL, duration_ms: Date.now() - started, validation_status: "schema_invalid" });
  }
  let grounded;
  try { grounded = validateGrounding(parsedResponse, context, parsed); }
  catch (error) {
    if (error instanceof WorkersAiError) throw new WorkersAiError(error.message, error.code, error.status, { ...error.details, provider, model: WORKERS_AI_MODEL, duration_ms: Date.now() - started, validation_status: "ungrounded" });
    throw error;
  }
  if (grounded.field_candidates.length !== parsedResponse.field_candidates.length || grounded.table_mappings.length !== parsedResponse.table_mappings.length || grounded.table_mappings.reduce((sum, item) => sum + item.columns.length, 0) !== parsedResponse.table_mappings.reduce((sum, item) => sum + item.columns.length, 0)) {
    throw new WorkersAiError("Ответ модели содержал ссылки на отсутствующие или не совпадающие исходные фрагменты", "WORKERS_AI_UNGROUNDED_OUTPUT", 502, { provider, model: WORKERS_AI_MODEL, duration_ms: Date.now() - started, validation_status: "ungrounded" });
  }
  const usage = raw?.usage ?? raw?.result?.usage ?? raw?.meta?.usage ?? null;
  return {
    ...grounded,
    provider,
    model: WORKERS_AI_MODEL,
    called: true,
    response_validated: true,
    validation_status: "valid_and_grounded",
    duration_ms: Date.now() - started,
    usage,
  };
}

