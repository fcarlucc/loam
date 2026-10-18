export type Role = "user" | "assistant";

// Reasoning, for models that can do it: off, on, or a level the model offers (see ModelInfo.thinking).
export type ThinkValue = boolean | "low" | "medium" | "high" | "xhigh";

// Per-chat generation settings. Unset fields use the model's own defaults.
export type ChatSettings = { system?: string; temperature?: number; contextLength?: number; think?: ThinkValue };

// Measured by Ollama for one reply.
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

export type ChatSummary = {
  id: number;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  settings: ChatSettings;
};
// Other versions of the same message (edits of a user message, regenerations of a reply), oldest first.
export type Versions = { ids: number[]; index: number };

// A message on the chat's active branch. `id` is missing until the server has saved it.
// `thinking` is what a reasoning model thought before the reply: shown, never sent back to the model.
export type ChatMessage = { id?: number; role: Role; content: string; thinking?: string; stats?: ReplyStats; versions?: Versions };

// Events streamed by /api/chat, one JSON object per line.
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done"; stats?: ReplyStats }
  | { type: "error"; message: string };

// What the settings and models panels need to know about a model (from /api/ollama/show).
export type ModelInfo = {
  contextMax: number | null;
  temperature: number | null;
  capabilities: string[];
  // What the model accepts for `think` and what it does when not told; null when it can't reason.
  thinking?: { values: ThinkValue[]; default: ThinkValue } | null;
  family?: string | null;
  parameterSize?: string | null;
  quantization?: string | null;
  license?: string | null; // first lines only
};

export type InstalledModel = {
  name: string;
  bytes: number; // on disk
  modifiedAt: string;
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
  model: string;
  createdAt: number;
  cold: boolean; // model unloaded first, so loadMs is a real cold start
  tokens: number;
  tokensPerSecond: number; // generation speed
  promptPerSecond: number; // reading speed
  loadMs: number;
  totalMs: number;
};
