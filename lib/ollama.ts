import type { ReplyStats } from "./types";

export const OLLAMA_URL = process.env.OLLAMA_HOST_URL ?? "http://localhost:11434";

export type OllamaStatus = { running: boolean; version?: string; host: string };

export async function getStatus(): Promise<OllamaStatus> {
  const host = new URL(OLLAMA_URL).host;
  try {
    // A stopped server refuses the connection at once; the timeout only covers a busy one (e.g. loading a model).
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return { running: false, host };
    const data = (await res.json()) as { version?: string };
    return { running: true, version: data.version, host };
  } catch {
    return { running: false, host };
  }
}

// Turns a failed Ollama response into a readable message.
export async function ollamaError(res: Response) {
  const detail = (await res.json().catch(() => null)) as { error?: string } | null;
  return detail?.error ?? `Ollama returned ${res.status}`;
}

// Context window of a model currently loaded in memory, as Ollama reports it.
export async function loadedContextLength(model: string) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(1000), cache: "no-store" });
    const { models } = (await res.json()) as { models?: { name: string; context_length?: number }[] };
    return models?.find((m) => m.name === model)?.context_length;
  } catch {
    return undefined;
  }
}

// One line of Ollama's streamed /api/chat response.
export type ChatChunk = {
  message?: { content?: string };
  error?: string;
  done?: boolean;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number; // includes tokens reused from the cache
  load_duration?: number;
  total_duration?: number;
};

// Ollama's timings from the final chunk, as shown under a reply.
export function toStats(c: ChatChunk, contextSize: number | undefined): ReplyStats {
  const tokens = c.eval_count ?? 0;
  const promptTokens = c.prompt_eval_count ?? 0;
  return {
    tokens,
    tokensPerSecond: c.eval_duration ? Math.round((tokens / (c.eval_duration / 1e9)) * 10) / 10 : 0,
    promptTokens,
    loadMs: Math.round((c.load_duration ?? 0) / 1e6),
    totalMs: Math.round((c.total_duration ?? 0) / 1e6),
    contextUsed: promptTokens + tokens,
    ...(contextSize ? { contextSize } : {}),
  };
}
