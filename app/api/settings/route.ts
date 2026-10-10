import { getDefaults, setDefaults } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { parseSettings } from "@/lib/settings";

// Settings that new chats start with.
export async function GET() {
  return Response.json({ defaults: getDefaults() });
}

export async function PUT(request: Request) {
  const defaults = parseSettings((await readJson(request)).defaults);
  if (!defaults) return jsonError("Invalid settings", 400);
  setDefaults(defaults);
  return Response.json({ defaults });
}
