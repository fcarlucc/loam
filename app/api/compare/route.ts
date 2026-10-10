import { isValidModelName } from "@/lib/catalog";
import { getDefaults, getKeepAlive } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { readNdjson } from "@/lib/ndjson";
import { type ChatChunk, loadedContextLength, OLLAMA_URL, ollamaError, toStats } from "@/lib/ollama";
import { KEEP_ALIVE_DEFAULT } from "@/lib/settings";
import type { ChatEvent } from "@/lib/types";

// One model's answer to a single prompt, streamed as NDJSON events like /api/chat, without saving anything.
// Uses the default settings for new chats (system prompt, temperature, context).
export async function POST(request: Request) {
  const { model, content } = await readJson(request);
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  if (typeof content !== "string" || !content.trim() || content.length > 20000) return jsonError("Invalid prompt", 400);

  const settings = getDefaults();
  const keepAlive = getKeepAlive();
  const options = {
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.contextLength !== undefined ? { num_ctx: settings.contextLength } : {}),
  };
  const messages = [
    ...(settings.system ? [{ role: "system", content: settings.system }] : []),
    { role: "user", content: content.trim() },
  ];

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(Object.keys(options).length ? { options } : {}),
        ...(keepAlive !== KEEP_ALIVE_DEFAULT ? { keep_alive: keepAlive } : {}),
      }),
      signal: request.signal, // the client stopped or left: stop Ollama too
    });
  } catch {
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
  if (!res.ok || !res.body) return jsonError(await ollamaError(res), 502);
  const source = res.body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        let last: ChatChunk | undefined;
        for await (const part of readNdjson<ChatChunk>(source)) {
          if (part.error) throw new Error(part.error);
          if (part.message?.content) send({ type: "delta", text: part.message.content });
          if (part.done) last = part;
        }
        send({ type: "done", stats: last ? toStats(last, (await loadedContextLength(model)) ?? settings.contextLength) : undefined });
        controller.close();
      } catch (e) {
        try {
          send({ type: "error", message: e instanceof Error ? e.message : "The reply was interrupted." });
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
