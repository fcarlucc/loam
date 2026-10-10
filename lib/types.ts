export type Role = "user" | "assistant";

// Per-chat generation settings. Unset fields use the model's own defaults.
export type ChatSettings = { system?: string; temperature?: number; contextLength?: number };

// Measured by Ollama for one reply.
export type ReplyStats = {
  tokens: number; // generated
  tokensPerSecond: number;
  promptTokens: number; // what the model read: system prompt + conversation, cached tokens included
  loadMs: number; // loading the model into memory
  totalMs: number;
  contextUsed: number; // promptTokens + tokens
  contextSize?: number; // the model's context window for this reply
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
export type ChatMessage = { id?: number; role: Role; content: string; stats?: ReplyStats; versions?: Versions };

// Events streamed by /api/chat, one JSON object per line.
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; stats?: ReplyStats }
  | { type: "error"; message: string };

// What the settings panel needs to know about a model (from /api/ollama/show).
export type ModelInfo = { contextMax: number | null; temperature: number | null; capabilities: string[] };
