// Types of fake-ollama.mjs, for the browser tests (tests/ui) written in TypeScript.
export type ModelSpec = { size: number; words?: number; wordMs?: number; loadMs?: number; fails?: boolean; thinks?: boolean; sees?: boolean; mute?: boolean; levels?: string[] };
export const MODELS: Record<string, ModelSpec>;
export const NO_VISION_ERROR: string;
export const FLAKY_ERROR: string;
export const THINKING_PREFIX: string;
export const PULL_ERROR: string;
export const THINK_LEVEL_ERROR: string;
export function echo(messages: { role: string; content: string }[]): string;

// A request the fake received: what the app sent, and how the exchange ended.
export type OllamaRequest = {
  method: string;
  path: string;
  at: number;
  aborted: boolean; // the app hung up before the answer was complete
  chunks: number;
  finished: boolean;
  body: {
    model?: string;
    stream?: boolean;
    think?: boolean | string;
    keep_alive?: number;
    options?: { temperature?: number; num_ctx?: number; num_predict?: number };
    messages?: { role: string; content: string; images?: string[] }[];
  };
};

export type FakeOllama = {
  url: string;
  port: number;
  requests: OllamaRequest[];
  installed: Map<string, ModelSpec>;
  loaded: Map<string, string>;
  chats(): OllamaRequest[];
  lastChat(): OllamaRequest | undefined;
  since(n: number): OllamaRequest[];
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
};
export function startFakeOllama(): Promise<FakeOllama>;
