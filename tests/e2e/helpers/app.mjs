// Starts the app the way `npm run dev` does (scripts/dev.mjs), on its own port, with its own build
// directory and a throwaway database, so the tests never touch your chats or your running app.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DIST_DIR = ".next-e2e";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls `check` until it returns something truthy (errors count as "not yet").
export async function waitFor(check, { timeout = 30_000, every = 100, what = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let result;
    try {
      result = await check();
    } catch {}
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
    await sleep(every);
  }
}

// Does something accept TCP connections at host:port?
export function canConnect(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Resolves with { code, signal } when the child exits, or null after `timeout` ms.
export function exited(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

// `port: null` lets dev.mjs choose the port (then read it from app.output and set app.port).
// `manageOllama: true` runs the real thing: dev.mjs starts and stops Homebrew's Ollama service.
// `detached: true` puts the app in its own process group, like a job started from a terminal.
// `dataDir` is a throwaway directory holding a database to open, instead of a fresh empty one.
export async function startApp({ ollamaUrl, manageOllama = false, port, args = [], env = {}, detached = false, dataDir } = {}) {
  dataDir ??= await mkdtemp(join(tmpdir(), "ollama-wrap-e2e-"));
  if (port === undefined) port = await freePort();
  const child = spawn(
    process.execPath,
    [join(ROOT, "scripts/dev.mjs"), ...(manageOllama ? [] : ["--no-ollama"]), ...(port === null ? [] : ["-p", String(port)]), ...args],
    {
      cwd: ROOT,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(ollamaUrl ? { OLLAMA_HOST_URL: ollamaUrl } : {}),
        OLLAMA_WRAP_DATA_DIR: dataDir,
        OLLAMA_WRAP_DIST_DIR: DIST_DIR,
        NEXT_TELEMETRY_DISABLED: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        ...env,
      },
    },
  );
  const app = {
    child,
    dataDir,
    dbPath: join(dataDir, "ollama-wrap.db"),
    output: "",
    tree: [], // pids started under dev.mjs, filled in by whoever needs them
    get port() {
      return port;
    },
    set port(p) {
      port = p;
    },
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    // Waits until the API answers.
    async ready(timeout = 60_000) {
      let fatal;
      await waitFor(
        async () => {
          if (child.exitCode !== null) fatal = `dev.mjs exited with ${child.exitCode}`;
          if (app.output.includes("Another next dev server is already running")) {
            fatal = `another dev server holds ${DIST_DIR}: stop it first (a previous test run left it behind?)`;
          }
          if (fatal) return true;
          if (port === null) return false;
          return (await fetch(`${app.url}/api/system`)).ok;
        },
        { timeout, what: `the app on port ${port}\n${app.output}` },
      );
      if (fatal) throw new Error(`${fatal}\n${app.output}`);
      return app;
    },
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    },
    // Ctrl+C for the app, then removes its data.
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGINT");
        if (!(await exited(child, 15_000))) {
          child.kill("SIGKILL");
          await exited(child, 5_000);
        }
      }
      await app.cleanup();
    },
  };
  child.stdout.on("data", (d) => (app.output += d));
  child.stderr.on("data", (d) => (app.output += d));
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});
  return app;
}
