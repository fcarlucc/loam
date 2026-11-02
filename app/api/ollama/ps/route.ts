import { resolveOllama } from "@/lib/engines";

// Models currently loaded in memory (empty when the engine can't be reached).
export async function GET(request: Request) {
  const engine = resolveOllama(new URL(request.url).searchParams.get("engine") ?? undefined);
  if (engine instanceof Response) return engine;
  try {
    return Response.json({ models: await engine.loadedModels!() });
  } catch {
    return Response.json({ models: [] });
  }
}
