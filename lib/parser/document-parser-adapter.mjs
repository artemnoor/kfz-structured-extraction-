const HEADER_WORDS = /код|идентифик|артикул|наимен|описан|показател|работ|единиц|колич|объем|объём|план|факт|сумм|стоим|цен|итого|основан|дата|ставк|тариф/i;

const asString = (value) => value == null ? "" : typeof value === "string" ? value : String(value);
const clean = (value) => asString(value).replace(/[\u00a0\u202f]/g, " ").trim();
const canonical = (value) => clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function hashId(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function slug(value) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").normalize("NFKD")
    .replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48) || "document";
}

function unwrap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const parsed = input.parser_json ?? input.analysis ?? input.analysis_json ?? input;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const layout = input.layout_json ?? input.visual_layout ?? input.layout ?? parsed.visual_layout;
  if (layout && typeof layout === "object" && (Array.isArray(layout.parts) || layout.pages)) {
    return { ...parsed, visual_layout: layout };
  }
  return parsed;
}

function documentIdOf(parsed) {
  const existing = parsed.document_id ?? parsed.document?.origin?.document_id ?? parsed.document?.name;
  if (existing != null && clean(existing)) return String(existing);
  const filename = parsed.document?.origin?.filename ?? parsed.file_name ?? parsed.filename ?? parsed.title ?? "document-parser-result";
  const fingerprint = parsed.document?.origin?.binary_hash ?? parsed.document?.origin?.sha256 ?? filename;
  return `dp-${slug(filename)}-${hashId(fingerprint)}`;
}

function originPageSize(parsed, pageNo) {
  const visual = parsed.visual_layout ?? parsed.layout ?? {};
  const page = visual.pages?.[String(pageNo)] ?? visual.pages?.[pageNo] ?? parsed.document?.pages?.[String(pageNo)] ?? parsed.document?.pages?.[pageNo];
  const size = page?.size ?? page?.unrotated_size ?? page;
  if (!size || !Number.isFinite(Number(size.width)) || !Number.isFinite(Number(size.height))) return null;
  return { width: Number(size.width), height: Number(size.height), unit: "pt" };
}

function firstProvenance(value) {
  const raw = value?.provenance ?? value?.prov;
  return Array.isArray(raw) ? raw.find((item) => item && typeof item === "object") ?? null : raw ?? null;
}

function partText(part) {
  if (!part || typeof part !== "object") return "";
  if (part.display_value !== undefined && part.display_value !== null) return asString(part.display_value);
  if (part.cached_value !== undefined && part.cached_value !== null) return asString(part.cached_value);
  if (part.value !== undefined && part.value !== null) return asString(part.value);
  if (part.text !== undefined && part.text !== null) return asString(part.text);
  if (part.content !== undefined && part.content !== null) return asString(part.content);
  if (part.fragment !== undefined && part.fragment !== null) return asString(part.fragment);
  if (part.orig !== undefined && part.orig !== null) return asString(part.orig);
  return asString(part.formula);
}

function colLetters(oneBased) {
  let n = oneBased;
  let result = "";
  while (n > 0) { const remainder = (n - 1) % 26; result = String.fromCharCode(65 + remainder) + result; n = Math.floor((n - 1) / 26); }
  return result;
}

function parseCellAddress(value) {
  const match = clean(value).match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function rangeStart(value) {
  const part = clean(value).split(":")[0];
  return parseCellAddress(part);
}

function parseCellRange(value) {
  const [first, last = first] = clean(value).split(":");
  const start = parseCellAddress(first);
  const end = parseCellAddress(last);
  if (!start || !end) return null;
  return { start_row: Math.min(start.row, end.row), end_row: Math.max(start.row, end.row), start_column: Math.min(start.column, end.column), end_column: Math.max(start.column, end.column) };
}

function makeProvenance(source, options) {
  const { documentId, elementId, text, fallback, pageNo, sheetName, cellAddress, tableId, rowId, column } = options;
  const sourceProv = source?.provenance ?? source?.prov;
  const fallbackProv = fallback?.provenance ?? fallback?.prov ?? fallback;
  const provList = Array.isArray(sourceProv) ? sourceProv : Array.isArray(fallbackProv) ? fallbackProv : [];
  const distinctPages = [...new Set(provList.map((item) => Number(item?.page_no)).filter(Number.isFinite))];
  const ambiguousPage = !firstProvenance(source) && distinctPages.length > 1;
  const input = firstProvenance(source) ?? firstProvenance(fallback) ?? {};
  const sourcePage = ambiguousPage ? null : input.page_no ?? source?.page_no ?? source?.page ?? source?.slide ?? fallback?.page_no ?? pageNo ?? null;
  const sourceSheet = input.sheet_name ?? source?.sheet_name ?? source?.sheet ?? fallback?.sheet_name ?? sheetName ?? null;
  const sourceCell = input.cell_address ?? input.address ?? source?.cell_address ?? source?.address ?? source?.coordinate ?? fallback?.cell_address ?? cellAddress ?? null;
  const bbox = ambiguousPage ? null : input.bbox ?? source?.bbox ?? fallback?.bbox ?? null;
  const coordinateOrigin = input.coordinate_origin ?? bbox?.coord_origin ?? source?.coordinate_origin ?? null;
  const pageSize = input.page_size ?? originPageSize(options.parsed, sourcePage) ?? fallback?.page_size ?? null;
  const confidenceValue = input.confidence ?? source?.confidence ?? fallback?.confidence;
  const confidence = Number.isFinite(Number(confidenceValue)) ? Math.max(0, Math.min(1, Number(confidenceValue))) : ambiguousPage ? 0.62 : 0.82;
  const ref = input.source_ref ?? source?.source_ref ?? source?.ref ?? source?.self_ref ?? fallback?.source_ref ?? null;
  const provenance = {
    document_id: documentId,
    source_part_id: elementId,
    ...(ref ? { source_ref: String(ref) } : {}),
    page_no: sourcePage == null ? null : Number(sourcePage),
    sheet_name: sourceSheet == null ? null : String(sourceSheet),
    cell_address: sourceCell == null ? null : String(sourceCell),
    bbox: bbox && Number.isFinite(Number(bbox.l)) && Number.isFinite(Number(bbox.t)) && Number.isFinite(Number(bbox.r)) && Number.isFinite(Number(bbox.b))
      ? { l: Number(bbox.l), t: Number(bbox.t), r: Number(bbox.r), b: Number(bbox.b), ...(bbox.coord_origin ? { coord_origin: String(bbox.coord_origin) } : {}) }
      : null,
    coordinate_origin: coordinateOrigin == null ? null : String(coordinateOrigin),
    page_size: pageSize,
    ...(tableId ? { table_id: String(tableId) } : {}),
    ...(rowId ? { row_id: String(rowId) } : {}),
    ...(column != null ? { column_index: Number(column) } : {}),
    source_text: String(input.source_text ?? text ?? ""),
    confidence,
  };
  if (provenance.bbox && provenance.page_size && /BOTTOMLEFT/i.test(provenance.coordinate_origin ?? provenance.bbox.coord_origin ?? "")) {
    const { l, t, r, b } = provenance.bbox;
    const height = provenance.page_size.height;
    provenance.bbox_top_left = { l, t: height - Math.max(t, b), r, b: height - Math.min(t, b), coord_origin: "TOPLEFT" };
  }
  return provenance;
}

function inferRole(caption, headers, rows) {
  const label = canonical(caption);
  const headerText = headers.join(" ");
  if (/реквизит|стороны|подписи|банковские реквизит/.test(label)) return "metadata";
  if (/оплат|платеж|платёж|этап/.test(label)) return "payment_schedule";
  if (/измен/.test(label)) return "amendments";
  if (headers.length <= 2 && rows.length && rows.every((row) => {
    const cells = row.cells ?? [];
    return cells.filter((cell) => clean(cell.text)).length <= 2 && /:/.test(cells[0]?.text ?? "");
  })) return "metadata";
  if (HEADER_WORDS.test(headerText) && rows.length) return "line_items";
  return "table";
}

function normalizeEnvelopeTables(parsed, state) {
  const rawTables = Array.isArray(parsed.logical_tables) ? parsed.logical_tables : [];
  return rawTables.map((table, tableIndex) => normalizeExplicitTable(table, tableIndex, state, "logical_tables"));
}

function normalizeExplicitTable(table, tableIndex, state, sourceType) {
  const tableId = String(table.id ?? table.table_id ?? table.ref ?? `${sourceType}-table-${tableIndex + 1}`);
  const caption = String(table.caption ?? table.title ?? table.text ?? table.name ?? `Таблица ${tableIndex + 1}`);
  const tableProv = table.provenance ?? table.prov ?? null;
  const tableRef = table.ref ?? table.self_ref ?? table.source_ref ?? `${sourceType}/${table.index ?? tableIndex + 1}`;
  let rawRows = Array.isArray(table.rows) ? table.rows : Array.isArray(table.values) ? table.values : [];
  let headers = Array.isArray(table.headers) ? table.headers.map((item) => typeof item === "object" ? partText(item) : asString(item)) : [];
  let rawHeaderCells = Array.isArray(table.header_cells) ? table.header_cells : [];
  if (rawRows.length && !headers.length) {
    const first = rawRows[0];
    const cells = Array.isArray(first) ? first : first?.cells ?? [];
    headers = cells.map((cell) => typeof cell === "object" ? partText(cell) : asString(cell));
    rawHeaderCells = cells;
    rawRows = rawRows.slice(1);
  }
  const headerElements = headers.map((header, column) => {
    const nativeCell = table.cells?.find((item) => Number(item.row) === 0 && Number(item.column) === column);
    const source = rawHeaderCells[column] && typeof rawHeaderCells[column] === "object" ? { ...rawHeaderCells[column] } : nativeCell ? { ...nativeCell } : { text: header };
    source.source_ref ??= tableRef;
    const cell = state.makeCell(source, { tableId, rowIndex: -1, column, fallback: tableProv, sheetName: table.sheet_name ?? table.sheet, pageNo: table.page_no ?? table.page ?? table.slide });
    cell.text ||= header;
    if (!cell.provenance) cell.provenance = state.makeProvenance({ text: header }, { elementId: cell.id, text: header, fallback: tableProv, tableId, column, parsed: state.parsed, documentId: state.documentId });
    return cell;
  });
  const rows = rawRows.map((rawRow, rowIndex) => {
    const cells = Array.isArray(rawRow) ? rawRow : rawRow?.cells ?? rawRow?.values ?? [];
    const sourceRowId = rawRow?.row_id ?? rawRow?.id ?? `${tableId}-r${String(rowIndex + 1).padStart(3, "0")}`;
    const rowPage = rawRow?.page_no ?? rawRow?.page ?? table.page_no ?? table.page ?? table.slide ?? null;
    const rowSheet = rawRow?.sheet_name ?? rawRow?.sheet ?? table.sheet_name ?? table.sheet ?? null;
    return {
      row_id: String(sourceRowId),
      page_no: rowPage == null ? null : Number(rowPage),
      sheet_name: rowSheet == null ? null : String(rowSheet),
      cells: cells.map((rawCell, column) => {
        const originalRow = Number(rawRow?.source_row_index ?? rowIndex + (table.headers?.length ? 0 : 1));
        const nativeCell = table.cells?.find((item) => Number(item.row) === originalRow && Number(item.column) === column);
        let source = rawCell && typeof rawCell === "object" ? { ...rawCell } : { text: rawCell };
        if (nativeCell) source = { ...source, ...nativeCell, text: partText(source) || nativeCell.text };
        source.source_ref ??= tableRef;
        const covering = !nativeCell && table.cells?.find((item) => {
          const r = Number(item.row ?? 0), c = Number(item.column ?? 0);
          return rowIndex + (table.headers?.length ? 0 : 1) >= r && rowIndex + (table.headers?.length ? 0 : 1) < r + Number(item.row_span ?? 1) && column >= c && column < c + Number(item.col_span ?? 1);
        });
        if (covering) source = { ...source, text: "", merged_from: { row: covering.row, column: covering.column } };
        return state.makeCell(source, {
        tableId, rowId: String(sourceRowId), rowIndex, column,
        fallback: rawRow?.provenance ?? tableProv, sheetName: rowSheet, pageNo: rowPage,
      });
      }),
    };
  });
  const role = String(table.role ?? inferRole(caption, headers, rows));
  return {
    id: tableId, caption, role, headers, header_cells: headerElements, rows,
    page_no: table.page_no ?? table.page ?? table.slide ?? firstProvenance(table)?.page_no ?? null,
    page_numbers: [...new Set([table.page_no, table.page, table.slide, ...(rows.map((row) => row.page_no))].filter((value) => value != null && Number.isFinite(Number(value))).map(Number))],
    sheet_name: table.sheet_name ?? table.sheet ?? null,
    provenance: tableProv,
    merged_ranges: table.merged_ranges ?? table.merged ?? [],
    source_type: sourceType,
    source_ref: tableRef,
  };
}

function tableGrid(table) {
  const data = table?.data ?? {};
  const declaredRows = Number(data.num_rows ?? table.num_rows ?? 0);
  const declaredCols = Number(data.num_cols ?? table.num_cols ?? 0);
  const sourceCells = Array.isArray(data.table_cells) ? data.table_cells : [];
  if (sourceCells.length) {
    const maxRows = Math.min(Math.max(declaredRows, 1), 5000);
    const maxCols = Math.min(Math.max(declaredCols, 1), 500);
    const grid = Array.from({ length: maxRows }, () => Array.from({ length: maxCols }, () => null));
    for (const cell of sourceCells.slice(0, 100000)) {
      const row = Number(cell.start_row_offset_idx ?? 0);
      const col = Number(cell.start_col_offset_idx ?? 0);
      if (row < 0 || col < 0 || row >= maxRows || col >= maxCols) continue;
      if (!grid[row][col]) grid[row][col] = cell;
    }
    return grid;
  }
  if (Array.isArray(data.grid)) return data.grid.slice(0, 5000).map((row) => (Array.isArray(row) ? row.slice(0, 500) : []));
  if (Array.isArray(table.rows)) return table.rows;
  return [];
}

function normalizeDoclingTable(table, index, state, sourceType) {
  const tableId = String(table.id ?? table.table_id ?? table.ref ?? table.self_ref ?? `${sourceType}-table-${index + 1}`);
  const caption = String(table.caption ?? table.name ?? table.text ?? table.label ?? `Таблица ${index + 1}`);
  const grid = tableGrid(table);
  const sourceCells = Array.isArray(table.data?.table_cells) ? table.data.table_cells : [];
  const prov = table.provenance ?? table.prov ?? null;
  const sourcePages = [...new Set((Array.isArray(prov) ? prov : [prov]).map((item) => Number(item?.page_no)).filter(Number.isFinite))];
  const singlePage = sourcePages.length === 1 ? sourcePages[0] : null;
  const headerRows = new Set();
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    if (grid[rowIndex].some((cell) => cell && typeof cell === "object" && cell.column_header)) headerRows.add(rowIndex);
  }
  if (!headerRows.size && grid.length) {
    const firstNonEmpty = grid.findIndex((row) => row.some((cell) => clean(typeof cell === "object" ? partText(cell) : cell)));
    if (firstNonEmpty >= 0) headerRows.add(firstNonEmpty);
  }
  const headerIndexes = [...headerRows].sort((a, b) => a - b);
  const firstHeader = headerIndexes[0] ?? 0;
  const lastHeader = headerIndexes.at(-1) ?? firstHeader;
  const width = Math.max(Number(table.data?.num_cols ?? table.num_cols ?? 0), ...grid.map((row) => row.length), 0);
  const headerCells = Array.from({ length: width }, (_, column) => {
    const textParts = [];
    const origins = [];
    for (const rowIndex of headerIndexes) {
      let cell = grid[rowIndex]?.[column];
      if (!cell && sourceCells.length) cell = sourceCells.find((candidate) => {
        const r = Number(candidate.start_row_offset_idx ?? 0);
        const c = Number(candidate.start_col_offset_idx ?? 0);
        return rowIndex >= r && rowIndex < r + Number(candidate.row_span ?? 1) && column >= c && column < c + Number(candidate.col_span ?? 1);
      });
      if (!cell) continue;
      const startRow = Number(cell.start_row_offset_idx ?? rowIndex);
      const startColumn = Number(cell.start_col_offset_idx ?? column);
      origins.push({ cell, rowIndex: startRow, column: startColumn });
      const value = clean(typeof cell === "object" ? partText(cell) : cell);
      if (value && textParts.at(-1) !== value) textParts.push(value);
    }
    const text = textParts.join(" · ");
    const representative = origins.at(-1) ?? null;
    const source = representative?.cell ?? { text };
    const headerCell = state.makeCell(source, { tableId, rowIndex: representative?.rowIndex ?? firstHeader, column: representative?.column ?? column, fallback: prov });
    headerCell.text = text;
    const sourceIds = origins.map(({ cell: origin, rowIndex, column: sourceColumn }) => state.makeCell(origin, { tableId, rowIndex, column: sourceColumn, fallback: prov }).id);
    headerCell.source_element_ids = [...new Set([headerCell.id, ...sourceIds])];
    return headerCell;
  });
    const rows = [];
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    if (headerRows.has(rowIndex) || rowIndex < firstHeader) continue;
    const rawRow = grid[rowIndex] ?? [];
    const rowId = `${tableId}-r${String(rowIndex + 1).padStart(3, "0")}`;
    const cells = Array.from({ length: width }, (_, column) => {
      let source = rawRow[column];
      if (!source && sourceCells.length) source = sourceCells.find((candidate) => {
        const r = Number(candidate.start_row_offset_idx ?? 0);
        const c = Number(candidate.start_col_offset_idx ?? 0);
        return rowIndex >= r && rowIndex < r + Number(candidate.row_span ?? 1) && column >= c && column < c + Number(candidate.col_span ?? 1);
      });
      const anchorRow = Number(source?.start_row_offset_idx ?? rowIndex);
      const anchorColumn = Number(source?.start_col_offset_idx ?? column);
      const merged = source && typeof source === "object" && (anchorRow !== rowIndex || anchorColumn !== column);
      const cell = state.makeCell(merged ? { ...source, text: "", merged_from: { row: anchorRow, column: anchorColumn } } : source ?? { text: "" }, {
        tableId, rowId, rowIndex, column, fallback: prov,
      });
      if (merged) cell.text = "";
      return cell;
    });
    const cellPages = [...new Set(cells.map((cell) => cell.page_no).filter(Number.isFinite))];
    const rowPage = cellPages.length === 1 ? cellPages[0] : singlePage;
    if (cells.some((cell) => clean(cell.text))) rows.push({ row_id: rowId, page_no: rowPage, sheet_name: null, cells });
  }
  const headers = headerCells.map((cell) => cell.text);
  const sourceMerged = Array.isArray(table.merged) ? table.merged : [];
  const role = table.role ?? inferRole(caption, headers, rows);
  return {
    id: tableId, caption, role, headers, header_cells: headerCells, rows,
    page_no: singlePage, page_numbers: sourcePages, sheet_name: table.sheet_name ?? null,
    provenance: prov, merged_ranges: sourceMerged,
    merged_cells: grid.flatMap((row, rowIndex) => row.flatMap((cell, column) => cell && typeof cell === "object" && (Number(cell.row_span ?? 1) > 1 || Number(cell.col_span ?? 1) > 1) ? [{ row: rowIndex, column, row_span: Number(cell.row_span ?? 1), col_span: Number(cell.col_span ?? 1), text: partText(cell) }] : [])),
    source_type: sourceType,
    source_ref: table.ref ?? table.self_ref ?? null,
  };
}

function officeTables(parsed, state) {
  const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
  const sheets = parts.filter((part) => part?.kind === "sheet");
  const cells = parts.filter((part) => part?.kind === "cell" && (part.coordinate || part.address));
  if (!cells.length) return [];
  const grouped = new Map();
  for (const cell of cells) {
    const sheet = String(cell.sheet ?? "Лист1");
    if (!grouped.has(sheet)) grouped.set(sheet, []);
    const address = parseCellAddress(cell.coordinate ?? cell.address);
    if (!address) continue;
    grouped.get(sheet).push({ ...cell, _row: Number(cell.row ?? address.row), _column: Number(cell.column ?? address.column), _address: cell.coordinate ?? cell.address });
  }
  const result = [];
  for (const [sheetName, sheetCells] of grouped) {
    const byRow = new Map();
    for (const cell of sheetCells) {
      if (!byRow.has(cell._row)) byRow.set(cell._row, new Map());
      byRow.get(cell._row).set(cell._column, cell);
    }
    const candidateRows = [...byRow.keys()].sort((a, b) => a - b).map((row) => {
      const rowCells = [...byRow.get(row).values()].sort((a, b) => a._column - b._column);
      const nonEmpty = rowCells.filter((cell) => clean(partText(cell))).length;
      const keywordCount = rowCells.filter((cell) => HEADER_WORDS.test(partText(cell))).length;
      const label = canonical(rowCells.map(partText).join(" "));
      const isTotal = /(^|\s)(итого|всего|total)(\s|$)/.test(label);
      return { row, rowCells, nonEmpty, keywordCount, isTotal };
    });
    const headers = candidateRows.filter((item) => item.nonEmpty >= 2 && !item.isTotal && item.keywordCount >= 2);
    if (!headers.length) {
      const fallback = candidateRows.find((item) => item.nonEmpty >= 2);
      if (fallback) headers.push(fallback);
    }
    for (const [tableIndex, header] of headers.entries()) {
      const nextHeaderRow = headers[tableIndex + 1]?.row ?? Infinity;
      const blockCells = sheetCells.filter((cell) => cell._row >= header.row && cell._row < nextHeaderRow);
      const minCol = Math.min(...header.rowCells.map((cell) => cell._column));
      const maxCol = Math.max(...blockCells.map((cell) => cell._column));
      const tableId = `xlsx-${slug(sheetName)}-${tableIndex + 1}`;
      const sheet = sheets.find((item) => item.name === sheetName);
      const mergedRanges = (sheet?.merged ?? []).map((range) => ({ address: String(range), ...parseCellRange(range) })).filter((range) => range.start_row);
      const headerSources = Array.from({ length: maxCol - minCol + 1 }, (_, offset) => {
        const column = minCol + offset;
        const candidates = [];
        const direct = byRow.get(header.row)?.get(column);
        if (direct && clean(partText(direct))) candidates.push(direct);
        for (const range of mergedRanges) {
          const coversColumn = column >= range.start_column && column <= range.end_column;
          const nearHeader = range.start_row < header.row && range.end_row >= header.row - 1 && range.start_row >= header.row - 2
            || range.start_row === header.row && range.end_row >= header.row;
          const broadTitle = range.start_column <= minCol && range.end_column >= maxCol && range.end_column > range.start_column;
          if (!coversColumn || !nearHeader || broadTitle) continue;
          const anchor = byRow.get(range.start_row)?.get(range.start_column);
          if (anchor && clean(partText(anchor)) && !candidates.some((item) => item.coordinate === anchor.coordinate)) candidates.push(anchor);
        }
        candidates.sort((a, b) => a._row - b._row || a._column - b._column);
        return candidates;
      });
      const headersText = headerSources.map((sources) => [...new Set(sources.map(partText).map(clean).filter(Boolean))].join(" · "));
      const headerCells = Array.from({ length: headersText.length }, (_, offset) => {
        const candidates = headerSources[offset];
        const source = candidates.at(-1) ?? byRow.get(header.row)?.get(minCol + offset) ?? { coordinate: `${colLetters(minCol + offset)}${header.row}`, sheet: sheetName, value: "" };
        const cell = state.makeCell(source, { tableId, rowIndex: header.row, column: offset, sheetName, cellAddress: source.coordinate ?? source._address });
        cell.text = headersText[offset];
        cell.source_element_ids = [...new Set([cell.id, ...candidates.map((item) => state.makeCell(item, { tableId, rowIndex: item._row, column: item._column - minCol, sheetName, cellAddress: item.coordinate ?? item._address }).id)])];
        return cell;
      });
      const rows = [];
      for (const rowNumber of [...byRow.keys()].sort((a, b) => a - b)) {
        if (rowNumber <= header.row || rowNumber >= nextHeaderRow) continue;
        const rowMap = byRow.get(rowNumber);
        const cellsInRow = Array.from({ length: headersText.length }, (_, offset) => {
          const column = minCol + offset;
          const direct = rowMap.get(column);
          const covering = !direct && mergedRanges.find((range) => rowNumber >= range.start_row && rowNumber <= range.end_row && column >= range.start_column && column <= range.end_column);
          const anchor = covering ? byRow.get(covering.start_row)?.get(covering.start_column) : null;
          const source = direct ?? anchor ?? { coordinate: `${colLetters(column)}${rowNumber}`, sheet: sheetName, value: "", _row: rowNumber, _column: column };
          const cell = state.makeCell(covering ? { ...source, text: "", merged_from: { address: source.coordinate ?? source._address ?? `${colLetters(covering.start_column)}${covering.start_row}` } } : source, { tableId, rowIndex: rowNumber, column: offset, rowId: `${sheetName}-r${rowNumber}`, sheetName, cellAddress: source.coordinate ?? source._address });
          if (covering) cell.text = "";
          return cell;
        });
        if (!cellsInRow.some((cell) => clean(cell.text))) continue;
        rows.push({ row_id: `${slug(sheetName)}-r${String(rowNumber).padStart(4, "0")}`, page_no: null, sheet_name: sheetName, cells: cellsInRow });
      }
      result.push({
        id: tableId, caption: sheetName, role: inferRole(sheetName, headersText, rows),
        headers: headersText, header_cells: headerCells, rows, page_no: null, page_numbers: [], sheet_name: sheetName,
        provenance: null, merged_ranges: sheet?.merged ?? [], source_type: "native_xlsx_parts", source_ref: null,
      });
    }
  }
  return result;
}

function nativePartsTables(parsed, state) {
  const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
  return parts.filter((part) => part && (part.kind === "table" || part.kind === "shape" && Array.isArray(part.rows))).map((part, index) => {
    const stablePartId = part.id ?? `${part.kind}-${part.index ?? part.page ?? part.slide ?? index + 1}`;
    return normalizeExplicitTable({
      ...part,
      id: part.table_id ?? stablePartId,
      caption: part.caption ?? part.title ?? part.text ?? part.name ?? `${part.kind} ${index + 1}`,
      page_no: part.page_no ?? part.page ?? part.slide ?? null,
      source_ref: part.source_ref ?? `parts/${stablePartId}`,
    }, index, state, "native_parts");
  });
}

function visualTables(parsed, state) {
  const parts = parsed.visual_layout?.parts ?? parsed.layout_json?.parts ?? [];
  const groups = new Map();
  for (const [index, part] of parts.entries()) {
    if (part?.kind !== "table" && !Array.isArray(part?.rows)) continue;
    const key = String(part.table_id ?? part.id ?? `visual-table-${index + 1}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(part);
  }
  return [...groups.entries()].map(([tableId, fragments], index) => {
    const first = fragments[0];
    const headers = Array.isArray(first.headers) ? first.headers.map((h) => typeof h === "object" ? partText(h) : asString(h)) : (first.rows?.[0] ?? []).map((cell) => typeof cell === "object" ? partText(cell) : asString(cell));
    const headerCells = headers.map((header, column) => {
      const source = first.header_cells?.[column] ?? first.cells?.find((cell) => Number(cell.row) === 0 && Number(cell.column) === column) ?? { text: header };
      return state.makeCell(source, { tableId, rowIndex: 0, column, fallback: first, pageNo: firstProvenance(first)?.page_no });
    });
    const rows = [];
    for (const [fragmentIndex, part] of fragments.entries()) {
      const sourceRows = part.rows ?? [];
      const hasHeader = sourceRows.length && sourceRows[0].every((cell, col) => clean(typeof cell === "object" ? partText(cell) : cell) === clean(headers[col]));
      for (const [rowIndex, sourceRow] of sourceRows.entries()) {
        if (hasHeader && rowIndex === 0) continue;
        const rowId = `${tableId}-p${firstProvenance(part)?.page_no ?? fragmentIndex + 1}-r${rowIndex + 1}`;
        const cells = (Array.isArray(sourceRow) ? sourceRow : sourceRow?.cells ?? []).map((source, column) => {
          const tableCell = part.cells?.find((cell) => Number(cell.row) === rowIndex && Number(cell.column) === column);
          const value = typeof source === "object" ? source : { text: source };
          return state.makeCell({ ...value, ...(tableCell ?? {}) }, { tableId, rowId, rowIndex, column, fallback: part, pageNo: firstProvenance(part)?.page_no });
        });
        if (cells.some((cell) => clean(cell.text))) rows.push({ row_id: rowId, page_no: firstProvenance(part)?.page_no ?? null, sheet_name: part.sheet_name ?? null, cells });
      }
    }
    const pageNumbers = [...new Set(fragments.map((part) => Number(firstProvenance(part)?.page_no ?? part.page_no)).filter(Number.isFinite))];
    return { id: tableId, caption: String(first.text ?? first.caption ?? `Таблица ${index + 1}`), role: first.role ?? inferRole(first.caption ?? first.text, headers, rows), headers, header_cells: headerCells, rows, page_no: pageNumbers.length === 1 ? pageNumbers[0] : null, page_numbers: pageNumbers, sheet_name: first.sheet_name ?? null, provenance: first.provenance ?? null, merged_ranges: first.merged ?? [], source_type: "visual_layout", source_ref: first.ref ?? null };
  });
}

function addFreeElements(parsed, state) {
  const sources = [
    ...(Array.isArray(parsed.parts) ? parsed.parts : []).filter((part) => part?.kind !== "sheet" && part?.kind !== "cell" && part?.kind !== "table"),
    ...(Array.isArray(parsed.model_parts) ? parsed.model_parts : []).filter((part) => part?.kind !== "table"),
    ...(Array.isArray(parsed.document?.texts) ? parsed.document.texts : []),
    ...(Array.isArray(parsed.fragments) ? parsed.fragments : []),
    ...(Array.isArray(parsed.values) ? parsed.values : []),
  ];
  const seen = new Set();
  for (const [index, source] of sources.entries()) {
    if (source == null) continue;
    const object = typeof source === "object" ? source : { text: asString(source) };
    const text = partText(object);
    const ref = object.ref ?? object.self_ref ?? object.id ?? object.source_ref ?? index;
    if (!clean(text) && object.kind !== "value") continue;
    const key = `${ref}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.addElement(object, { kind: object.kind ?? "text", text, sourceId: ref, sourceType: object.source ?? object.kind ?? "text" });
  }
  if (parsed.values && !Array.isArray(parsed.values) && typeof parsed.values === "object") {
    for (const [key, value] of Object.entries(parsed.values)) {
      if (value == null || typeof value === "object") continue;
      const text = `${key}: ${asString(value)}`;
      state.addElement({ id: `values-${key}`, text, provenance: value?.provenance }, { kind: "value", text, sourceId: `values-${key}`, sourceType: "values" });
    }
  }
}

export function adaptDocumentParserResult(input, options = {}) {
  const parsed = unwrap(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Ожидался JSON результата Document Parser");
  const documentId = documentIdOf(parsed);
  const state = {
    parsed, documentId, elements: [], elementById: new Map(),
    makeProvenance(source, detail) { return makeProvenance(source, { ...detail, parsed, documentId }); },
    addElement(source, detail = {}) {
      const text = detail.text ?? partText(source);
      const explicit = source?.id ?? source?.source_part_id ?? source?.ref ?? source?.self_ref ?? detail.sourceId;
      const address = source?.coordinate ?? source?.address ?? detail.cellAddress ?? "";
      const ref = source?.ref ?? source?.self_ref ?? source?.source_ref ?? "";
      const seed = explicit ?? `${detail.kind ?? source?.kind ?? "part"}|${detail.sourceType ?? ""}|${detail.tableId ?? ""}|${detail.rowId ?? detail.rowIndex ?? ""}|${detail.column ?? ""}|${address}|${ref}|${text}|${firstProvenance(source)?.page_no ?? source?.page ?? ""}`;
      const id = `${documentId}:src:${hashId(seed)}`;
      if (state.elementById.has(id)) return state.elementById.get(id);
      const element = {
        id, kind: detail.kind ?? source?.kind ?? "text", text: asString(text),
        ...(source?.value !== undefined ? { raw_value: source.value } : {}),
        ...(source?.display_value !== undefined ? { display_value: source.display_value } : {}),
        ...(source?.formula ? { formula: source.formula } : {}),
        ...(source?.calculation_status ? { calculation_status: source.calculation_status } : {}),
        ...(detail.sourceType ? { source_type: String(detail.sourceType) } : {}),
        ...(source?.ref ?? source?.self_ref ?? source?.source_ref ? { source_ref: String(source.ref ?? source.self_ref ?? source.source_ref) } : {}),
        provenance: null,
      };
      element.provenance = state.makeProvenance(source, { elementId: id, text: element.text, pageNo: detail.pageNo, sheetName: detail.sheetName, cellAddress: detail.cellAddress, tableId: detail.tableId, rowId: detail.rowId, column: detail.column });
      state.elementById.set(id, element);
      state.elements.push(element);
      return element;
    },
    makeCell(source, detail = {}) {
      const raw = source && typeof source === "object" ? source : { text: asString(source) };
      const text = partText(raw);
      const element = state.addElement(raw, { ...detail, kind: "cell", text, sourceType: raw.kind ?? detail.sourceType ?? "table_cell" });
      const col = Number(detail.column ?? raw.column ?? 0);
      const row = Number(detail.rowIndex ?? raw.row ?? 0);
      const address = raw.address ?? raw.coordinate ?? raw.cell_address ?? detail.cellAddress ?? null;
      const provenance = element.provenance ?? state.makeProvenance(raw, { elementId: element.id, text, ...detail, cellAddress: address });
      return {
        id: element.id, row, column: col, text,
        ...(raw.value !== undefined ? { value: raw.value } : {}),
        ...(raw.display_value !== undefined ? { display_value: raw.display_value } : {}),
        ...(raw.formula ? { formula: raw.formula } : {}),
        ...(raw.calculation_status ? { calculation_status: raw.calculation_status } : {}),
        ...(address ? { address: String(address) } : {}),
        ...(raw.row_span ? { row_span: Number(raw.row_span) } : {}),
        ...(raw.col_span ? { col_span: Number(raw.col_span) } : {}),
        ...(raw.merged_from ? { merged_from: raw.merged_from } : {}),
        page_no: provenance?.page_no ?? detail.pageNo ?? null,
        sheet_name: provenance?.sheet_name ?? detail.sheetName ?? null,
        bbox: provenance?.bbox ?? raw.bbox ?? null,
        provenance,
      };
    },
  };

  const layout = parsed.visual_layout ?? input?.layout_json ?? input?.layout ?? null;
  const pages = layout?.pages ?? parsed.document?.pages ?? {};
  const pageCount = Number(parsed.page_count ?? Object.keys(pages).length ?? 0) || null;
  addFreeElements(parsed, state);

  let tables = normalizeEnvelopeTables(parsed, state);
  if (!tables.length && /xlsx|xlsm|spreadsheet/i.test(String(parsed.source_extension ?? parsed.format ?? ""))) tables = officeTables(parsed, state);
  if (!tables.length) tables = nativePartsTables(parsed, state);
  if (!tables.length && Array.isArray(parsed.document?.tables) && parsed.document.tables.length) tables = parsed.document.tables.map((table, index) => normalizeDoclingTable(table, index, state, "document.tables"));
  if (!tables.length && Array.isArray(parsed.model_parts)) {
    tables = parsed.model_parts.filter((part) => part?.kind === "table" && part.data).map((table, index) => normalizeDoclingTable(table, index, state, "model_parts"));
  }
  if (!tables.length) tables = visualTables(parsed, state);
  if (!tables.length) tables = officeTables(parsed, state);

  const metadata = parsed.document?.origin ?? {};
  const extensionValue = parsed.source_extension ?? parsed.format;
  const sourceExtension = extensionValue ? String(extensionValue).startsWith(".") ? String(extensionValue) : `.${extensionValue}` : "";
  const documentName = parsed.document?.name == null ? "" : String(parsed.document.name);
  const documentFileName = documentName && sourceExtension && !documentName.toLocaleLowerCase("ru-RU").endsWith(sourceExtension.toLocaleLowerCase("ru-RU")) ? `${documentName}${sourceExtension}` : documentName;
  const fileName = String(parsed.file_name ?? parsed.filename ?? metadata.filename ?? (documentFileName || parsed.title) ?? `${documentId}.json`);
  const format = String(parsed.format ?? parsed.source_extension ?? fileName.split(".").pop() ?? "JSON").replace(/^\./, "").toUpperCase();
  const sheetNames = [...new Set([
    ...(Array.isArray(parsed.workbook?.sheet_names) ? parsed.workbook.sheet_names : []),
    ...(Array.isArray(parsed.parts) ? parsed.parts.filter((part) => part?.kind === "sheet").map((part) => part.name) : []),
    ...tables.map((table) => table.sheet_name).filter(Boolean),
  ].map(String))];
  const pageNumbers = state.elements.map((element) => element.provenance?.page_no).filter(Number.isFinite);
  const maxPage = pageNumbers.length ? Math.max(...pageNumbers) : 0;
  return {
    adapter_version: "document-parser-unified/1.0.0",
    document_id: documentId,
    title: String(parsed.title ?? metadata.filename ?? fileName),
    file_name: fileName,
    format,
    page_count: pageCount ?? maxPage ?? null,
    page_sizes: pages,
    sheet_names: sheetNames,
    elements: state.elements,
    tables,
    parser_sections: {
      parts: Array.isArray(parsed.parts) ? parsed.parts.length : 0,
      model_parts: Array.isArray(parsed.model_parts) ? parsed.model_parts.length : 0,
      visual_layout_parts: Array.isArray(layout?.parts) ? layout.parts.length : 0,
      logical_tables: Array.isArray(parsed.logical_tables) ? parsed.logical_tables.length : 0,
    },
  };
}

export function parserInputShapeErrors(value) {
  const parsed = unwrap(value);
  const errors = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ["Ожидался JSON-объект результата Document Parser"];
  const hasParts = Array.isArray(parsed.parts) || Array.isArray(parsed.model_parts) || Array.isArray(parsed.document?.texts) || Array.isArray(parsed.fragments) || Array.isArray(parsed.values);
  const hasTables = Array.isArray(parsed.logical_tables) || Array.isArray(parsed.document?.tables) || Array.isArray(parsed.model_parts) || Array.isArray(parsed.visual_layout?.parts) || Array.isArray(parsed.parts) && parsed.parts.some((part) => part?.kind === "cell" || part?.kind === "table");
  if (!hasParts) errors.push("Нет распознанных данных парсера (parts/model_parts/fragments/values/document.texts)");
  if (!hasTables) errors.push("Нет структуры таблиц/ячеек (logical_tables/document.tables/model_parts/parts)");
  return errors;
}

