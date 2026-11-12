export async function GET() {
  return Response.json({ status: "ok", service: "kfz-structured-extraction", storage: "Cloudflare D1", parser: "demo JSON only", extraction: "enabled" });
}
