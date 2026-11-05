import type { ChatSettings, ThinkValue } from "./types";

export const SYSTEM_PROMPT_MAX = 8000;
export const CONTEXT_CHOICES = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

// Reasoning levels Ollama models offer besides on/off (gpt-oss: low/medium/high; qwen3.8: low/medium/xhigh).
export const THINK_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export const isThinkValue = (v: unknown): v is ThinkValue =>
  typeof v === "boolean" || (typeof v === "string" && (THINK_LEVELS as readonly string[]).includes(v));
// For "Reasoning off", "Reasoning medium", ...
export const thinkLabel = (v: ThinkValue) => (v === false ? "off" : v === true ? "on" : v === "xhigh" ? "extra high" : v);

// Clean settings, or null when a field has the wrong type or is out of range.
export function parseSettings(input: unknown): ChatSettings | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const { system, temperature, contextLength, think, autoCompact } = input as Record<string, unknown>;
  const out: ChatSettings = {};
  if (system !== undefined) {
    if (typeof system !== "string" || system.length > SYSTEM_PROMPT_MAX) return null;
    if (system.trim()) out.system = system.trim();
  }
  if (temperature !== undefined) {
    if (typeof temperature !== "number" || !(temperature >= 0 && temperature <= 2)) return null;
    out.temperature = Math.round(temperature * 100) / 100;
  }
  if (contextLength !== undefined) {
    if (typeof contextLength !== "number" || !Number.isInteger(contextLength) || contextLength < 512 || contextLength > 1_048_576) {
      return null;
    }
    out.contextLength = contextLength;
  }
  if (think !== undefined) {
    if (!isThinkValue(think)) return null;
    out.think = think;
  }
  if (autoCompact !== undefined) {
    if (typeof autoCompact !== "boolean") return null;
    if (autoCompact) out.autoCompact = true;
  }
  return out;
}

export const hasCustomSettings = (s: ChatSettings) =>
  s.system !== undefined || s.temperature !== undefined || s.contextLength !== undefined || s.think !== undefined || s.autoCompact !== undefined;

// How long Ollama keeps a model in memory after a reply, in seconds (-1 = until Ollama stops).
export const KEEP_ALIVE_DEFAULT = 300; // Ollama's own default
export const KEEP_ALIVE_CHOICES = [
  { seconds: 0, label: "Unload right after each reply" },
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes (Ollama default)" },
  { seconds: 1800, label: "30 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: -1, label: "Until Ollama stops" },
];
export const isKeepAlive = (v: unknown): v is number => KEEP_ALIVE_CHOICES.some((c) => c.seconds === v);
