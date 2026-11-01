import { engineFailure, getEngine } from "@/lib/engines";
import { isEngineId } from "@/lib/engines/presets";
import { jsonError } from "@/lib/http";

// Tries the engine: answers { ok: true, version?, models } with the number of models it lists, or
// { ok: false, error } with what went wrong.
export async function POST(_req: Request, ctx: RouteContext<"/api/engines/[id]/test">) {
  const { id } = await ctx.params;
  if (!isEngineId(id)) return jsonError("Engine not found", 404);
  let engine;
  try {
    engine = getEngine(id);
  } catch (e) {
    return engineFailure(e);
  }
  try {
    const models = await engine.listModels();
    const { version } = await engine.status();
    return Response.json({ ok: true, ...(version ? { version } : {}), models: models.length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
  }
}
