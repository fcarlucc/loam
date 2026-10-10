import type { ChatSettings } from "./types";

export const SYSTEM_PROMPT_MAX = 8000;
export const CONTEXT_CHOICES = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

// Clean settings, or null when a field has the wrong type or is out of range.
export function parseSettings(input: unknown): ChatSettings | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const { system, temperature, contextLength } = input as Record<string, unknown>;
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
  return out;
}

export const hasCustomSettings = (s: ChatSettings) =>
  s.system !== undefined || s.temperature !== undefined || s.contextLength !== undefined;
