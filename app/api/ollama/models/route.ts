import { OLLAMA_URL } from "@/lib/ollama";

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!res.ok) return Response.json({ models: [] });
    const data = (await res.json()) as { models?: { name: string }[] };
    return Response.json({ models: (data.models ?? []).map((m) => m.name) });
  } catch {
    return Response.json({ models: [] });
  }
}
