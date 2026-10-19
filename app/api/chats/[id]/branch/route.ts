import { branchChat, getChat, getMessage } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { parseSettings } from "@/lib/settings";
import { branchTitle } from "@/lib/title";

// Starts a new chat from the branch ending at a message of this one (see branchChat); answers { chat }.
// The page sends the settings it shows, which may not be saved yet; without them the saved ones are used.
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[id]/branch">) {
  const id = Number((await ctx.params).id);
  const chat = Number.isSafeInteger(id) ? getChat(id) : undefined;
  if (!chat) return jsonError("Chat not found", 404);
  const body = await readJson(request);
  if (typeof body.messageId !== "number" || !getMessage(chat.id, body.messageId)) return jsonError("Message not found", 404);
  const settings = body.settings === undefined ? chat.settings : parseSettings(body.settings);
  if (!settings) return jsonError("Invalid settings", 400);
  const branchId = branchChat(chat.id, body.messageId, branchTitle(chat.title), settings);
  return Response.json({ chat: getChat(branchId) });
}
