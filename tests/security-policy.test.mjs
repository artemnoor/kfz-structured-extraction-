import test from "node:test";
import assert from "node:assert/strict";
import { MAX_IMPORT_BYTES, contentLengthAllowed, mayReadDocument, mayRunLlm, rateWindow, requestMode, readLimitedBody } from "../lib/security/policy.mjs";

test("document visibility and synthetic-only LLM policy are owner scoped", () => {
  const demo = { isDemo: true, isSynthetic: true, ownerId: null };
  const privateDoc = { isDemo: false, isSynthetic: true, ownerId: "user-a" };
  assert.equal(mayReadDocument(demo, null), true);
  assert.equal(mayReadDocument(privateDoc, null), false);
  assert.equal(mayReadDocument(privateDoc, "user-b"), false);
  assert.equal(mayReadDocument(privateDoc, "user-a"), true);
  assert.equal(mayRunLlm(demo), true);
  assert.equal(mayRunLlm(privateDoc), true);
  assert.equal(mayRunLlm({ isDemo: false, isSynthetic: false }), false);
});

test("API modes, request size limits and fixed rate windows are deterministic", () => {
  assert.equal(requestMode("rules_only"), "rules_only");
  assert.equal(requestMode("compare"), "compare");
  assert.equal(requestMode("rules"), null);
  const atLimit = new Request("https://example.test", { method: "POST", headers: { "content-length": String(MAX_IMPORT_BYTES) } });
  const tooLarge = new Request("https://example.test", { method: "POST", headers: { "content-length": String(MAX_IMPORT_BYTES + 1) } });
  assert.equal(contentLengthAllowed(atLimit, MAX_IMPORT_BYTES), true);
  assert.equal(contentLengthAllowed(tooLarge, MAX_IMPORT_BYTES + 1), false);
  assert.equal(rateWindow(1700000000, 60), Math.floor(1700000000 / 60) * 60);
});

test("streaming body reader rejects oversized bodies even without content-length", async () => {
  const request = new Request("https://example.test", { method: "POST", body: "12345" });
  assert.equal(await readLimitedBody(request, 4), null);
  const ok = new Request("https://example.test", { method: "POST", body: "1234" });
  assert.equal(await readLimitedBody(ok, 4), "1234");
});
