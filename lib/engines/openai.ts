import type { EngineConfig, InstalledModel, ModelInfo, ReplyStats } from "../types";
import { readSse } from "./sse";
import { type ChatRequest, type Completion, type Engine, EngineError, type EngineFeatures, type ModelCapabilities, type StreamEvent } from "./types";

// Any server that speaks the OpenAI chat API: LM Studio, llama.cpp's llama-server, MLX's mlx_lm.server, ...
// Models are listed with GET /models and replies come from POST /chat/completions as server-sent events.
// These servers load models on their own, so there is nothing to download, delete or unload here, and the
// per-chat context length, keep-alive and reasoning settings don't apply (the server decides them).

type ListedModel = { id: string; meta?: { n_ctx_train?: number } }; // `meta` is llama.cpp's
type Usage = { prompt_tokens?: number; completion_tokens?: number };
// llama.cpp adds its timings to the last chunk; other servers only send `usage`.
type Timings = { prompt_ms?: number; predicted_ms?: number; prompt_per_second?: number; predicted_per_second?: number };
type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
type Chunk = { choices?: { delta?: Delta; message?: Delta; finish_reason?: string | null }[]; usage?: Usage | null; timings?: Timings; error?: unknown };

export const OPENAI_FEATURES: EngineFeatures = {
  pull: false,
  delete: false,
  loaded: false,
  unload: false,
  power: false,
  keepAlive: false,
  contextLength: false,
  thinking: false,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// The error message of a failed response, whichever of the usual shapes the server uses.
function errorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { error, message } = data as { error?: unknown; message?: unknown };
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return typeof message === "string" ? message : undefined;
}

export class OpenAIEngine implements Engine {
  readonly supports = OPENAI_FEATURES;

  constructor(readonly config: EngineConfig) {}

  private url(path: string) {
    return `${this.config.baseUrl}${path}`;
  }

  private unreachable() {
    return new EngineError(`Cannot reach ${this.config.name}. Is it running?`, 502);
  }

  private async failure(res: Response) {
    const data: unknown = await res.json().catch(() => null);
    return new EngineError(errorMessage(data) ?? `${this.config.name} returned ${res.status}`, 502);
  }

  private async listed(timeoutMs: number): Promise<ListedModel[]> {
    let res: Response;
    try {
      res = await fetch(this.url("/models"), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    } catch {
      throw this.unreachable();
    }
    if (!res.ok) throw await this.failure(res);
    const data = (await res.json()) as { data?: ListedModel[] };
    return (data.data ?? []).filter((m) => typeof m.id === "string");
  }

  async status() {
    const host = new URL(this.config.baseUrl).host;
    try {
      await this.listed(3000);
      return { running: true, host };
    } catch {
      return { running: false, host };
    }
  }

  async listModels(): Promise<InstalledModel[]> {
    return (await this.listed(2000)).map((m) => ({ name: m.id, bytes: null, modifiedAt: null, parameterSize: null, quantization: null }));
  }

  // The OpenAI API doesn't say what a model can do: images are sent to it and it may refuse them.
  async capabilities(): Promise<ModelCapabilities | undefined> {
    return undefined;
  }

  async modelInfo(model: string): Promise<ModelInfo> {
    const entry = (await this.listed(3000)).find((m) => m.id === model);
    const contextMax = entry?.meta?.n_ctx_train;
    return {
      contextMax: typeof contextMax === "number" && contextMax > 0 ? contextMax : null,
      temperature: null,
      capabilities: null,
      thinking: null,
      family: null,
      parameterSize: null,
      quantization: null,
      license: null,
    };
  }

  private body(request: ChatRequest, stream: boolean) {
    return {
      model: request.model,
      messages: request.messages.map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                ...(m.content ? [{ type: "text", text: m.content }] : []),
                ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.type};base64,${i.data}` } })),
              ],
            }
          : { role: m.role, content: m.content },
      ),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    };
  }

  private async post(request: ChatRequest, stream: boolean) {
    let res: Response;
    try {
      res = await fetch(this.url("/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.body(request, stream)),
        signal: request.signal,
      });
    } catch {
      throw this.unreachable();
    }
    if (!res.ok || !res.body) throw await this.failure(res);
    return res;
  }

  // Stats from the server's token counts. Speeds come from its timings when it has them (llama.cpp), else
  // from the time the reply took here; there is no load time to report.
  private stats(usage: Usage | null | undefined, timings: Timings | undefined, t: { start: number; first?: number; end: number }): ReplyStats | undefined {
    if (!usage) return undefined;
    const tokens = usage.completion_tokens ?? 0;
    const promptTokens = usage.prompt_tokens ?? 0;
    const generatingMs = t.end - (t.first ?? t.end);
    const tokensPerSecond = timings?.predicted_per_second ?? (generatingMs > 0 ? tokens / (generatingMs / 1000) : 0);
    return {
      tokens,
      tokensPerSecond: round1(tokensPerSecond),
      promptTokens,
      loadMs: 0,
      totalMs: t.end - t.start,
      contextUsed: promptTokens + tokens,
    };
  }

  private malformed() {
    return new Error(`${this.config.name} sent a reply the app can't read.`);
  }

  async chat(request: ChatRequest): Promise<AsyncIterable<StreamEvent>> {
    const start = Date.now();
    const res = await this.post(request, true);
    return this.events(res.body!, start);
  }

  private async *events(source: ReadableStream<Uint8Array>, start: number): AsyncGenerator<StreamEvent> {
    let usage: Usage | null | undefined;
    let timings: Timings | undefined;
    let first: number | undefined;
    for await (const data of readSse(source)) {
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        throw this.malformed();
      }
      if (chunk.error !== undefined) throw new Error(errorMessage(chunk) ?? `${this.config.name} reported an error.`);
      const delta = chunk.choices?.[0]?.delta;
      const thought = delta?.reasoning_content ?? delta?.reasoning;
      if (thought) yield { type: "thinking", text: thought };
      if (delta?.content) {
        first ??= Date.now();
        yield { type: "content", text: delta.content };
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.timings) timings = chunk.timings;
    }
    const stats = this.stats(usage, timings, { start, first, end: Date.now() });
    yield { type: "done", ...(stats ? { stats } : {}) };
  }

  async complete(request: ChatRequest): Promise<Completion> {
    const start = Date.now();
    const res = await this.post(request, false);
    const data = (await res.json().catch(() => null)) as Chunk | null;
    if (!data) throw this.malformed();
    if (data.error !== undefined) throw new EngineError(errorMessage(data) ?? `${this.config.name} reported an error.`, 502);
    const message = data.choices?.[0]?.message;
    const end = Date.now();
    const thinking = message?.reasoning_content ?? message?.reasoning;
    const stats = this.stats(data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }, data.timings, { start, first: start, end })!;
    const promptPerSecond = data.timings?.prompt_per_second ?? (data.timings?.prompt_ms ? (stats.promptTokens / data.timings.prompt_ms) * 1000 : 0);
    return { content: message?.content ?? "", ...(thinking ? { thinking } : {}), stats, promptPerSecond: round1(promptPerSecond) };
  }
}
