// Popular models offered for download. Sizes are the approximate download size in GB.
export type CatalogModel = { name: string; label: string; sizeGb: number; note: string };

export const CATALOG: CatalogModel[] = [
  { name: "llama3.2:3b", label: "Llama 3.2 3B", sizeGb: 2.0, note: "Fast and light" },
  { name: "llama3.1:8b", label: "Llama 3.1 8B", sizeGb: 4.9, note: "Solid all-rounder" },
  { name: "qwen2.5:7b", label: "Qwen 2.5 7B", sizeGb: 4.7, note: "Strong multilingual" },
  { name: "qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B", sizeGb: 4.7, note: "Code-focused" },
  { name: "qwen2.5:14b", label: "Qwen 2.5 14B", sizeGb: 9.0, note: "Smarter, needs more RAM" },
  { name: "qwen2.5:32b", label: "Qwen 2.5 32B", sizeGb: 20, note: "Near top quality" },
  { name: "llama3.3:70b", label: "Llama 3.3 70B", sizeGb: 43, note: "Very large" },
  { name: "mistral:7b", label: "Mistral 7B", sizeGb: 4.1, note: "Classic and quick" },
  { name: "gemma2:9b", label: "Gemma 2 9B", sizeGb: 5.4, note: "Smaller Gemma 2" },
  { name: "gemma2:2b", label: "Gemma 2 2B", sizeGb: 1.6, note: "Tiny and instant" },
  { name: "phi3.5:latest", label: "Phi 3.5", sizeGb: 2.2, note: "Compact reasoning" },
  { name: "deepseek-r1:8b", label: "DeepSeek R1 8B", sizeGb: 5.2, note: "Step-by-step reasoning" },
];

// Will a model of this download size run on this Mac? An estimate: while running a model takes about its
// download size plus ~1.5 GB for the conversation, and macOS lets the GPU use roughly 75% of the memory.
export type Fit = "good" | "tight" | "too-big";
export const modelBudgetGb = (memoryGb: number) => memoryGb * 0.75;
export function fitFor(sizeGb: number, memoryGb: number): Fit {
  const need = sizeGb + 1.5;
  const budget = modelBudgetGb(memoryGb);
  return need <= budget * 0.8 ? "good" : need <= budget ? "tight" : "too-big";
}
export const FIT_LABEL: Record<Fit, string> = { good: "Runs well", tight: "Tight fit", "too-big": "Too big" };
export const FIT_DETAIL: Record<Fit, string> = {
  good: "it should run well.",
  tight: "it should run, but slowly if other apps use a lot of memory.",
  "too-big": "it probably won't fit: expect it to fail or be very slow.",
};

// Same shape Ollama accepts: [registry/][namespace/]name[:tag], e.g. hf.co/user/repo:Q4_K_M
const MODEL_NAME_RE = /^[a-zA-Z0-9][\w.\-]*(\/[\w.\-]+){0,2}(:[\w.\-]+)?$/;

export function isValidModelName(name: string) {
  return name.length <= 200 && MODEL_NAME_RE.test(name);
}

// Ollama lists untagged models as "name:latest"; use that form so names compare equal.
export function normalizeModelName(name: string) {
  const trimmed = name.trim();
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last.includes(":") ? trimmed : `${trimmed}:latest`;
}
