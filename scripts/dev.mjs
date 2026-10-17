// Starts Ollama, then Next (reachable from this machine only).
// On every exit (Ctrl+C, terminal closed, crash) it stops Ollama.
// With --no-ollama it only starts Next, leaving Ollama alone.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const OLLAMA_URL = process.env.OLLAMA_HOST_URL ?? "http://localhost:11434";

const args = process.argv.slice(2).filter((a) => a !== "--no-ollama");
const manageOllama = !process.argv.includes("--no-ollama");

// Once the terminal is gone, writing to it fails: that must never break the shutdown path.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const log = (msg) => {
  try {
    console.log(`\x1b[35m[ollama-wrap]\x1b[0m ${msg}`);
  } catch {}
};

async function isUp() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function brew(action, stdio = "inherit") {
  return spawnSync("brew", ["services", action, "ollama"], { stdio }).status === 0;
}

let stopped = !manageOllama;
function stopOllama() {
  if (stopped) return;
  stopped = true;
  // Silent on purpose: brew aborts if it can't print to a closed terminal.
  const ok = brew("stop", "ignore");
  log(ok ? "Ollama stopped." : "Could not stop Ollama: run `brew services stop ollama`.");
}

// Something already answers on this port, on IPv4 or IPv6 localhost.
function portTaken(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      const done = (taken) => {
        socket.destroy();
        resolve(taken);
      };
      socket.setTimeout(500, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((results) => results.includes(true));
}

// Next only checks the address it binds to (127.0.0.1), so a server on the same port elsewhere
// (e.g. another dev server on *:3000) would keep answering http://localhost. Pick a port nobody uses.
async function freePort(start) {
  for (let port = start; port < start + 50; port++) if (!(await portTaken(port))) return port;
  return start;
}

if (manageOllama) {
  if (await isUp()) log("Ollama was already running (maybe left over from a previous session): restarting it.");
  log("Starting Ollama…");
  if (!brew("restart")) {
    log("Could not start Ollama via brew: the app will start anyway, use the button in the UI.");
  }
}

// The port passed with -p / --port, if any.
function portFromArgs() {
  const i = args.findIndex((a) => a === "-p" || a === "--port");
  if (i >= 0) return Number(args[i + 1]);
  const inline = args.find((a) => a.startsWith("--port="));
  return inline ? Number(inline.slice("--port=".length)) : undefined;
}

// Bind to localhost unless a hostname was passed explicitly: chats must not be reachable from the network.
const hasHost = args.some((a) => a === "-H" || a === "--hostname" || a.startsWith("--hostname="));
const extra = hasHost ? [] : ["-H", "127.0.0.1"];
let port = portFromArgs();
if (port === undefined) {
  port = await freePort(Number(process.env.PORT) || 3000);
  extra.push("-p", String(port));
  log(`Open http://localhost:${port}`);
}

// Next's server processes still listening on our port. `next dev` runs the server in a child process of
// its own: if the CLI is killed outright, that child lives on and keeps the port.
function nextServersOnPort() {
  const lsof = spawnSync("lsof", ["-nP", "-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (lsof.stdout ?? "")
    .split("\n")
    .map(Number)
    .filter((pid) => pid > 0 && pid !== process.pid)
    .filter((pid) => /next-server/.test(spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? ""));
}

const nextBin = require.resolve("next/dist/bin/next");
// Next.js would otherwise send anonymous usage data to Vercel: everything stays on this machine.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1" };
const child = spawn(process.execPath, [nextBin, "dev", ...extra, ...args], { stdio: "inherit", env });

// The terminal sends SIGINT to Next too: wait for it to exit, then stop Ollama.
// `next dev` only shuts down cleanly on SIGINT/SIGTERM (on SIGHUP it dies and leaves its server
// process running), so a closed terminal is passed on as SIGTERM. If Next doesn't stop within 5s, kill it.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child.exitCode === null) {
    child.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
    setTimeout(() => child.kill("SIGKILL"), 5000).unref();
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => shutdown(sig));

child.on("exit", (code, signal) => {
  // Killed by a signal (crash, kill -9, terminal gone) the CLI couldn't stop its server process: do it here.
  // On any other exit it has already done so itself.
  if (signal !== null) {
    for (const pid of nextServersOnPort()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  stopOllama();
  process.exit(code ?? 0);
});
process.on("exit", stopOllama);
