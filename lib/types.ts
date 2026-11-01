export type Role = "user" | "assistant";

// Reasoning, for models that can do it: off, on, or a level the model offers (see ModelInfo.thinking).
export type ThinkValue = boolean | "low" | "medium" | "high" | "xhigh";

// Per-chat generation settings. Unset fields use the model's own defaults.
export type ChatSettings = { system?: string; temperature?: number; contextLength?: number; think?: ThinkValue };

// Measured by the engine for one reply.
export type ReplyStats = {
  tokens: number; // generated
  tokensPerSecond: number;
  promptTokens: number; // what the model read: system prompt + conversation, cached tokens included
  loadMs: number; // loading the model into memory
  totalMs: number;
  contextUsed: number; // promptTokens + tokens
  contextSize?: number; // the model's context window for this reply
  thinkingMs?: number; // spent reasoning before the reply began, for models that reason
};

// A local AI engine the app talks to: Ollama through its own API, or any server speaking the OpenAI chat API
// (LM Studio, llama.cpp, MLX). `builtin` is the Ollama every install starts with; `remote` marks an engine on
// another machine, accepted only with ALLOW_REMOTE_ENGINES=1.
export type EngineKind = "ollama" | "openai";
export type EngineConfig = { id: string; name: string; kind: EngineKind; baseUrl: string; builtin: boolean; remote: boolean };
// An engine as the model picker sees it: whether it answers right now, and its models.
export type EngineModels = EngineConfig & { online: boolean; models: string[]; error?: string };
// What the page sends a message with: a model of one engine.
export type ModelChoice = { engine: string; model: string };

export type ChatSummary = {
  id: number;
  title: string;
  engine: string; // id of the engine the chat was last continued with (see EngineConfig)
  model: string;
  created_at: number;
  updated_at: number;
  settings: ChatSettings;
  branch_of: number | null; // the chat this one was branched off, while it exists
};
// Other versions of the same message (edits of a user message, regenerations of a reply), oldest first.
export type Versions = { ids: number[]; index: number };

// A file attached to a user message. Text files go to the model inside the message; images go to the engine
// as images, to models that can see. `id` is missing until the server has saved the message.
export type AttachmentKind = "text" | "image";
// `preview` (page only) shows an image while its message is still being sent: a data URL, never saved.
export type Attachment = { id?: number; name: string; type: string; size: number; kind: AttachmentKind; preview?: string };
// What the page sends with a message: the file's text, or an image's bytes as base64.
export type NewAttachment = { name: string; type: string; kind: AttachmentKind; data: string };

// A message on the chat's active branch. `id` is missing until the server has saved it.
// `thinking` is what a reasoning model thought before the reply: shown, never sent back to the model.
// `copied` marks the messages a branched chat started with (copied from the chat it was branched off).
export type ChatMessage = {
  id?: number;
  role: Role;
  content: string;
  attachments?: Attachment[];
  thinking?: string;
  stats?: ReplyStats;
  versions?: Versions;
  copied?: boolean;
};

// Events streamed by /api/chat, one JSON object per line.
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done"; stats?: ReplyStats }
  | { type: "error"; message: string };

// What the settings and models panels need to know about a model (from /api/engines/[id]/show).
// Most of it is only known for Ollama models; `capabilities` is null when the engine can't tell.
export type ModelInfo = {
  contextMax: number | null;
  temperature: number | null;
  capabilities: string[] | null;
  // What the model accepts for `think` and what it does when not told; null when it can't reason.
  thinking?: { values: ThinkValue[]; default: ThinkValue } | null;
  family?: string | null;
  parameterSize?: string | null;
  quantization?: string | null;
  license?: string | null; // first lines only
};

export type InstalledModel = {
  name: string;
  bytes: number | null; // on disk, when the engine says
  modifiedAt: string | null;
  parameterSize: string | null;
  quantization: string | null;
};

export type LoadedModel = {
  name: string;
  bytes: number; // in memory
  gpuBytes: number;
  expiresAt: string | null; // when Ollama unloads it if unused
  contextLength: number | null;
};

// A search result: a chat whose title matches (messageId null) or a matching message.
// `snippet` wraps matched words in MARK_START / MARK_END (see lib/format.ts).
export type SearchHit = {
  chatId: number;
  title: string;
  messageId: number | null;
  role: Role | null;
  snippet: string | null;
};

export type SystemInfo = { chip: string | null; memoryBytes: number };

export type Usage = {
  totals: { chats: number; sent: number; replies: number; tokens: number; generatingMs: number };
  daily: { day: string; replies: number; tokens: number }[]; // only days with replies, "YYYY-MM-DD"
  models: {
    engine: string;
    model: string;
    replies: number;
    tokens: number;
    avgTokensPerSecond: number | null;
    coldStarts: number;
    avgColdLoadMs: number | null;
  }[];
};

export type BenchmarkResult = {
  id: number;
  engine: string;
  model: string;
  createdAt: number;
  cold: boolean; // model unloaded first, so loadMs is a real cold start
  tokens: number;
  tokensPerSecond: number; // generation speed
  promptPerSecond: number; // reading speed
  loadMs: number;
  totalMs: number;
};
