import { inlineFiles, MAX_TOTAL_BYTES, parseAttachments } from "@/lib/attachments";
import { isModelId } from "@/lib/catalog";
import { getKeepAlive } from "@/lib/db";
import { acceptsModel, engineFailure, type ModelMessage, resolveEngine, type StreamEvent } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";
import { parseSettings } from "@/lib/settings";
import type { ChatEvent, NewAttachment, ReplyStats } from "@/lib/types";

const MAX_MESSAGES = 400;

type Turn = { role: "user" | "assistant"; content: string; attachments: NewAttachment[] };

// The conversation the page sent, checked: user and assistant messages, files on user messages only, and
// all files together within the limit of one message (they are sent again with every turn).
function parseConversation(value: unknown): Turn[] | { error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return { error: "Invalid request" };
  const turns: Turn[] = [];
  let bytes = 0;
  for (const item of value) {
    const m = item as { role?: unknown; content?: unknown; attachments?: unknown } | null;
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return { error: "Invalid request" };
    const attachments = parseAttachments(m.attachments);
    if (!Array.isArray(attachments)) return attachments;
    if (m.role === "assistant" && attachments.length) return { error: "Invalid request" };
    for (const a of attachments) bytes += a.kind === "image" ? Buffer.from(a.data, "base64").length : Buffer.byteLength(a.data);
    turns.push({ role: m.role, content: m.content.trim(), attachments });
  }
  if (bytes > MAX_TOTAL_BYTES) return { error: `This chat's files take more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together` };
  const last = turns.at(-1)!;
  if (last.role !== "user" || (!last.content && !last.attachments.length)) return { error: "Nothing to reply to" };
  return turns;
}

// A reply in a temporary chat. The page keeps the conversation and sends all of it, ending with the user
// message to answer; nothing is written here: no chat, no message, no file, nothing in the search index.
// Body: { engine, model, settings, messages: [{ role, content, attachments? }] }. The reply streams as
// NDJSON events like /api/chat's (see ChatEvent). Stopping it is cancelling the request.
export async function POST(request: Request) {
  const body = await readJson(request);
  const model = typeof body.model === "string" && isModelId(body.model) ? body.model : "";
  if (!model) return jsonError("Invalid request", 400);
  const turns = parseConversation(body.messages);
  if (!Array.isArray(turns)) return jsonError(turns.error, 400);
  const settings = parseSettings(body.settings);
  if (!settings) return jsonError("Invalid settings", 400);
  const engine = resolveEngine(body.engine);
  if (engine instanceof Response) return engine;
  if (!acceptsModel(engine, model)) return jsonError("Invalid request", 400);

  // As in a saved chat: images go to models that can see, and earlier ones are left out for the others.
  const capabilities = await engine.capabilities(model);
  const canSee = capabilities?.vision ?? true;
  if (!canSee && turns.at(-1)!.attachments.some((a) => a.kind === "image")) return jsonError(`${model} can't see images`, 400);
  const history: ModelMessage[] = turns.map(({ role, content, attachments }) => {
    const files = attachments.filter((a) => a.kind === "text").map((a) => ({ name: a.name, text: a.data }));
    const images = attachments.filter((a) => a.kind === "image").map((a) => ({ data: a.data, type: a.type }));
    return { role, content: inlineFiles(content, files), ...(canSee && images.length ? { images } : {}) };
  });
  const messages: ModelMessage[] = settings.system ? [{ role: "system", content: settings.system }, ...history] : history;

  const upstream = new AbortController();
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        let timings: ReplyStats | undefined;
        let thinkingFrom: number | undefined;
        let replyFrom: number | undefined;
        for await (const event of events) {
          if (event.type === "thinking") {
            thinkingFrom ??= Date.now();
            send({ type: "thinking", text: event.text });
          } else if (event.type === "content") {
            replyFrom ??= Date.now();
            send({ type: "delta", text: event.text });
          } else {
            timings = event.stats;
          }
        }
        const stats = timings && thinkingFrom !== undefined ? { ...timings, thinkingMs: (replyFrom ?? Date.now()) - thinkingFrom } : timings;
        send({ type: "done", stats });
        controller.close();
      } catch (e) {
        try {
          send({ type: "error", message: e instanceof Error ? e.message : "The reply was interrupted." });
          controller.close();
        } catch {
          // The page is gone.
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
