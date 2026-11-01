// A stand-in for an OpenAI-compatible local server (LM Studio, llama.cpp, MLX) with the endpoints and
// response shapes the app uses: GET /v1/models and POST /v1/chat/completions, streamed as server-sent
// events. Like fake-ollama.mjs it needs no model, answers at once and deterministically, and remembers
// every request. The model name chooses the behaviour (see OPENAI_MODELS).
import { once } from "node:events";
import http from "node:http";
import { echo } from "./fake-ollama.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const OPENAI_MODELS = {
  "fake-7b": {}, // answers at once (see echo)
  "slow-7b": { words: 80, wordMs: 50 }, // a 4-second reply, for stop and disconnect tests
  "loading-7b": { loadMs: 2500 }, // "loads the model" for 2.5 s before the first byte
  "flaky-7b": { fails: true }, // accepts the request, then streams an error instead of text
  "thinker-7b": { thinks: true }, // sends its reasoning as reasoning_content before the reply
  "seer-7b": { sees: true }, // accepts image parts; the others refuse them
  "garbled-7b": { garbles: true }, // streams a few words, then something that isn't JSON
};
export const NO_VISION_ERROR = "This model does not support image input.";
export const FLAKY_ERROR = "the fake server fell over";
export const THINKING_PREFIX = "Thinking about: ";
export const CONTEXT_LENGTH = 4096;

// A user message containing <<say: text>> makes the "model" answer exactly that text.
const SAY = /<<say:\s*([\s\S]*?)\s*>>/;

// The text of a message whose content may be a string or a list of parts (text and images).
export const textOf = (m) => (typeof m.content === "string" ? m.content : (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join(""));
export const imagesOf = (m) => (typeof m.content === "string" ? [] : (m.content ?? []).filter((p) => p.type === "image_url").map((p) => p.image_url?.url ?? ""));

export async function startFakeOpenAI() {
  const models = new Map(Object.entries(OPENAI_MODELS));
  const requests = []; // { method, path, body, at, aborted, chunks, finished }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}
    const entry = { method: req.method, path: req.url, body, at: Date.now(), aborted: false, chunks: 0, finished: false };
    requests.push(entry);
    res.on("error", () => {});
    res.on("close", () => {
      if (!res.writableFinished) entry.aborted = true;
    });
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      entry.finished = true;
    };
    const failure = (status, message, type = "invalid_request_error") => json(status, { error: { message, type, code: null } });

    switch (`${req.method} ${req.url}`) {
      case "GET /v1/models":
        return json(200, {
          object: "list",
          data: [...models.keys()].map((id) => ({ id, object: "model", owned_by: "fake", meta: { n_ctx_train: CONTEXT_LENGTH } })),
        });

      case "POST /v1/chat/completions": {
        const model = typeof body.model === "string" ? body.model : "";
        const spec = models.get(model);
        if (!spec) return failure(404, `model '${model}' not found`, "not_found_error");
        const messages = body.messages ?? [];
        const texts = messages.map((m) => ({ role: m.role, content: textOf(m) }));
        if (!spec.sees && messages.some((m) => imagesOf(m).length)) return failure(400, NO_VISION_ERROR);
        if (spec.loadMs) await sleep(spec.loadMs);
        if (res.destroyed) return; // the app gave up while the model was "loading"

        const lastUser = texts.filter((m) => m.role === "user").at(-1)?.content ?? "";
        const scripted = SAY.exec(lastUser)?.[1];
        const text = scripted ?? (spec.words ? Array.from({ length: spec.words }, (_, i) => `tick ${i + 1}`).join(" ") : echo(texts));
        const parts = text.match(/\S+\s*/g) ?? [text];
        const thought = spec.thinks ? `${THINKING_PREFIX}${lastUser}` : "";
        const thoughtParts = thought.match(/\S+\s*/g) ?? [];
        const usage = { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4), completion_tokens: parts.length, total_tokens: 0 };
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        const id = `chatcmpl-${requests.length}`;
        const created = Math.floor(Date.now() / 1000);

        if (body.stream !== true) {
          return json(200, {
            id,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message: { role: "assistant", content: text, ...(thought ? { reasoning_content: thought } : {}) }, finish_reason: "stop" }],
            usage,
          });
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const write = (line) => {
          if (res.destroyed) return false;
          res.write(`data: ${line}\n\n`);
          entry.chunks++;
          return true;
        };
        const chunk = (delta, finish = null) =>
          write(JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] }));
        if (spec.fails) {
          write(JSON.stringify({ error: { message: FLAKY_ERROR, type: "server_error" } }));
          res.end();
          entry.finished = true;
          return;
        }
        chunk({ role: "assistant", content: "" });
        for (const part of thoughtParts) if (!chunk({ reasoning_content: part })) return;
        for (const [i, part] of parts.entries()) {
          if (spec.wordMs) await sleep(spec.wordMs);
          if (spec.garbles && i === 3) {
            write("{ this is not json");
            res.end();
            entry.finished = true;
            return;
          }
          if (!chunk({ content: part })) return;
        }
        if (!chunk({}, "stop")) return;
        if (body.stream_options?.include_usage) write(JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage }));
        write("[DONE]");
        res.end();
        entry.finished = true;
        return;
      }

      default:
        return failure(404, `unknown endpoint ${req.method} ${req.url}`);
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const listen = async () => {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  };
  const stopListening = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    models,
    chats: () => requests.filter((r) => r.path === "/v1/chat/completions"),
    lastChat: () => requests.filter((r) => r.path === "/v1/chat/completions").at(-1),
    since: (n) => requests.slice(n), // requests made after `requests.length` was n
    pause: stopListening, // the server "stopped": connections are refused
    resume: listen,
    close: stopListening,
  };
}
