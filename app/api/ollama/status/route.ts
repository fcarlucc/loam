import { resolveOllama } from "@/lib/engines";

export async function GET(request: Request) {
  const engine = resolveOllama(new URL(request.url).searchParams.get("engine") ?? undefined);
  if (engine instanceof Response) return engine;
  return Response.json(await engine.status());
}
