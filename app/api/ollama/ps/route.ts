import { OLLAMA_URL } from "@/lib/ollama";
import type { LoadedModel } from "@/lib/types";

type PsResponse = {
  models?: { name: string; size: number; size_vram?: number; expires_at?: string; context_length?: number }[];
};

// Models currently loaded in memory.
export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!res.ok) return Response.json({ models: [] });
    const data = (await res.json()) as PsResponse;
    const models: LoadedModel[] = (data.models ?? []).map((m) => ({
      name: m.name,
      bytes: m.size,
      gpuBytes: m.size_vram ?? 0,
      expiresAt: m.expires_at ?? null,
      contextLength: m.context_length ?? null,
    }));
    return Response.json({ models });
  } catch {
    return Response.json({ models: [] });
  }
}
