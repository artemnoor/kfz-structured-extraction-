import { ensureDemoDocuments, getExtraction } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDemoDocuments();
    const { id } = await context.params;
    const extraction = await getExtraction(id);
    if (!extraction) return Response.json({ error: "Версия извлечения не найдена" }, { status: 404 });
    return Response.json({ extraction });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать извлечение";
    return Response.json({ error: message }, { status: 503 });
  }
}
