import { isValidModelName } from "@/lib/catalog";
import { jsonError, readJson } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";
import type { InstalledModel } from "@/lib/types";

type TagsResponse = {
  models?: { name: string; size: number; modified_at: string; details?: { parameter_size?: string; quantization_level?: string } }[];
};

// Installed models: `models` is the list of names, `installed` the details for the models panel.
export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!res.ok) return Response.json({ models: [], installed: [] });
    const data = (await res.json()) as TagsResponse;
    const installed: InstalledModel[] = (data.models ?? []).map((m) => ({
      name: m.name,
      bytes: m.size,
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
    }));
    return Response.json({ models: installed.map((m) => m.name), installed });
  } catch {
    return Response.json({ models: [], installed: [] });
  }
}

// Deletes an installed model from disk.
export async function DELETE(request: Request) {
  const { model } = await readJson(request);
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return jsonError(await ollamaError(res), res.status === 404 ? 404 : 502);
  } catch {
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
  return Response.json({ ok: true });
}
