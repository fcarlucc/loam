import { inlineFiles } from "@/lib/attachments";
import { isModelId } from "@/lib/catalog";
import { chunkBudget, chunks, compactionRange, summaryPrompt } from "@/lib/compact";
import { attachmentContents, getChat, getKeepAlive, getMessage, getPath, setSummary } from "@/lib/db";
import { acceptsModel, engineFailure, type ModelMessage, resolveEngine } from "@/lib/engines";
import { generations } from "@/lib/generations";
import { jsonError, readJson } from "@/lib/http";

const DEFAULT_CONTEXT = 4096; // when neither the page nor the chat's settings know the model's context
const SUMMARY_MAX_TOKENS = 1024;

async function chatFrom(ctx: RouteContext<"/api/chats/[id]/compact">) {
  const id = Number((await ctx.params).id);
  return Number.isSafeInteger(id) ? getChat(id) : undefined;
}

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
  const contextSize = body.contextSize ?? chat.settings.contextLength ?? DEFAULT_CONTEXT;
  if (!model || typeof contextSize !== "number" || !Number.isInteger(contextSize) || contextSize < 512 || contextSize > 1_048_576) {
    return jsonError("Invalid request", 400);
  }
  const engine = resolveEngine(body.engine);
  if (engine instanceof Response) return engine;
  if (!acceptsModel(engine, model)) return jsonError("Invalid request", 400);
  if (generations.has(chat.id)) return jsonError("Wait for the reply to finish", 409);

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

  const summaryTokens = Math.min(SUMMARY_MAX_TOKENS, Math.floor(contextSize / 4));
  let summary = previous;
  try {
    for (const piece of chunks(covered, chunkBudget(contextSize, summaryTokens))) {
      const completion = await engine.complete({
        model,
        messages: [{ role: "user", content: summaryPrompt(summary, piece) }],
        maxTokens: summaryTokens,
        temperature: 0.2,
        think: false,
        contextLength: chat.settings.contextLength,
        keepAlive: getKeepAlive(),
        signal: request.signal,
      });
      summary = completion.content.trim() || summary;
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
