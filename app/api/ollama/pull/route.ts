import { isValidModelName } from "@/lib/catalog";
import { jsonError, readJson } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";

// Downloads a model and relays Ollama's NDJSON progress. Closing the request aborts the download.
export async function POST(request: Request) {
  const { name } = await readJson(request);
  if (typeof name !== "string" || !isValidModelName(name)) return jsonError("Invalid model name", 400);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, stream: true }),
      signal: request.signal,
    });
  } catch {
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
  if (!res.ok || !res.body) return jsonError(await ollamaError(res), 502);

  return new Response(res.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
