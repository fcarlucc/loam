// What `npm run dev` does with the real Ollama service: starts it, and stops it however the app ends
// (Ctrl+C, terminal closed, Next crashing), leaving no process behind. Needs Homebrew's ollama.
// These tests restart that service, so they skip when Ollama is already running: you may be using it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { canConnect, exited, freePort, startApp, waitFor } from "./helpers/app.mjs";
import { apiClient } from "./helpers/http.mjs";

const OLLAMA_URL = process.env.OLLAMA_HOST_URL ?? "http://localhost:11434";
const LONG = { timeout: 180_000 };

// brew's word for the service: "started", "stopped", "none" (never started), "error"; null without brew/ollama.
function brewOllamaStatus() {
  const r = spawnSync("brew", ["services", "list"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const line = r.stdout.split("\n").find((l) => /^ollama\s/.test(l));
  return line ? line.trim().split(/\s+/)[1] : null;
}

async function ollamaUp() {
  try {
    return (await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

function descendants(pid) {
  const out = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.trim();
  const children = out ? out.split("\n").map(Number) : [];
  return children.flatMap((c) => [c, ...descendants(c)]);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const apps = []; // everything started here, for cleanup
let skipReason = null;

// A test that fails midway must not leave its app (and Ollama) running for the next one.
async function killLeftovers() {
  for (const app of apps) {
    const pids = [app.child.pid, ...app.tree, ...descendants(app.child.pid)];
    if (!pids.some(alive)) continue;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await waitFor(() => !pids.some(alive), { timeout: 10_000, what: "leftover processes to die" });
    spawnSync("brew", ["services", "stop", "ollama"], { stdio: "ignore" });
  }
}

// Starts the app like `npm run dev`, in its own process group like a job started from a terminal,
// and waits until the app and Ollama answer.
async function startManaged(options = {}) {
  const app = await startApp({ manageOllama: true, detached: true, ...options });
  apps.push(app);
  if (app.port !== null) await app.ready(120_000);
  return app;
}

async function ollamaReady(app) {
  await waitFor(ollamaUp, { timeout: 60_000, what: `Ollama to start\n${app.output}` });
  app.tree = descendants(app.child.pid);
  assert.ok(app.tree.length >= 1, "next should be running under dev.mjs");
}

// What must be true after the app ends, however it ended.
async function expectAllStopped(app, how, { log = true } = {}) {
  assert.ok(await exited(app.child, 20_000), `${how}: dev.mjs is still running`);
  await waitFor(async () => !(await canConnect("127.0.0.1", app.port)), { timeout: 10_000, what: `port ${app.port} to be released (${how})` });
  await waitFor(() => app.tree.every((pid) => !alive(pid)), { timeout: 10_000, what: `every process started by dev.mjs to exit (${how})` });
  await waitFor(async () => !(await ollamaUp()), { timeout: 15_000, what: `Ollama to stop (${how})` });
  assert.notEqual(brewOllamaStatus(), "started", `${how}: brew still lists the ollama service as started`);
  if (log) assert.match(app.output, /Ollama stopped\./, `${how}: dev.mjs didn't report stopping Ollama:\n${app.output}`);
}

const ctrlC = (app) => process.kill(-app.child.pid, "SIGINT"); // the terminal signals the whole foreground job

before(async () => {
  const status = brewOllamaStatus();
  if (status === null) skipReason = "Homebrew's ollama service isn't installed";
  else if (status === "started" || (await ollamaUp())) skipReason = "Ollama is already running (these tests would stop it)";
});

after(async () => {
  await killLeftovers();
  for (const app of apps) await app.cleanup();
  if (!skipReason && (await ollamaUp())) spawnSync("brew", ["services", "stop", "ollama"], { stdio: "ignore" });
});

describe("npm run dev with the real Ollama", () => {
  afterEach(killLeftovers);

  it("starts Ollama and the app on the loopback, and Ctrl+C stops both", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const app = await startManaged();
    await ollamaReady(app);
    assert.match(app.output, /Starting Ollama/);
    assert.match(app.output, new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${app.port}`), "Next announces the loopback address");
    assert.equal(brewOllamaStatus(), "started");
    const status = await apiClient(app.url).json("/api/ollama/status");
    assert.equal(status.data.running, true);
    assert.equal(status.data.host, new URL(OLLAMA_URL).host);

    ctrlC(app);
    await expectAllStopped(app, "Ctrl+C");
  });

  it("the power switch in the sidebar stops and starts Ollama", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const app = await startManaged();
    await ollamaReady(app);
    const api = apiClient(app.url);
    let res = await api.json("/api/ollama/power", { method: "POST", body: { action: "stop" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.running, false);
    assert.equal(await ollamaUp(), false);
    assert.notEqual(brewOllamaStatus(), "started");

    res = await api.json("/api/ollama/power", { method: "POST", body: { action: "start" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.running, true);
    assert.equal(await ollamaUp(), true);

    ctrlC(app);
    await expectAllStopped(app, "Ctrl+C after using the power switch");
  });

  it("closing the terminal stops Ollama and leaves no process behind", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const app = await startManaged();
    await ollamaReady(app);
    // The terminal is gone: its pipes are closed and the shell sends SIGHUP to the job's process group.
    app.child.stdout.destroy();
    app.child.stderr.destroy();
    process.kill(-app.child.pid, "SIGHUP");
    await expectAllStopped(app, "terminal closed", { log: false });
  });

  it("if Next crashes, Ollama is still stopped", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const app = await startManaged();
    await ollamaReady(app);
    process.kill(app.tree[0], "SIGKILL"); // dev.mjs's direct child: the next CLI
    await expectAllStopped(app, "next crashed");
  });

  it("picks the next free port when the usual one is taken", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const taken = await freePort();
    const blocker = net.createServer();
    blocker.listen(taken, "127.0.0.1");
    await once(blocker, "listening");
    try {
      const app = await startManaged({ port: null, env: { PORT: String(taken) } });
      const match = await waitFor(() => /Open http:\/\/localhost:(\d+)/.exec(app.output), { what: `dev.mjs to announce its port\n${app.output}` });
      app.port = Number(match[1]);
      assert.equal(app.port, taken + 1);
      await app.ready(120_000);
      await ollamaReady(app);
      ctrlC(app);
      await expectAllStopped(app, "Ctrl+C on the next free port");
    } finally {
      blocker.close();
    }
  });

  it("an Ollama left running from before is restarted, and still stopped at the end", LONG, async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.equal(spawnSync("brew", ["services", "start", "ollama"], { stdio: "ignore" }).status, 0);
    await waitFor(ollamaUp, { timeout: 60_000, what: "Ollama to start by hand" });
    const app = await startManaged();
    await ollamaReady(app);
    assert.match(app.output, /already running/);
    ctrlC(app);
    await expectAllStopped(app, "Ctrl+C after a leftover Ollama");
  });
});
