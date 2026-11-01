// Yields the `data:` payload of each event of a server-sent events stream (the OpenAI streaming format),
// ending at "[DONE]". Stopping early (break, throw) cancels the underlying stream.
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Events are separated by a blank line; the last, possibly incomplete, one waits for more bytes.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : (events.pop() ?? "");
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue; // a comment or another field
        if (data.trim() === "[DONE]") return;
        yield data;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
}
