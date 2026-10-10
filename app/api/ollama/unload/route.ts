import { isValidModelName } from "@/lib/catalog";
import { jsonError, readJson } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";

// Frees the memory a model uses, without stopping Ollama.
export async function POST(request: Request) {
  const { model } = await readJson(request);
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return jsonError(await ollamaError(res), 502);
  } catch {
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
  return Response.json({ ok: true });
}
