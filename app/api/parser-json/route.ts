import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { ensureDemoDocuments } from "@/lib/storage";
// @ts-ignore Cloudflare Worker appends the .mjs module to the server bundle.
import { parserJsonShapeErrors } from "@/lib/extraction/structured-extraction.mjs";
// @ts-ignore Cloudflare Worker appends the .mjs module to the server bundle.
import { adaptDocumentParserResult } from "@/lib/parser/document-parser-adapter.mjs";

export async function POST(request: Request) {
  try {
    await ensureDemoDocuments();
    const body = await request.json() as { parser_json?: Record<string, any>; layout_json?: Record<string, any>; title?: string; file_name?: string };
    const rawParserJson = (body.parser_json ?? body) as Record<string, any>;
    const parserJson = body.layout_json ? { analysis_json: rawParserJson, layout_json: body.layout_json } : rawParserJson;
    const errors = parserJsonShapeErrors(parserJson);
    if (errors.length) return Response.json({ error: "Этот файл не похож на результат Document Parser", details: errors }, { status: 400 });
    const source = adaptDocumentParserResult(parserJson);
    const id = source.document_id;
    const db = getDb();
    const [existing] = await db.select({ id: documents.id, isDemo: documents.isDemo }).from(documents).where(eq(documents.id, id)).limit(1);
    if (existing?.isDemo) return Response.json({ error: "Этот ID уже занят демонстрационным документом. Измените document_id в импортируемом JSON." }, { status: 409 });
    const fileName = String(source.file_name ?? body.file_name ?? `${id}.json`);
    const format = String(source.format ?? fileName.split(".").pop() ?? "JSON").replace(/^\./, "").toUpperCase();
    const title = String(body.title ?? source.title ?? fileName);
    const row = { id, title, fileName, format, isDemo: false, parserJson: JSON.stringify(parserJson), updatedAt: new Date().toISOString() };
    if (existing) await db.update(documents).set(row).where(eq(documents.id, id));
    else await db.insert(documents).values(row);
    return Response.json({ document: { id, title, file_name: fileName, format, is_demo: false }, message: "Импортирован готовый JSON результата Document Parser без OCR и повторного распознавания" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось импортировать JSON";
    return Response.json({ error: message }, { status: 400 });
  }
}
