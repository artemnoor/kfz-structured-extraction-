import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents, extractionRuns } from "@/db/schema";
import { ensureDemoDocuments, getDocument } from "@/lib/storage";
// @ts-ignore Cloudflare Worker appends the .mjs module to the server bundle.
import { extractStructuredDocument } from "@/lib/extraction/structured-extraction.mjs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDemoDocuments();
    const { id } = await context.params;
    const document = await getDocument(id);
    if (!document) return Response.json({ error: "Документ не найден" }, { status: 404 });
    const result = extractStructuredDocument(document.parser_json, { version: document.extraction_version + 1 });
    const db = getDb();
    await db.insert(extractionRuns).values({
      id: result.extraction_id,
      documentId: id,
      version: result.version,
      documentType: result.document_type,
      schemaVersion: result.schema_version,
      payload: JSON.stringify(result),
    });
    await db.update(documents).set({ lastExtractionId: result.extraction_id, updatedAt: new Date().toISOString() }).where(eq(documents.id, id));
    return Response.json({ extraction: result, stored: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Structured Extraction завершился ошибкой";
    return Response.json({ error: message }, { status: 422 });
  }
}
