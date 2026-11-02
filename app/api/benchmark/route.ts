import { isModelId } from "@/lib/catalog";
import { addBenchmark, clearBenchmarks, getKeepAlive, listBenchmarks } from "@/lib/db";
import { acceptsModel, engineFailure, resolveEngine } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";

// Same prompt and fixed sampling for every run, so results are comparable across models and over time.
const PROMPT = "Explain in about 150 words how a refrigerator keeps food cold.";
const SAMPLING = { temperature: 0, seed: 42, maxTokens: 300 };

export async function GET() {
  return Response.json({ results: listBenchmarks(), prompt: PROMPT });
}

// Runs the benchmark for one model; `cold` unloads it first so the load time is measured too (where the
// engine can unload models).
export async function POST(request: Request) {
  const { engine: engineId, model, cold } = await readJson(request);
  if (typeof model !== "string" || !isModelId(model)) return jsonError("Invalid model name", 400);
  const engine = resolveEngine(engineId);
  if (engine instanceof Response) return engine;
  if (!acceptsModel(engine, model)) return jsonError("Invalid model name", 400);
  // Only an engine that can unload a model measures a cold start.
  const coldStart = cold === true && !!engine.unload;

  try {
    if (coldStart) await engine.unload!(model, request.signal);
    const { stats, promptPerSecond } = await engine.complete({
      model,
      messages: [{ role: "user", content: PROMPT }],
      ...SAMPLING,
      keepAlive: getKeepAlive(),
      signal: request.signal, // stop button: the engine stops too
    });
    const result = {
      engine: engine.config.id,
      model,
      cold: coldStart,
      tokens: stats.tokens,
      tokensPerSecond: stats.tokensPerSecond,
      promptPerSecond,
      loadMs: stats.loadMs,
      totalMs: stats.totalMs,
    };
    addBenchmark(result);
    return Response.json({ result });
  } catch (e) {
    if (request.signal.aborted) return jsonError("Stopped", 499);
    return engineFailure(e);
  }
}

export async function DELETE() {
  clearBenchmarks();
  return Response.json({ ok: true });
}
