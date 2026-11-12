import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents, extractionRuns } from "@/db/schema";
import { demoDocumentRecord, demoParserResults } from "@/lib/parser/mock-document-parser";

export async function ensureDemoDocuments() {
  const db = getDb();
  const existing = await db.select({ id: documents.id }).from(documents).where(eq(documents.isDemo, true)).limit(1);
  if (existing.length) return;
  for (const parserJson of demoParserResults) {
    const record = demoDocumentRecord(parserJson);
    await db.insert(documents).values(record).onConflictDoNothing();
  }
}

export async function listDocuments() {
  const db = getDb();
  const rows = await db.select().from(documents).orderBy(asc(documents.isDemo), desc(documents.updatedAt), asc(documents.title));
  return Promise.all(rows.map(async (row) => {
    const [latest] = await db.select().from(extractionRuns).where(eq(extractionRuns.documentId, row.id)).orderBy(desc(extractionRuns.version)).limit(1);
    return {
      id: row.id,
      title: row.title,
      file_name: row.fileName,
      format: row.format,
      is_demo: Boolean(row.isDemo),
      parser_version: row.parserJson ? JSON.parse(row.parserJson).parser_output_version ?? "Document Parser" : null,
      page_count: row.parserJson ? JSON.parse(row.parserJson).page_count ?? null : null,
      latest_extraction: latest ? { id: latest.id, version: latest.version, document_type: latest.documentType, created_at: latest.createdAt } : null,
      updated_at: row.updatedAt,
    };
  }));
}

export async function getDocument(id: string) {
  const db = getDb();
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) return null;
  const [latest] = await db.select().from(extractionRuns).where(eq(extractionRuns.documentId, id)).orderBy(desc(extractionRuns.version)).limit(1);
  return {
    id: row.id,
    title: row.title,
    file_name: row.fileName,
    format: row.format,
    is_demo: Boolean(row.isDemo),
    parser_json: JSON.parse(row.parserJson),
    latest_extraction: latest ? JSON.parse(latest.payload) : null,
    extraction_version: latest?.version ?? 0,
  };
}

export async function getExtractionHistory(documentId: string) {
  const db = getDb();
  const rows = await db.select({ id: extractionRuns.id, version: extractionRuns.version, documentType: extractionRuns.documentType, schemaVersion: extractionRuns.schemaVersion, createdAt: extractionRuns.createdAt })
    .from(extractionRuns).where(eq(extractionRuns.documentId, documentId)).orderBy(desc(extractionRuns.version));
  return rows.map((row) => ({ id: row.id, version: row.version, document_type: row.documentType, schema_version: row.schemaVersion, created_at: row.createdAt }));
}

export async function getExtraction(extractionId: string) {
  const db = getDb();
  const [row] = await db.select().from(extractionRuns).where(eq(extractionRuns.id, extractionId)).limit(1);
  return row ? JSON.parse(row.payload) : null;
}

