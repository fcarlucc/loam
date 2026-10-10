import { execFile } from "node:child_process";
import { jsonError, readJson } from "@/lib/http";
import { getStatus } from "@/lib/ollama";

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

async function waitFor(running: boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getStatus()).running === running) return true;
    await sleep(400);
  }
  return false;
}

export async function POST(request: Request) {
  const { action } = await readJson(request);
  if (action !== "start" && action !== "stop") return jsonError("Invalid action", 400);

  try {
    await brew(action);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Something went wrong", 500);
  }
  if (!(await waitFor(action === "start", action === "start" ? 20000 : 8000))) {
    return jsonError(action === "start" ? "Ollama didn't start within 20 seconds" : "Ollama didn't stop within 8 seconds", 504);
  }
  return Response.json(await getStatus());
}
