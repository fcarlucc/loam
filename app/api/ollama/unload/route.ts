import { isValidModelName } from "@/lib/catalog";
import { engineFailure, resolveOllama } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";

// Frees the memory a model uses, without stopping Ollama.
export async function POST(request: Request) {
  const body = await readJson(request);
  const { model } = body;
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  const engine = resolveOllama(body.engine);
  if (engine instanceof Response) return engine;
  try {
    await engine.unload!(model);
  } catch (e) {
    return engineFailure(e);
  }
  return Response.json({ ok: true });
}
