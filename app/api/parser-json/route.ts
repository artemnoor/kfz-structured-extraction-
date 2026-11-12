import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { ensureDemoDocuments } from "@/lib/storage";
// @ts-ignore Cloudflare Worker appends the .mjs module to the server bundle.
import { parserJsonShapeErrors } from "@/lib/extraction/structured-extraction.mjs";

export async function POST(request: Request) {
  try {
    await ensureDemoDocuments();
    const body = await request.json() as { parser_json?: Record<string, any>; title?: string; file_name?: string };
    const parserJson = (body.parser_json ?? body) as Record<string, any>;
    const errors = parserJsonShapeErrors(parserJson);
    if (errors.length) return Response.json({ error: "Этот файл не похож на результат Document Parser", details: errors }, { status: 400 });
    const id = String(parserJson.document_id ?? parserJson.document?.name);
    const db = getDb();
    const [existing] = await db.select({ id: documents.id, isDemo: documents.isDemo }).from(documents).where(eq(documents.id, id)).limit(1);
    if (existing?.isDemo) return Response.json({ error: "Этот ID уже занят демонстрационным документом. Измените document_id в импортируемом JSON." }, { status: 409 });
    const fileName = String(body.file_name ?? parserJson.file_name ?? parserJson.document?.origin?.filename ?? `${id}.json`);
    const format = String(parserJson.format ?? parserJson.source_extension ?? fileName.split(".").pop() ?? "JSON").replace(/^\./, "").toUpperCase();
    const title = String(body.title ?? parserJson.title ?? fileName);
    const row = { id, title, fileName, format, isDemo: false, parserJson: JSON.stringify(parserJson), updatedAt: new Date().toISOString() };
    if (existing) await db.update(documents).set(row).where(eq(documents.id, id));
    else await db.insert(documents).values(row);
    return Response.json({ document: { id, title, file_name: fileName, format, is_demo: false }, message: "Импортирован только готовый JSON результата парсера" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось импортировать JSON";
    return Response.json({ error: message }, { status: 400 });
  }
}
