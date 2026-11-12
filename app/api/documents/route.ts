import { ensureDemoDocuments, listDocuments } from "@/lib/storage";

export async function GET() {
  try {
    await ensureDemoDocuments();
    return Response.json({ documents: await listDocuments(), storage: "Cloudflare D1" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать хранилище";
    return Response.json({ error: message, hint: "Проверьте, что миграции D1 применены." }, { status: 503 });
  }
}
