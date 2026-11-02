import { isValidModelName } from "@/lib/catalog";
import { engineFailure, resolveOllama } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";

// Downloads a model and relays Ollama's NDJSON progress. Closing the request aborts the download.
export async function POST(request: Request) {
  const body = await readJson(request);
  const { name } = body;
  if (typeof name !== "string" || !isValidModelName(name)) return jsonError("Invalid model name", 400);
  const engine = resolveOllama(body.engine);
  if (engine instanceof Response) return engine;

  let progress: ReadableStream<Uint8Array>;
  try {
    progress = await engine.pull!(name, request.signal);
  } catch (e) {
    return engineFailure(e);
  }
  return new Response(progress, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
