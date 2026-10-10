// Popular models offered for download. Sizes are approximate.
export type CatalogModel = { name: string; label: string; size: string; note: string };

export const CATALOG: CatalogModel[] = [
  { name: "llama3.2:3b", label: "Llama 3.2 3B", size: "2.0 GB", note: "Fast and light" },
  { name: "llama3.1:8b", label: "Llama 3.1 8B", size: "4.9 GB", note: "Solid all-rounder" },
  { name: "qwen2.5:7b", label: "Qwen 2.5 7B", size: "4.7 GB", note: "Strong multilingual" },
  { name: "qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B", size: "4.7 GB", note: "Code-focused" },
  { name: "qwen2.5:14b", label: "Qwen 2.5 14B", size: "9.0 GB", note: "Smarter, needs more RAM" },
  { name: "mistral:7b", label: "Mistral 7B", size: "4.1 GB", note: "Classic and quick" },
  { name: "gemma2:9b", label: "Gemma 2 9B", size: "5.4 GB", note: "Smaller Gemma 2" },
  { name: "gemma2:2b", label: "Gemma 2 2B", size: "1.6 GB", note: "Tiny and instant" },
  { name: "phi3.5:latest", label: "Phi 3.5", size: "2.2 GB", note: "Compact reasoning" },
  { name: "deepseek-r1:8b", label: "DeepSeek R1 8B", size: "5.2 GB", note: "Step-by-step reasoning" },
];

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
