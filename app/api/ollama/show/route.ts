import { isValidModelName } from "@/lib/catalog";
import { jsonError } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";
import type { ModelInfo } from "@/lib/types";

type ShowResponse = { model_info?: Record<string, unknown>; parameters?: string; capabilities?: string[] };

// What the settings panel needs about a model: its largest context window and its own default temperature, if any.
export async function GET(request: Request) {
  const model = new URL(request.url).searchParams.get("model") ?? "";
  if (!isValidModelName(model)) return jsonError("Invalid model name", 400);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
  if (!res.ok) return jsonError(await ollamaError(res), 502);
  const data = (await res.json()) as ShowResponse;

  const contextKey = Object.keys(data.model_info ?? {}).find((k) => k.endsWith(".context_length"));
  const contextMax = Number(contextKey ? data.model_info?.[contextKey] : NaN);
  const temperature = Number(/^temperature\s+([\d.]+)/m.exec(data.parameters ?? "")?.[1] ?? NaN);
  const info: ModelInfo = {
    contextMax: Number.isFinite(contextMax) ? contextMax : null,
    temperature: Number.isFinite(temperature) ? temperature : null,
    capabilities: data.capabilities ?? [],
  };
  return Response.json(info);
}
