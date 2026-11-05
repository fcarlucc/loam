import { inlineFiles } from "@/lib/attachments";
import { isModelId } from "@/lib/catalog";
import { chunkBudget, chunks, compactionRange, DEFAULT_CONTEXT, summaryPrompt } from "@/lib/compact";
import { attachmentContents, getChat, getKeepAlive, getMessage, getPath, setSummary } from "@/lib/db";
import { acceptsModel, engineFailure, type ModelMessage, resolveEngine } from "@/lib/engines";
import { generations } from "@/lib/generations";
import { jsonError, readJson } from "@/lib/http";
import { leastThinking } from "@/lib/settings";

const SUMMARY_MAX_TOKENS = 1024;

async function chatFrom(ctx: RouteContext<"/api/chats/[id]/compact">) {
  const id = Number((await ctx.params).id);
  return Number.isSafeInteger(id) ? getChat(id) : undefined;
}

// Chats being compacted right now: a second compaction of the same chat waits for the first.
const compacting = new Set<number>();

// Compacts the branch on screen: the model (the one the page names, usually the chat's) summarizes the
// messages before the latest exchange, and the summary is kept on the last of them (see lib/compact.ts).
// A long branch is summarized a piece at a time, each piece with the summary so far, so every request fits
// the model's context. Body: { engine, model, contextSize? }, contextSize being what the page knows of the
// model's context window. Answers { messages }, the branch now on screen.
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[id]/compact">) {
  const chat = await chatFrom(ctx);
  if (!chat) return jsonError("Chat not found", 404);
  const body = await readJson(request);
  const model = typeof body.model === "string" && isModelId(body.model) ? body.model : "";
  if (!model) return jsonError("Invalid request", 400);
  const engine = resolveEngine(body.engine);
  if (engine instanceof Response) return engine;
  if (!acceptsModel(engine, model)) return jsonError("Invalid request", 400);
  // The context the model reads: the page's value, else the chat's setting where the engine applies it. When
  // neither is known, the pieces are cut for DEFAULT_CONTEXT and the engine keeps its own context.
  const known: unknown = body.contextSize ?? (engine.supports.contextLength ? chat.settings.contextLength : undefined);
  if (known !== undefined && (typeof known !== "number" || !Number.isInteger(known) || known < 512 || known > 1_048_576)) {
    return jsonError("Invalid request", 400);
  }
  const contextSize = known ?? DEFAULT_CONTEXT;
  if (generations.has(chat.id)) return jsonError("Wait for the reply to finish", 409);
  if (compacting.has(chat.id)) return jsonError("This chat is already being compacted", 409);

  const path = getPath(chat.id);
  const range = compactionRange(path);
  if (!range) return jsonError("Nothing to compact yet", 400);
  const previous = range.start > 0 ? path[range.start - 1].summary : undefined;
  // What the model read of these messages: text files inside them, images counted.
  const covered: ModelMessage[] = path.slice(range.start, range.end + 1).map((m) => {
    if (!m.attachments?.length || m.id === undefined) return { role: m.role, content: m.content };
    const { files, images } = attachmentContents(m.id);
    return { role: m.role, content: inlineFiles(m.content, files), images };
  });

  compacting.add(chat.id);
  try {
    const summaryTokens = Math.min(SUMMARY_MAX_TOKENS, Math.floor(contextSize / 4));
    // A summary needs no reasoning: off, or the lowest level of a model that can't turn it off.
    const think = engine.supports.thinking ? leastThinking((await engine.modelInfo(model).catch(() => null))?.thinking?.values) : undefined;
    let summary = previous;
    try {
      for (const piece of chunks(covered, chunkBudget(contextSize, summaryTokens))) {
        const completion = await engine.complete({
          model,
          messages: [{ role: "user", content: summaryPrompt(summary, piece) }],
          maxTokens: summaryTokens,
          temperature: 0.2,
          think,
          // The context the pieces were cut for, so the engine doesn't load the model with a smaller one.
          contextLength: known,
          keepAlive: getKeepAlive(),
          signal: request.signal,
        });
        // A piece summarized into nothing would silently drop out of the summary: nothing is kept instead.
        summary = completion.content.trim();
        if (!summary) return jsonError("The model wrote no summary", 502);
      }
    } catch (e) {
      if (request.signal.aborted) return jsonError("Cancelled", 499);
      return engineFailure(e);
    }
    if (!summary) return jsonError("The model wrote no summary", 502);

    const last = path[range.end].id!;
    if (!getChat(chat.id) || !getMessage(chat.id, last)) return jsonError("Chat not found", 404); // deleted meanwhile
    setSummary(chat.id, last, summary);
    return Response.json({ messages: getPath(chat.id) });
  } finally {
    compacting.delete(chat.id);
  }
}

// Undoes a compaction: the model reads the messages again. Body: { messageId }, the message carrying the summary.
export async function DELETE(request: Request, ctx: RouteContext<"/api/chats/[id]/compact">) {
  const chat = await chatFrom(ctx);
  if (!chat) return jsonError("Chat not found", 404);
  const { messageId } = await readJson(request);
  if (typeof messageId !== "number" || !getMessage(chat.id, messageId)) return jsonError("Message not found", 404);
  setSummary(chat.id, messageId, null);
  return Response.json({ messages: getPath(chat.id) });
}
