import { isValidModelName } from "@/lib/catalog";
import { engineFailure, resolveOllama } from "@/lib/engines";
import { jsonError } from "@/lib/http";

// What the settings and models panels need about a model: context window, default temperature, details.
// Same as /api/engines/[id]/show, for Ollama engines.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const model = params.get("model") ?? "";
  if (!isValidModelName(model)) return jsonError("Invalid model name", 400);
  const engine = resolveOllama(params.get("engine") ?? undefined);
  if (engine instanceof Response) return engine;
  try {
    return Response.json(await engine.modelInfo(model));
  } catch (e) {
    return engineFailure(e);
  }
}
