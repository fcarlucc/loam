import { isModelId } from "@/lib/catalog";
import { acceptsModel, engineFailure, resolveEngine } from "@/lib/engines";
import { jsonError } from "@/lib/http";

// What the settings panel needs about a model of this engine: context window, default temperature, what it can do.
export async function GET(request: Request, ctx: RouteContext<"/api/engines/[id]/show">) {
  const engine = resolveEngine((await ctx.params).id);
  if (engine instanceof Response) return engine;
  const model = new URL(request.url).searchParams.get("model") ?? "";
  if (!isModelId(model) || !acceptsModel(engine, model)) return jsonError("Invalid model name", 400);
  try {
    return Response.json(await engine.modelInfo(model));
  } catch (e) {
    return engineFailure(e);
  }
}
