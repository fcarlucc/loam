import { getDefaults, getKeepAlive, setDefaults, setKeepAlive } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { isKeepAlive, parseSettings } from "@/lib/settings";

// App-wide settings: what new chats start with, and how long models stay in memory.
export async function GET() {
  return Response.json({ defaults: getDefaults(), keepAlive: getKeepAlive() });
}

export async function PUT(request: Request) {
  const body = await readJson(request);
  const defaults = body.defaults === undefined ? undefined : parseSettings(body.defaults);
  if (defaults === null) return jsonError("Invalid settings", 400);
  if (body.keepAlive !== undefined && !isKeepAlive(body.keepAlive)) return jsonError("Invalid keep-alive", 400);
  if (defaults === undefined && body.keepAlive === undefined) return jsonError("Nothing to update", 400);
  if (defaults) setDefaults(defaults);
  if (isKeepAlive(body.keepAlive)) setKeepAlive(body.keepAlive);
  return Response.json({ defaults: getDefaults(), keepAlive: getKeepAlive() });
}
