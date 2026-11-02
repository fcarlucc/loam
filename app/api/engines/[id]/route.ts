import { deleteEngineRow, saveEngineRow } from "@/lib/db";
import { engineConfig, remoteEnginesAllowed } from "@/lib/engines";
import { isEngineId, parseEngineName, parseEngineUrl } from "@/lib/engines/presets";
import { jsonError, readJson } from "@/lib/http";

async function configFrom(ctx: RouteContext<"/api/engines/[id]">) {
  const { id } = await ctx.params;
  return isEngineId(id) ? engineConfig(id) : undefined;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/engines/[id]">) {
  const config = await configFrom(ctx);
  if (!config) return jsonError("Engine not found", 404);
  return Response.json({ engine: config });
}

// Renames an engine and/or changes its URL (its kind can't change: chats remember the engine by id).
export async function PATCH(request: Request, ctx: RouteContext<"/api/engines/[id]">) {
  const config = await configFrom(ctx);
  if (!config) return jsonError("Engine not found", 404);
  const body = await readJson(request);
  const name = body.name === undefined ? config.name : parseEngineName(body.name);
  if (!name) return jsonError("Invalid name", 400);
  const url = body.baseUrl === undefined ? { baseUrl: config.baseUrl } : parseEngineUrl(body.baseUrl, remoteEnginesAllowed());
  if ("error" in url) return jsonError(url.error, 400);
  if (body.name === undefined && body.baseUrl === undefined) return jsonError("Nothing to update", 400);
  saveEngineRow({ id: config.id, name, kind: config.kind, base_url: url.baseUrl });
  return Response.json({ engine: engineConfig(config.id) });
}

// Removes an engine the user added. The built-in Ollama stays: it is the app's default.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/engines/[id]">) {
  const config = await configFrom(ctx);
  if (!config) return jsonError("Engine not found", 404);
  if (config.builtin) return jsonError("The built-in Ollama can't be removed", 400);
  deleteEngineRow(config.id);
  return Response.json({ ok: true });
}
