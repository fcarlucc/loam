import { isModelId } from "@/lib/catalog";
import { getDefaults, getKeepAlive } from "@/lib/db";
import { acceptsModel, engineFailure, type ModelMessage, resolveEngine, type StreamEvent } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";
import type { ChatEvent } from "@/lib/types";

// One model's answer to a single prompt, streamed as NDJSON events like /api/chat, without saving anything.
// Uses the default settings for new chats (system prompt, temperature, context).
export async function POST(request: Request) {
  const { engine: engineId, model, content } = await readJson(request);
  if (typeof model !== "string" || !isModelId(model)) return jsonError("Invalid model name", 400);
  if (typeof content !== "string" || !content.trim() || content.length > 20000) return jsonError("Invalid prompt", 400);
  const engine = resolveEngine(engineId);
  if (engine instanceof Response) return engine;
  if (!acceptsModel(engine, model)) return jsonError("Invalid model name", 400);

  const settings = getDefaults();
  const messages: ModelMessage[] = [
    ...(settings.system ? [{ role: "system" as const, content: settings.system }] : []),
    { role: "user", content: content.trim() },
  ];

  let events: AsyncIterable<StreamEvent>;
  try {
    events = await engine.chat({
      model,
      messages,
      temperature: settings.temperature,
      contextLength: settings.contextLength,
      keepAlive: getKeepAlive(),
      signal: request.signal, // the client stopped or left: stop the engine too
    });
  } catch (e) {
    return engineFailure(e);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of events) {
          if (event.type === "content") send({ type: "delta", text: event.text });
          if (event.type === "done") send({ type: "done", stats: event.stats });
        }
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
