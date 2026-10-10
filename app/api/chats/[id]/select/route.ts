import { getChat, getMessage, getPath, selectVersion } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";

// Shows another version of a message; returns the branch now on screen.
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[id]/select">) {
  const id = Number((await ctx.params).id);
  const chat = Number.isSafeInteger(id) ? getChat(id) : undefined;
  if (!chat) return jsonError("Chat not found", 404);
  const { messageId } = await readJson(request);
  if (typeof messageId !== "number" || !getMessage(chat.id, messageId)) return jsonError("Message not found", 404);
  selectVersion(chat.id, messageId);
  return Response.json({ messages: getPath(chat.id) });
}
