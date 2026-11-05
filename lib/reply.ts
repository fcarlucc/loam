import { inlineFiles } from "./attachments";
import type { ModelMessage, StreamEvent } from "./engines";
import type { ChatEvent, ReplyStats } from "./types";

// What the chat routes share: how a message reaches the model, and how a reply streams back to the page.

// A message as the model gets it: text files inside it, images as images for models that can see. Engines
// refuse images on the others, so there they are left out: the model just doesn't see them.
export function modelMessage(
  role: ModelMessage["role"],
  content: string,
  files: { name: string; text: string }[],
  images: { data: string; type: string }[],
  canSee: boolean,
): ModelMessage {
  return { role, content: inlineFiles(content, files), ...(canSee && images.length ? { images } : {}) };
}

export type ReplyEnd = { text: string; thinking: string; stats?: ReplyStats };

// Streams an engine's reply to the page as NDJSON events (see ChatEvent): reasoning and text as they come,
// then "done" with the stats, or "error". `onEnd` runs once, however the reply ends: whole (with stats),
// cut by an error or a stop, or because the page left; `stopped` tells a stop by the user from an error, so
// the page still gets "done". `onFinally` runs when the stream is over (possibly more than once).
export function replyResponse(
  events: AsyncIterable<StreamEvent>,
  {
    upstream,
    headers = {},
    onEnd,
    stopped = () => false,
    onFinally,
  }: {
    upstream: AbortController; // aborted when the page leaves, which stops the engine
    headers?: Record<string, string>;
    onEnd?: (end: ReplyEnd) => void;
    stopped?: () => boolean;
    onFinally?: () => void;
  },
) {
  let text = "";
  let thinking = "";
  let ended = false;
  const end = (stats?: ReplyStats) => {
    if (ended) return;
    ended = true;
    onEnd?.({ text, thinking, stats });
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
            text += event.text;
            send({ type: "delta", text: event.text });
          } else {
            timings = event.stats;
          }
        }
        const endedAt = Date.now();
        const stats = timings && thinkingFrom !== undefined ? { ...timings, thinkingMs: (replyFrom ?? endedAt) - thinkingFrom } : timings;
        end(stats);
        send({ type: "done", stats });
        controller.close();
      } catch (e) {
        end();
        try {
          send(stopped() ? { type: "done" } : { type: "error", message: e instanceof Error ? e.message : "The reply was interrupted." });
          controller.close();
        } catch {
          // The page is gone.
        }
      } finally {
        onFinally?.();
      }
    },
    // The page disconnected: stop the engine, and end with what was generated so far.
    cancel() {
      upstream.abort();
      end();
      onFinally?.();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", ...headers } });
}
