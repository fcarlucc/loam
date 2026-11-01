import { execFile } from "node:child_process";
import { resolveOllama } from "@/lib/engines";
import { jsonError, readJson } from "@/lib/http";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function brew(action: "start" | "stop") {
  return new Promise<void>((resolve, reject) => {
    execFile(
      "brew",
      ["services", action, "ollama"],
      { env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` } },
      (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()),
    );
  });
}

// Starts or stops Homebrew's Ollama service, then waits until the engine answers (or stops answering).
export async function POST(request: Request) {
  const body = await readJson(request);
  const { action } = body;
  if (action !== "start" && action !== "stop") return jsonError("Invalid action", 400);
  const engine = resolveOllama(body.engine);
  if (engine instanceof Response) return engine;
  if (!engine.supports.power) return jsonError(`${engine.config.name} can't be started or stopped from here`, 400);

  try {
    await brew(action);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Something went wrong", 500);
  }
  const running = action === "start";
  const deadline = Date.now() + (running ? 20000 : 8000);
  while (Date.now() < deadline) {
    if ((await engine.status()).running === running) return Response.json(await engine.status());
    await sleep(400);
  }
  return jsonError(running ? "Ollama didn't start within 20 seconds" : "Ollama didn't stop within 8 seconds", 504);
}
