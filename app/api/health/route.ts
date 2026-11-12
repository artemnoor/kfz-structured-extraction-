import { env } from "cloudflare:workers";
// @ts-ignore Cloudflare Worker appends the .mjs module to the server bundle.
import { workersAiReadiness } from "@/lib/extraction/workers-ai.mjs";

export async function GET() {
  return Response.json({ status: "ok", service: "kfz-structured-extraction", storage: "Cloudflare D1", parser: "Document Parser JSON only", extraction: "hybrid-rules-and-workers-ai", llm: workersAiReadiness(env) });
}
