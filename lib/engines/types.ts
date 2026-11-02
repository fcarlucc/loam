import type { ChatSettings, EngineConfig, InstalledModel, LoadedModel, ModelInfo, ReplyStats } from "../types";

// What the app asks an engine for. Every engine (Ollama, an OpenAI-compatible server) implements this,
// so routes never talk to an engine's own API: they get normalized models, events and stats back.

// A conversation as sent to a model. Images are base64 with their MIME type; each engine sends them its own way.
export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: { data: string; type: string }[];
};

export type ChatRequest = {
  model: string;
  messages: ModelMessage[];
  // Per-chat settings: an engine applies what it can (see EngineFeatures) and ignores the rest.
  temperature?: number;
  contextLength?: number;
  think?: ChatSettings["think"];
  maxTokens?: number;
  seed?: number;
  // How long the engine keeps the model in memory after the reply, in seconds (Ollama only).
  keepAlive?: number;
  // Aborting it stops the engine too, even while the model is still loading.
  signal?: AbortSignal;
};

// A streamed reply, as the chat route forwards it to the page. A failure mid-stream is thrown by the iterator.
export type StreamEvent = { type: "content"; text: string } | { type: "thinking"; text: string } | { type: "done"; stats?: ReplyStats };

// A whole reply at once (titles, benchmarks). `promptPerSecond` is the reading speed, when the engine measures it.
export type Completion = { content: string; thinking?: string; stats: ReplyStats; promptPerSecond: number };

// What a model can do, when the engine knows (undefined: the engine can't tell, so the model decides).
export type ModelCapabilities = { vision: boolean; tools: boolean; thinking: boolean };

export type EngineStatus = { running: boolean; version?: string; host: string };

// The management features an engine offers; the UI shows the matching panels only when they are true.
export type EngineFeatures = {
  pull: boolean; // download a model by name
  delete: boolean; // delete a model from disk
  loaded: boolean; // list what is loaded in memory
  unload: boolean; // free a model's memory
  power: boolean; // start and stop the engine itself
  keepAlive: boolean; // how long models stay loaded after a reply
  contextLength: boolean; // a per-chat context window
  thinking: boolean; // reasoning on, off or at a level, per chat
};

// Something the engine refused or couldn't do, with the HTTP status the route answers with.
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export interface Engine {
  readonly config: EngineConfig;
  readonly supports: EngineFeatures;
  status(): Promise<EngineStatus>;
  // Installed models, with details where the engine gives them. Throws EngineError when it can't be reached.
  listModels(): Promise<InstalledModel[]>;
  // Remembered for a while: the chat route needs it on every message.
  capabilities(model: string): Promise<ModelCapabilities | undefined>;
  modelInfo(model: string): Promise<ModelInfo>;
  // Resolves once the engine has accepted the request (nothing is saved before that), rejecting with an
  // EngineError when it is unreachable or refuses the model. The events then stream in; a failure mid-reply
  // (an error from the engine, a cut connection, a malformed stream) is thrown while iterating.
  chat(request: ChatRequest): Promise<AsyncIterable<StreamEvent>>;
  complete(request: ChatRequest): Promise<Completion>;
  // Management, only where `supports` says so.
  pull?(model: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>; // NDJSON progress, as the engine sends it
  deleteModel?(model: string): Promise<void>;
  loadedModels?(): Promise<LoadedModel[]>;
  unload?(model: string, signal?: AbortSignal): Promise<void>;
}
