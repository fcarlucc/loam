import { isHomebrewOllamaUrl } from "./presets";
import { engineFetch } from "./fetch";
import { KEEP_ALIVE_DEFAULT, isThinkValue } from "../settings";
import { readNdjson } from "../ndjson";
import type { EngineConfig, InstalledModel, LoadedModel, ModelInfo, ReplyStats } from "../types";
import { type ChatRequest, type Completion, type Engine, EngineError, type EngineFeatures, type ModelCapabilities, type StreamEvent } from "./types";

// Ollama, through its own API (/api/chat, /api/tags, /api/show, ...). The only engine that manages models:
// downloads, deletion, memory, and the keep-alive and reasoning settings.

// One line of Ollama's streamed /api/chat response.
type ChatChunk = {
  message?: { content?: string; thinking?: string };
  error?: string;
  done?: boolean;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number; // includes tokens reused from the cache
  prompt_eval_duration?: number;
  load_duration?: number;
  total_duration?: number;
};

type TagsResponse = {
  models?: { name: string; size: number; modified_at: string; details?: { parameter_size?: string; quantization_level?: string } }[];
};

type PsResponse = {
  models?: { name: string; size: number; size_vram?: number; expires_at?: string; context_length?: number }[];
};

type ShowResponse = {
  model_info?: Record<string, unknown>;
  parameters?: string;
  capabilities?: string[];
  thinking?: { values?: unknown[]; default?: unknown }; // newer Ollama versions: what `think` accepts
  license?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
};

const perSecond = (count = 0, ns = 0) => (ns > 0 ? Math.round((count / (ns / 1e9)) * 10) / 10 : 0);

// Ollama's timings from the final chunk, as shown under a reply.
export function toStats(c: ChatChunk, contextSize: number | undefined): ReplyStats {
  const tokens = c.eval_count ?? 0;
  const promptTokens = c.prompt_eval_count ?? 0;
  return {
    tokens,
    tokensPerSecond: perSecond(tokens, c.eval_duration),
    promptTokens,
    loadMs: Math.round((c.load_duration ?? 0) / 1e6),
    totalMs: Math.round((c.total_duration ?? 0) / 1e6),
    contextUsed: promptTokens + tokens,
    ...(contextSize ? { contextSize } : {}),
  };
}

// Capabilities of each model (/api/show), remembered for a while: the chat route needs them on every
// message of a chat that sets the reasoning. Keyed by engine and model, since two engines may share a name.
const capabilityCache = new Map<string, { at: number; list: string[] }>();

export const OLLAMA_FEATURES: EngineFeatures = {
  pull: true,
  delete: true,
  loaded: true,
  unload: true,
  power: true,
  keepAlive: true,
  contextLength: true,
  thinking: true,
};

export class OllamaEngine implements Engine {
  readonly supports: EngineFeatures;

  constructor(readonly config: EngineConfig) {
    // Starting and stopping runs `brew services`, which manages the one Ollama at the default address: only the
    // built-in engine pointing there can use it, never another Ollama (it would start or stop the wrong one).
    this.supports = { ...OLLAMA_FEATURES, power: config.builtin && isHomebrewOllamaUrl(config.baseUrl) };
  }

  private url(path: string) {
    return `${this.config.baseUrl}${path}`;
  }

  private unreachable() {
    return new EngineError(`Cannot reach ${this.config.name}. Is it running?`, 502);
  }

  // Turns a failed Ollama response into a readable message.
  private async failure(res: Response, status = 502) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    return new EngineError(detail?.error ?? `${this.config.name} returned ${res.status}`, status);
  }

  private async post(path: string, body: unknown, init: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    try {
      return await engineFetch(this.url(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: init.signal ?? (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined),
      });
    } catch {
      throw this.unreachable();
    }
  }

  async status() {
    const host = new URL(this.config.baseUrl).host;
    try {
      // A stopped server refuses the connection at once; the timeout only covers a busy one (e.g. loading a model).
      const res = await engineFetch(this.url("/api/version"), { signal: AbortSignal.timeout(3000), cache: "no-store" });
      if (!res.ok) return { running: false, host };
      const data = (await res.json()) as { version?: string };
      return { running: true, version: data.version, host };
    } catch {
      return { running: false, host };
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    let res: Response;
    try {
      res = await engineFetch(this.url("/api/tags"), { signal: AbortSignal.timeout(2000), cache: "no-store" });
    } catch {
      throw this.unreachable();
    }
    if (!res.ok) throw await this.failure(res);
    const data = (await res.json()) as TagsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name,
      bytes: m.size,
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
    }));
  }

  // The capability list as Ollama names it ("vision", "thinking", "tools", ...), or undefined when it can't be
  // read (Ollama unreachable, unknown model): then Ollama itself decides what the model accepts.
  private async capabilityList(model: string): Promise<string[] | undefined> {
    const key = `${this.config.id}\n${model}`;
    const hit = capabilityCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
    try {
      const res = await this.post("/api/show", { model }, { timeoutMs: 3000 });
      if (!res.ok) return undefined;
      const list = ((await res.json()) as { capabilities?: string[] }).capabilities ?? [];
      capabilityCache.set(key, { at: Date.now(), list });
      return list;
    } catch {
      return undefined;
    }
  }

  async capabilities(model: string): Promise<ModelCapabilities | undefined> {
    const list = await this.capabilityList(model);
    return list && { vision: list.includes("vision"), tools: list.includes("tools"), thinking: list.includes("thinking") };
  }

  async modelInfo(model: string): Promise<ModelInfo> {
    const res = await this.post("/api/show", { model }, { timeoutMs: 3000 });
    if (!res.ok) throw await this.failure(res);
    const data = (await res.json()) as ShowResponse;
    const contextKey = Object.keys(data.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const contextMax = Number(contextKey ? data.model_info?.[contextKey] : NaN);
    const temperature = Number(/^temperature\s+([\d.]+)/m.exec(data.parameters ?? "")?.[1] ?? NaN);
    // Older Ollama versions only list the capability: then reasoning is on or off, and on unless told otherwise.
    const thinkDefault = data.thinking?.default;
    return {
      contextMax: Number.isFinite(contextMax) ? contextMax : null,
      temperature: Number.isFinite(temperature) ? temperature : null,
      capabilities: data.capabilities ?? [],
      thinking: data.capabilities?.includes("thinking")
        ? { values: (data.thinking?.values ?? [false, true]).filter(isThinkValue), default: isThinkValue(thinkDefault) ? thinkDefault : true }
        : null,
      family: data.details?.family ?? null,
      parameterSize: data.details?.parameter_size ?? null,
      quantization: data.details?.quantization_level ?? null,
      license: data.license ? data.license.trim().split("\n").slice(0, 3).join(" ").slice(0, 200) : null,
    };
  }

  // Context window of a model currently loaded in memory, as Ollama reports it.
  private async loadedContextLength(model: string) {
    try {
      const res = await engineFetch(this.url("/api/ps"), { signal: AbortSignal.timeout(1000), cache: "no-store" });
      const { models } = (await res.json()) as PsResponse;
      return models?.find((m) => m.name === model)?.context_length;
    } catch {
      return undefined;
    }
  }

  // The body of /api/chat: only what the request sets, so Ollama applies its own defaults for the rest.
  private async chatBody(request: ChatRequest, stream: boolean) {
    const options = {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.contextLength !== undefined ? { num_ctx: request.contextLength } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
    };
    // Reasoning off, on or at a level, only for models that can reason: Ollama refuses `think` on the others.
    const think = request.think !== undefined && (await this.capabilityList(request.model))?.includes("thinking") ? request.think : undefined;
    return {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}) })),
      stream,
      ...(Object.keys(options).length ? { options } : {}),
      ...(think !== undefined ? { think } : {}),
      // Ollama's own default isn't sent at all.
      ...(request.keepAlive !== undefined && request.keepAlive !== KEEP_ALIVE_DEFAULT ? { keep_alive: request.keepAlive } : {}),
    };
  }

  async chat(request: ChatRequest): Promise<AsyncIterable<StreamEvent>> {
    const res = await this.post("/api/chat", await this.chatBody(request, true), { signal: request.signal });
    if (!res.ok || !res.body) throw await this.failure(res);
    return this.events(res.body, request);
  }

  private async *events(source: ReadableStream<Uint8Array>, request: ChatRequest): AsyncGenerator<StreamEvent> {
    let last: ChatChunk | undefined;
    for await (const part of readNdjson<ChatChunk>(source)) {
      if (part.error) throw new Error(part.error);
      if (part.message?.thinking) yield { type: "thinking", text: part.message.thinking };
      if (part.message?.content) yield { type: "content", text: part.message.content };
      if (part.done) last = part;
    }
    // Without a final chunk (the stream ended early) the reply has no stats, like a stopped one.
    yield { type: "done", ...(last ? { stats: toStats(last, (await this.loadedContextLength(request.model)) ?? request.contextLength) } : {}) };
  }

  async complete(request: ChatRequest): Promise<Completion> {
    const res = await this.post("/api/chat", await this.chatBody(request, false), { signal: request.signal });
    if (!res.ok) throw await this.failure(res);
    const data = (await res.json()) as ChatChunk;
    if (data.error) throw new EngineError(data.error, 502);
    return {
      content: data.message?.content ?? "",
      ...(data.message?.thinking ? { thinking: data.message.thinking } : {}),
      stats: toStats(data, request.contextLength),
      promptPerSecond: perSecond(data.prompt_eval_count, data.prompt_eval_duration),
    };
  }

  // Downloads a model and relays Ollama's NDJSON progress. Aborting the signal cancels the download.
  async pull(model: string, signal: AbortSignal) {
    const res = await this.post("/api/pull", { model, stream: true }, { signal });
    if (!res.ok || !res.body) throw await this.failure(res);
    return res.body;
  }

  async deleteModel(model: string) {
    let res: Response;
    try {
      res = await engineFetch(this.url("/api/delete"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw this.unreachable();
    }
    if (!res.ok) throw await this.failure(res, res.status === 404 ? 404 : 502);
  }

  async loadedModels(): Promise<LoadedModel[]> {
    let res: Response;
    try {
      res = await engineFetch(this.url("/api/ps"), { signal: AbortSignal.timeout(2000), cache: "no-store" });
    } catch {
      throw this.unreachable();
    }
    if (!res.ok) throw await this.failure(res);
    const data = (await res.json()) as PsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name,
      bytes: m.size,
      gpuBytes: m.size_vram ?? 0,
      expiresAt: m.expires_at ?? null,
      contextLength: m.context_length ?? null,
    }));
  }

  // Frees the memory a model uses, without stopping Ollama.
  async unload(model: string, signal?: AbortSignal) {
    const res = await this.post("/api/generate", { model, keep_alive: 0 }, signal ? { signal } : { timeoutMs: 10000 });
    if (!res.ok) throw await this.failure(res);
  }
}
