import { getChat, getKeepAlive, getPath, updateChat } from "@/lib/db";
import { engineFailure, resolveEngine } from "@/lib/engines";
import { jsonError } from "@/lib/http";
import { cleanTitle, isPlaceholderTitle, titlePrompt } from "@/lib/title";

// Has the chat's model name the chat from its first exchange; the page asks once the first reply is in.
// Nothing happens when the chat already has a title of its own (renamed by hand, or named earlier), or when
// models unload right after each reply, since naming the chat would load the model all over again.
// Answers { chat, named }.
export async function POST(_req: Request, ctx: RouteContext<"/api/chats/[id]/title">) {
  const id = Number((await ctx.params).id);
  const chat = Number.isSafeInteger(id) ? getChat(id) : undefined;
  if (!chat) return jsonError("Chat not found", 404);
  const branch = getPath(chat.id);
  const question = branch.find((m) => m.role === "user");
  if (!question) return jsonError("Nothing to title", 400);
  const answer = branch.find((m) => m.role === "assistant");
  const files = (question.attachments ?? []).map((a) => a.name);
  const keepAlive = getKeepAlive();
  // A message that was nothing but a file was titled after the file.
  if (!isPlaceholderTitle(chat.title, question.content || files[0] || "") || keepAlive === 0) return Response.json({ chat, named: false });
  const engine = resolveEngine(chat.engine);
  if (engine instanceof Response) return engine;

  // Reasoning off where there is any: a title isn't worth thinking about. The chat's system prompt stays
  // out too: a persona would get in the way of naming the conversation.
  let raw: string;
  try {
    const completion = await engine.complete({
      model: chat.model,
      messages: [{ role: "user", content: titlePrompt(question.content, answer?.content, files) }],
      maxTokens: 32,
      temperature: 0,
      think: false,
      keepAlive,
      signal: AbortSignal.timeout(60_000), // the model may have to load again
    });
    raw = completion.content;
  } catch (e) {
    return engineFailure(e);
  }
  const title = cleanTitle(raw);

  // Meanwhile the user may have renamed the chat (their title wins) or deleted it.
  const current = getChat(chat.id);
  if (!current) return jsonError("Chat not found", 404);
  if (!title || current.title !== chat.title) return Response.json({ chat: current, named: false });
  updateChat(chat.id, { title });
  return Response.json({ chat: getChat(chat.id), named: true });
}
