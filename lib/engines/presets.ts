import type { EngineKind } from "../types";

// What the page and the server both know about engines: kinds, presets and the rules for their URLs.
// Nothing here touches the database or the network, so client components can import it.

export const ENGINE_KINDS: EngineKind[] = ["ollama", "openai"];
export const isEngineKind = (v: unknown): v is EngineKind => typeof v === "string" && (ENGINE_KINDS as string[]).includes(v);
export const KIND_LABEL: Record<EngineKind, string> = { ollama: "Ollama", openai: "OpenAI-compatible" };

// The engine every install starts with; its URL can also come from OLLAMA_HOST_URL (see lib/engines/index.ts).
export const BUILTIN_OLLAMA_ID = "ollama";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export type EnginePreset = { name: string; kind: EngineKind; baseUrl: string; note: string };
export const PRESETS: EnginePreset[] = [
  { name: "Ollama", kind: "ollama", baseUrl: DEFAULT_OLLAMA_URL, note: "A second Ollama, e.g. on another port" },
  { name: "LM Studio", kind: "openai", baseUrl: "http://127.0.0.1:1234/v1", note: "Its local server, started from the Developer tab" },
  { name: "llama.cpp", kind: "openai", baseUrl: "http://127.0.0.1:8080/v1", note: "llama-server" },
  { name: "MLX", kind: "openai", baseUrl: "http://127.0.0.1:8080/v1", note: "mlx_lm.server" },
];

export const ENGINE_NAME_MAX = 40;
export const ENGINE_ID_RE = /^[\w-]{1,64}$/;
export const isEngineId = (v: unknown): v is string => typeof v === "string" && ENGINE_ID_RE.test(v);

// A display name: trimmed, cut short; null when unusable.
export function parseEngineName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && Array.from(name).length <= ENGINE_NAME_MAX ? name : null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Is this the address Homebrew's Ollama service listens on? Only that Ollama is started and stopped from the app.
export function isHomebrewOllamaUrl(url: string) {
  try {
    const u = new URL(url);
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase()) && u.port === "11434" && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

// Is this URL on this machine? Only loopback engines are accepted unless remote ones were allowed explicitly.
export function isLoopbackUrl(url: string) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type ParsedEngineUrl = { baseUrl: string; remote: boolean } | { error: string };

// Cleans an engine URL (scheme, host, port and path only) and applies the loopback rule.
export function parseEngineUrl(value: unknown, allowRemote: boolean): ParsedEngineUrl {
  if (typeof value !== "string" || value.length > 300) return { error: "Invalid URL" };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "The URL must start with http:// or https://" };
  if (url.username || url.password || url.search || url.hash) return { error: "The URL may only have a host, a port and a path" };
  const remote = !LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (remote && !allowRemote) {
    return { error: "Only engines on this machine are accepted (localhost, 127.0.0.1 or [::1]). Set ALLOW_REMOTE_ENGINES=1 to allow others." };
  }
  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { baseUrl, remote };
}
