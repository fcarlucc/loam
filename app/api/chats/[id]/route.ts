import { deleteChat, getChat, getPath, updateChat } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { parseSettings } from "@/lib/settings";

async function chatFrom(ctx: RouteContext<"/api/chats/[id]">) {
  const id = Number((await ctx.params).id);
  return Number.isSafeInteger(id) ? getChat(id) : undefined;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/chats/[id]">) {
  const chat = await chatFrom(ctx);
  if (!chat) return jsonError("Chat not found", 404);
  return Response.json({ chat, messages: getPath(chat.id) });
}

// Rename a chat and/or change its settings.
export async function PATCH(request: Request, ctx: RouteContext<"/api/chats/[id]">) {
  const chat = await chatFrom(ctx);
  if (!chat) return jsonError("Chat not found", 404);
  const body = await readJson(request);

  let title: string | undefined;
  if (body.title !== undefined) {
    title = typeof body.title === "string" ? Array.from(body.title.trim()).slice(0, 120).join("") : "";
    if (!title) return jsonError("Invalid title", 400);
  }
  const settings = body.settings === undefined ? undefined : parseSettings(body.settings);
  if (settings === null) return jsonError("Invalid settings", 400);
  if (title === undefined && settings === undefined) return jsonError("Nothing to update", 400);

  updateChat(chat.id, { title, settings });
  return Response.json({ chat: getChat(chat.id) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/chats/[id]">) {
  const chat = await chatFrom(ctx);
  if (!chat) return jsonError("Chat not found", 404);
  deleteChat(chat.id);
  return Response.json({ ok: true });
}
