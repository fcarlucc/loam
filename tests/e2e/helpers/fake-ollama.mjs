// A stand-in for the Ollama server with the endpoints and response shapes the app uses. It needs no
// model and no memory, answers instantly and deterministically, and remembers every request, so the
// tests can check exactly what the app sent. The model name chooses the behaviour (see MODELS).
import { once } from "node:events";
import http from "node:http";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

export const MODELS = {
  "fake:latest": { size: 1_000_000_000 }, // answers at once (see echo)
  "slow:latest": { size: 2_000_000_000, words: 80, wordMs: 50 }, // a 4-second reply, for stop and disconnect tests
  "loading:latest": { size: 3_000_000_000, loadMs: 2500 }, // "loads the model" for 2.5 s before the first byte
  "flaky:latest": { size: 500_000_000, fails: true }, // accepts the request, then streams an error instead of text
  "thinker:latest": { size: 4_000_000_000, thinks: true }, // reasons out loud before replying, unless told not to (think: false)
  "seer:latest": { size: 5_000_000_000, sees: true }, // accepts images; the others refuse them like Ollama does
  "garbled:latest": { size: 600_000_000, garbles: true }, // streams a few words, then a line that isn't JSON
  "mute:latest": { size: 700_000_000, mute: true }, // answers a whole-reply request (title, summary) with nothing
  // Reasons at a level only, like gpt-oss: refuses think: false.
  "leveled:latest": { size: 800_000_000, thinks: true, levels: ["low", "medium", "high"] },
};
export const THINK_LEVEL_ERROR = "think value \"false\" is not supported for this model";
export const NO_VISION_ERROR = "Multimodal data provided, but model does not support multimodal requests.";
export const FLAKY_ERROR = "the fake model fell over";
export const THINKING_PREFIX = "Thinking about: ";
export const PULL_ERROR = "pull model manifest: file does not exist";
const DETAILS = { family: "fake", parameter_size: "1B", quantization_level: "Q4_0" };

// A user message containing <<say: text>> makes the "model" answer exactly that text, for tests that need a
// particular reply (a title, say).
const SAY = /<<say:\s*([\s\S]*?)\s*>>/;

// What the "model" answers: the last user message, then everything it was given, so a test can tell
// which branch of a conversation (and which system prompt) reached it.
export function echo(messages) {
  const users = messages.filter((m) => m.role === "user").map((m) => m.content);
  const system = messages.find((m) => m.role === "system")?.content;
  return `Echo: ${users.at(-1) ?? ""} :: users=${users.join(" | ")}${system ? ` :: system=${system}` : ""}`;
}

// Ollama lists untagged models as name:latest.
const withTag = (name) => (name.slice(name.lastIndexOf("/") + 1).includes(":") ? name : `${name}:latest`);

export async function startFakeOllama() {
  const installed = new Map(Object.entries(MODELS).map(([name, m]) => [name, { ...m }]));
  const loaded = new Map(); // model -> expires_at
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
    const notFound = (name) => json(404, { error: `model '${name}' not found` });
    const model = typeof body.model === "string" ? withTag(body.model) : "";
    const spec = installed.get(model);

    switch (`${req.method} ${req.url}`) {
      case "GET /api/version":
        return json(200, { version: "0.0.0-fake" });

      case "GET /api/tags":
        return json(200, {
          models: [...installed].map(([name, m]) => ({ name, model: name, size: m.size, modified_at: "2026-01-01T00:00:00Z", details: DETAILS })),
        });

      case "GET /api/ps":
        return json(200, {
          models: [...loaded].map(([name, expires]) => {
            const size = installed.get(name)?.size ?? 0;
            return { name, model: name, size, size_vram: size, expires_at: expires, context_length: 8192 };
          }),
        });

      case "POST /api/show":
        if (!spec) return notFound(body.model);
        return json(200, {
          model_info: { "general.architecture": "fake", "fake.context_length": 8192 },
          parameters: 'temperature 0.7\nstop "<end>"',
          capabilities: ["completion", ...(spec.thinks ? ["thinking"] : []), ...(spec.sees ? ["vision"] : [])],
          ...(spec.thinks ? { thinking: { values: spec.levels ?? [false, "low", "medium"], default: "medium" } } : {}),
          license: "FAKE LICENSE\nline 2\nline 3\nline 4 never shown",
          details: DETAILS,
        });

      case "POST /api/generate": // the app only uses it to unload a model (keep_alive: 0)
        if (!spec) return notFound(body.model);
        if (body.keep_alive === 0) loaded.delete(model);
        return json(200, { model, created_at: now(), response: "", done: true, done_reason: "unload" });

      case "DELETE /api/delete":
        if (!spec) return notFound(body.model);
        installed.delete(model);
        loaded.delete(model);
        return json(200, {});

      case "POST /api/pull": {
        const name = withTag(typeof body.model === "string" ? body.model : typeof body.name === "string" ? body.name : "");
        if (name.startsWith("missing")) return json(500, { error: PULL_ERROR });
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        const write = (obj) => {
          if (res.destroyed) return false;
          res.write(`${JSON.stringify(obj)}\n`);
          entry.chunks++;
          return true;
        };
        write({ status: "pulling manifest" });
        for (let done = 250_000; done <= 1_000_000; done += 250_000) {
          await sleep(40);
          if (!write({ status: "pulling sha256:abc", digest: "sha256:abc", total: 1_000_000, completed: done })) return;
        }
        write({ status: "verifying sha256 digest" });
        write({ status: "writing manifest" });
        if (!write({ status: "success" })) return;
        installed.set(name, { size: 1_000_000 });
        res.end();
        entry.finished = true;
        return;
      }

      case "POST /api/chat": {
        if (!spec) return notFound(body.model);
        if (!spec.sees && (body.messages ?? []).some((m) => m.images?.length)) return json(400, { error: NO_VISION_ERROR });
        if (spec.levels && body.think === false) return json(400, { error: THINK_LEVEL_ERROR });
        if (spec.loadMs) await sleep(spec.loadMs);
        if (res.destroyed) return; // the app gave up while the model was "loading"

        const scripted = SAY.exec((body.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? "")?.[1];
        const text = scripted ?? (spec.words ? Array.from({ length: spec.words }, (_, i) => `tick ${i + 1}`).join(" ") : echo(body.messages ?? []));
        const parts = text.match(/\S+\s*/g) ?? [text];
        const thought =
          spec.thinks && body.think !== false ? `${THINKING_PREFIX}${(body.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? ""}` : "";
        const thoughtParts = thought.match(/\S+\s*/g) ?? [];
        const keep = body.keep_alive ?? 300;
        if (keep === 0) loaded.delete(model);
        else loaded.set(model, new Date(Date.now() + (keep < 0 ? 100 * 365 * 24 : keep / 3600) * 3600 * 1000).toISOString());
        const timings = {
          total_duration: (spec.loadMs ?? 0) * 1e6 + 50e6 + 100e6 + parts.length * 20e6,
          load_duration: (spec.loadMs ?? 0) * 1e6 + 50e6,
          prompt_eval_count: Math.ceil(JSON.stringify(body.messages ?? []).length / 4),
          prompt_eval_duration: 100e6,
          eval_count: parts.length,
          eval_duration: parts.length * 20e6, // 50 tokens/s
        };

        if (body.stream === false) {
          return json(200, {
            model,
            created_at: now(),
            message: { role: "assistant", content: spec.mute ? "" : text, ...(thought ? { thinking: thought } : {}) },
            done: true,
            done_reason: "stop",
            ...timings,
          });
        }
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        const write = (obj) => {
          if (res.destroyed) return false;
          res.write(`${JSON.stringify(obj)}\n`);
          entry.chunks++;
          return true;
        };
        if (spec.fails) {
          write({ error: FLAKY_ERROR });
          res.end();
          entry.finished = true;
          return;
        }
        for (const part of thoughtParts) {
          if (!write({ model, created_at: now(), message: { role: "assistant", content: "", thinking: part }, done: false })) return;
        }
        for (const [i, part] of parts.entries()) {
          if (spec.wordMs) await sleep(spec.wordMs);
          if (spec.garbles && i === 3) {
            res.write("{ this is not json\n");
            res.end();
            entry.finished = true;
            return;
          }
          if (!write({ model, created_at: now(), message: { role: "assistant", content: part }, done: false })) return;
        }
        if (!write({ model, created_at: now(), message: { role: "assistant", content: "" }, done: true, done_reason: "stop", ...timings })) return;
        res.end();
        entry.finished = true;
        return;
      }

      default:
        return json(404, { error: `unknown endpoint ${req.method} ${req.url}` });
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
    installed,
    loaded,
    chats: () => requests.filter((r) => r.path === "/api/chat"),
    lastChat: () => requests.filter((r) => r.path === "/api/chat").at(-1),
    since: (n) => requests.slice(n), // requests made after `requests.length` was n
    pause: stopListening, // Ollama "stopped": connections are refused
    resume: listen,
    close: stopListening,
  };
}
