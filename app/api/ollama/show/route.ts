import { isValidModelName } from "@/lib/catalog";
import { jsonError } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";
import { isThinkValue } from "@/lib/settings";
import type { ModelInfo } from "@/lib/types";

type ShowResponse = {
  model_info?: Record<string, unknown>;
  parameters?: string;
  capabilities?: string[];
  thinking?: { values?: unknown[]; default?: unknown }; // newer Ollama versions: what `think` accepts
  license?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
};

// What the settings and models panels need about a model: context window, default temperature, details.
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
  // Older Ollama versions only list the capability: then reasoning is on or off, and on unless told otherwise.
  const thinkDefault = data.thinking?.default;
  const info: ModelInfo = {
    contextMax: Number.isFinite(contextMax) ? contextMax : null,
    temperature: Number.isFinite(temperature) ? temperature : null,
    capabilities: data.capabilities ?? [],
    thinking: data.capabilities?.includes("thinking")
      ? { values: (data.thinking?.values ?? [false, true]).filter(isThinkValue), default: isThinkValue(thinkDefault) ? thinkDefault : true }
      : null,
    family: data.details?.family ?? null,
    parameterSize: data.details?.parameter_size ?? null,
    quantization: data.details?.quantization_level ?? null,
    license: data.license ? data.license.trim().split("\n").slice(0, 3).join(" ").slice(0, 200) : null,
  };
  return Response.json(info);
}
