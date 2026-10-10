// Yields each object of a newline-delimited JSON stream (Ollama's streaming format).
// Stopping early (break, throw) cancels the underlying stream.
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as T;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
}
