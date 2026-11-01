import { isValidModelName } from "@/lib/catalog";
import { engineFailure, resolveOllama } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";

// Installed models of an Ollama engine (`engine` in the query, the built-in one by default): `models` is the
// list of names, `installed` the details for the models panel. Empty when it can't be reached.
export async function GET(request: Request) {
  const engine = resolveOllama(new URL(request.url).searchParams.get("engine") ?? undefined);
  if (engine instanceof Response) return engine;
  try {
    const installed = await engine.listModels();
    return Response.json({ models: installed.map((m) => m.name), installed });
  } catch {
    return Response.json({ models: [], installed: [] });
  }
}

// Deletes an installed model from disk.
export async function DELETE(request: Request) {
  const body = await readJson(request);
  const { model } = body;
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  const engine = resolveOllama(body.engine);
  if (engine instanceof Response) return engine;
  try {
    await engine.deleteModel!(model);
  } catch (e) {
    return engineFailure(e);
  }
  return Response.json({ ok: true });
}
