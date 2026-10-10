import { isValidModelName } from "@/lib/catalog";
import { addBenchmark, clearBenchmarks, getKeepAlive, listBenchmarks } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { OLLAMA_URL, ollamaError } from "@/lib/ollama";
import { KEEP_ALIVE_DEFAULT } from "@/lib/settings";

// Same prompt and fixed sampling for every run, so results are comparable across models and over time.
const PROMPT = "Explain in about 150 words how a refrigerator keeps food cold.";
const OPTIONS = { temperature: 0, seed: 42, num_predict: 300 };

type Timings = {
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  load_duration?: number;
  total_duration?: number;
};

const perSecond = (count = 0, ns = 0) => (ns > 0 ? Math.round((count / (ns / 1e9)) * 10) / 10 : 0);

export async function GET() {
  return Response.json({ results: listBenchmarks(), prompt: PROMPT });
}

// Runs the benchmark for one model; `cold` unloads it first so the load time is measured too.
export async function POST(request: Request) {
  const { model, cold } = await readJson(request);
  if (typeof model !== "string" || !isValidModelName(model)) return jsonError("Invalid model name", 400);
  const keepAlive = getKeepAlive();

  try {
    if (cold === true) {
      await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: request.signal,
      });
    }
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROMPT }],
        stream: false,
        options: OPTIONS,
        ...(keepAlive !== KEEP_ALIVE_DEFAULT ? { keep_alive: keepAlive } : {}),
      }),
      signal: request.signal, // stop button: Ollama stops too
    });
    if (!res.ok) return jsonError(await ollamaError(res), 502);
    const t = (await res.json()) as Timings;
    const result = {
      model,
      cold: cold === true,
      tokens: t.eval_count ?? 0,
      tokensPerSecond: perSecond(t.eval_count, t.eval_duration),
      promptPerSecond: perSecond(t.prompt_eval_count, t.prompt_eval_duration),
      loadMs: Math.round((t.load_duration ?? 0) / 1e6),
      totalMs: Math.round((t.total_duration ?? 0) / 1e6),
    };
    addBenchmark(result);
    return Response.json({ result });
  } catch {
    if (request.signal.aborted) return jsonError("Stopped", 499);
    return jsonError("Cannot reach Ollama. Is it running?", 502);
  }
}

export async function DELETE() {
  clearBenchmarks();
  return Response.json({ ok: true });
}
