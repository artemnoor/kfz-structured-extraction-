export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const EXTRACTION_MODES = new Set(["rules_only", "llm_assisted", "compare"]);

export function mayReadDocument(document, userId) {
  return Boolean(document?.isDemo || (userId && document?.ownerId === userId));
}

export function mayRunLlm(document, allowlist = []) {
  if (document?.isDemo) return true;
  const permittedIds = Array.isArray(allowlist)
    ? allowlist.map(String)
    : String(allowlist ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return Boolean(document?.isSynthetic && document?.id && permittedIds.includes(String(document.id)));
}

export function requestMode(value) {
  return EXTRACTION_MODES.has(value) ? value : null;
}

export function contentLengthAllowed(request, actualByteLength, maxBytes = MAX_IMPORT_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return false;
  return actualByteLength <= maxBytes;
}

export async function readLimitedBody(request, maxBytes = MAX_IMPORT_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export function rateWindow(nowSeconds, windowSeconds) {
  return Math.floor(nowSeconds / windowSeconds) * windowSeconds;
}
