import { ensureDemoDocuments, getExtractionHistory } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDemoDocuments();
    const { id } = await context.params;
    return Response.json({ history: await getExtractionHistory(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать версии";
    return Response.json({ error: message }, { status: 503 });
  }
}
