import { inlineFiles, parseAttachments } from "@/lib/attachments";
import { isValidModelName } from "@/lib/catalog";
import {
  addAttachments,
  addMessage,
  attachmentContents,
  copyAttachments,
  createChat,
  DEFAULT_TITLE,
  getChat,
  getKeepAlive,
  getLeafId,
  getMessage,
  getPath,
  transaction,
  updateChat,
} from "@/lib/db";
import { engineFailure, type ModelMessage, resolveEngine, type StreamEvent } from "@/lib/engines";
import { generations } from "@/lib/generations";
import { jsonError, readJson } from "@/lib/http";
import { parseSettings } from "@/lib/settings";
import { makeTitle } from "@/lib/title";
import type { ChatEvent, ChatMessage, ReplyStats } from "@/lib/types";

// Streams a reply as NDJSON events (see ChatEvent). One of:
//   { content }                new message at the end of the branch on screen (chatId null starts a chat)
//   { content, editOf: id }    new version of a user message, then a reply to it
//   { regenerate: id }         new version of a reply
//   { retry: true }            reply to a user message that has none
// `engine` names the engine to use (the built-in Ollama when missing). Nothing is written until the engine
// accepts the request, so a failed send leaves no trace. A new chat is created at that point and its id is
// returned in the X-Chat-Id header.
export async function POST(request: Request) {
  const body = await readJson(request);
  const chatId = body.chatId ?? null;
  const model = typeof body.model === "string" && isValidModelName(body.model) ? body.model : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const editOf = body.editOf ?? null;
  const regenerate = body.regenerate ?? null;
  const retry = body.retry === true;
  const sending = typeof body.content === "string";
  const modes = [sending, regenerate !== null, retry].filter(Boolean).length;
  const attachments = parseAttachments(body.attachments);
  if (!Array.isArray(attachments)) return jsonError(attachments.error, 400);
  if (
    (chatId !== null && typeof chatId !== "number") ||
    (editOf !== null && (typeof editOf !== "number" || !sending)) ||
    (regenerate !== null && typeof regenerate !== "number") ||
    modes !== 1 ||
    !model ||
    // A message needs text or a file, and only a message can carry files.
    (sending ? !content && !attachments.length : attachments.length > 0)
  ) {
    return jsonError("Invalid request", 400);
  }
  const engine = resolveEngine(body.engine);
  if (engine instanceof Response) return engine;
  const chat = chatId === null ? undefined : getChat(chatId);
  if (chatId !== null && !chat) return jsonError("Chat not found", 404);
  if (!chat && (!sending || editOf !== null)) return jsonError("Invalid request", 400);
  // The client sends the settings it shows with every message; older clients fall back to the saved ones.
  const settings = body.settings === undefined ? (chat?.settings ?? {}) : parseSettings(body.settings);
  if (!settings) return jsonError("Invalid settings", 400);

  // Work out where the new message(s) go. Only the branch being continued is sent to the model.
  let userParent: number | null = null; // parent of the new user message (send / edit)
  let replyParent: number | null = null; // the user message the reply answers (regenerate / retry)
  if (chat && regenerate !== null) {
    const target = getMessage(chat.id, regenerate);
    if (target?.role !== "assistant" || target.parent_id === null) return jsonError("Not a reply of this chat", 400);
    replyParent = target.parent_id;
  } else if (chat && retry) {
    const leaf = getLeafId(chat.id);
    if (leaf === null || getMessage(chat.id, leaf)?.role !== "user") return jsonError("Nothing to reply to", 400);
    replyParent = leaf;
  } else if (chat && editOf !== null) {
    const target = getMessage(chat.id, editOf);
    if (target?.role !== "user") return jsonError("Not a message of this chat", 400);
    userParent = target.parent_id;
  } else if (chat) {
    userParent = getLeafId(chat.id);
  }
  const branchEnd = sending ? userParent : replyParent;
  // Files travel with their message on every turn: text inside the message, images as images for models
  // that can see. Engines refuse images on the others, so there they are left out: the model just doesn't
  // see them (the chat may have moved to another model since).
  const capabilities = await engine.capabilities(model);
  const canSee = capabilities?.vision ?? true; // unknown (engine unreachable, or one that can't tell): let the engine decide
  if (!canSee && attachments.some((a) => a.kind === "image")) return jsonError(`${model} can't see images`, 400);
  const toModelMessage = (m: Pick<ChatMessage, "id" | "role" | "content" | "attachments">): ModelMessage => {
    if (!m.attachments?.length || m.id === undefined) return { role: m.role, content: m.content };
    const { files, images } = attachmentContents(m.id);
    return { role: m.role, content: inlineFiles(m.content, files), ...(canSee && images.length ? { images } : {}) };
  };
  const history: ModelMessage[] = chat && branchEnd !== null ? getPath(chat.id, branchEnd).map(toModelMessage) : [];
  if (sending) {
    // An edit without new files keeps the files of the message it replaces (they are copied when it is saved).
    const kept = editOf !== null && !attachments.length ? attachmentContents(editOf) : undefined;
    const files = kept?.files ?? attachments.filter((a) => a.kind === "text").map((a) => ({ name: a.name, text: a.data }));
    const images = kept?.images ?? attachments.filter((a) => a.kind === "image").map((a) => ({ data: a.data, type: a.type }));
    history.push({ role: "user", content: inlineFiles(content, files), ...(canSee && images.length ? { images } : {}) });
  }
  if (history.at(-1)?.role !== "user") return jsonError("Nothing to reply to", 400);

  const messages: ModelMessage[] = settings.system ? [{ role: "system", content: settings.system }, ...history] : history;

  const upstream = new AbortController();
  // The client left (other chat, closed tab): stop the engine too, even while the model is still loading.
  request.signal.addEventListener("abort", () => upstream.abort());

  let events: AsyncIterable<StreamEvent>;
  try {
    events = await engine.chat({
      model,
      messages,
      temperature: settings.temperature,
      contextLength: settings.contextLength,
      think: settings.think,
      keepAlive: getKeepAlive(),
      signal: upstream.signal,
    });
  } catch (e) {
    return engineFailure(e);
  }

  const engineId = engine.config.id;
  const placeholder = makeTitle(content || attachments[0]?.name || ""); // until the model names the chat
  const { id, answering } = transaction(() => {
    const id = chat?.id ?? createChat(placeholder, engineId, model, settings);
    const answering = sending ? addMessage(id, "user", content, userParent) : replyParent!;
    // The files sent with the message; an edit without new files keeps those of the message it replaces.
    if (sending && attachments.length) addAttachments(answering, attachments);
    else if (sending && editOf !== null) copyAttachments(editOf, answering);
    const retitle = chat?.title === DEFAULT_TITLE && sending && editOf === null;
    updateChat(id, { engine: engineId, model, settings, ...(retitle ? { title: placeholder } : {}) });
    return { id, answering };
  });

  // The stop button ends the reply gracefully (see /api/chat/stop), so the client still gets a final event.
  let stoppedByUser = false;
  const stop = () => {
    stoppedByUser = true;
    upstream.abort();
  };
  generations.set(id, stop);
  const release = () => {
    if (generations.get(id) === stop) generations.delete(id);
  };

  let reply = "";
  let thinking = ""; // kept with the reply, shown under it, never sent back to the model
  let saved = false;
  const save = (stats?: ReplyStats) => {
    if (saved) return;
    saved = true;
    if (!reply) return; // nothing generated: a regenerated reply keeps its previous version on screen
    try {
      // Also keeps partial replies (without stats).
      addMessage(id, "assistant", reply, answering, { engine: engineId, model, stats, ...(thinking ? { thinking } : {}) });
    } catch {
      // The chat was deleted while the reply was streaming: nothing to keep.
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        let timings: ReplyStats | undefined;
        let thinkingFrom: number | undefined; // when the first thought arrived, and when the reply itself began
        let replyFrom: number | undefined;
        for await (const event of events) {
          if (event.type === "thinking") {
            thinkingFrom ??= Date.now();
            thinking += event.text;
            send({ type: "thinking", text: event.text });
          } else if (event.type === "content") {
            replyFrom ??= Date.now();
            reply += event.text;
            send({ type: "delta", text: event.text });
          } else {
            timings = event.stats;
          }
        }
        const endedAt = Date.now();
        const stats = timings && thinkingFrom !== undefined ? { ...timings, thinkingMs: (replyFrom ?? endedAt) - thinkingFrom } : timings;
        save(stats);
        send({ type: "done", stats });
        controller.close();
      } catch (e) {
        save();
        try {
          send(stoppedByUser ? { type: "done" } : { type: "error", message: e instanceof Error ? e.message : "The reply was interrupted." });
          controller.close();
        } catch {
          // The client is gone.
        }
      } finally {
        release();
      }
    },
    // The client disconnected: abort the engine and keep what was generated so far.
    cancel() {
      upstream.abort();
      save();
      release();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Chat-Id": String(id) },
  });
}
