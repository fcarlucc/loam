import { randomUUID } from "node:crypto";
import { saveEngineRow } from "@/lib/db";
import { engineConfig, engineConfigs, remoteEnginesAllowed } from "@/lib/engines";
import { isEngineKind, parseEngineName, parseEngineUrl } from "@/lib/engines/presets";
import { jsonError, readJson } from "@/lib/http";

// The engines the app talks to (see lib/engines). GET lists them; POST adds one: { name, kind, baseUrl }.
export async function GET() {
  return Response.json({ engines: engineConfigs(), remoteAllowed: remoteEnginesAllowed() });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const name = parseEngineName(body.name);
  if (!name) return jsonError("Invalid name", 400);
  if (!isEngineKind(body.kind)) return jsonError("Invalid engine kind", 400);
  const url = parseEngineUrl(body.baseUrl, remoteEnginesAllowed());
  if ("error" in url) return jsonError(url.error, 400);
  const id = randomUUID();
  saveEngineRow({ id, name, kind: body.kind, base_url: url.baseUrl });
  return Response.json({ engine: engineConfig(id) }, { status: 201 });
}
