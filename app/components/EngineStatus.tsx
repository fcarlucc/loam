"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BUILTIN_OLLAMA_ID } from "@/lib/engines/presets";
import type { EngineModels } from "@/lib/types";
import { PowerIcon } from "./icons";
import { OllamaStatus, type useOllamaStatus } from "./OllamaStatus";

// The layout the card had last time (how many engines, and whether Ollama's power line was there), so the
// page opens with the right one before /api/models answers: the summary card and the single-engine card
// differ in height, and a card that grows while the statuses load would push the sidebar around.
type Layout = { count: number; power: boolean };
const LAYOUT_KEY = "engineStatusLayout";
const noSubscription = () => () => {};
const noLayout: Layout = { count: 0, power: false };
let cachedLayout: { raw: string | null; layout: Layout } | null = null;
// Memoized on the stored string: useSyncExternalStore needs the same object back while nothing changed.
const rememberedLayout = () => {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!cachedLayout || cachedLayout.raw !== raw) {
      const [count, power] = (raw ?? "").split(":");
      const n = Number(count);
      cachedLayout = { raw, layout: Number.isInteger(n) && n > 0 ? { count: n, power: power === "1" } : noLayout };
    }
    return cachedLayout.layout;
  } catch {
    return noLayout;
  }
};

// The status of every engine, at the bottom of the sidebar. With only the built-in Ollama it is the card
// users know: "Ollama is running" with the power button. With more engines it sums them up ("3 of 4 engines
// running", one dot per engine) and opens the Engines dialog; the power button stays for the built-in Ollama
// alone, on its own line, as it is the only engine the app can start and stop (Homebrew's service).
export function EngineStatus({
  engines,
  loaded,
  ollama,
  onOpenEngines,
}: {
  engines: EngineModels[];
  loaded: boolean;
  ollama: ReturnType<typeof useOllamaStatus>;
  onOpenEngines: () => void;
}) {
  const remembered = useSyncExternalStore(noSubscription, rememberedLayout, () => noLayout);
  const builtin = engines.find((e) => e.id === BUILTIN_OLLAMA_ID);
  const layout: Layout = loaded ? { count: engines.length, power: builtin?.supports.power ?? false } : remembered;
  const { count } = layout;

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(LAYOUT_KEY, `${layout.count}:${layout.power ? 1 : 0}`);
    } catch {}
  }, [loaded, layout.count, layout.power]);

  if (count < 2) return <OllamaStatus state={ollama} />;

  const { status, busy, error, power } = ollama;
  // The built-in Ollama's own status is the fresher one: it is polled more often and updated as soon as a
  // start or stop finishes, while /api/models catches up on its next poll.
  const isRunning = (e: EngineModels) => (e.id === BUILTIN_OLLAMA_ID && status ? status.running : e.online);
  const running = loaded ? engines.filter(isRunning).length : 0;
  const summary = !loaded ? "Checking engines…" : running === count ? `All ${count} engines running` : `${running} of ${count} engines running`;

  const powered = layout.power;
  const ollamaName = builtin?.name ?? "Ollama";
  const ollamaRunning = status?.running ?? false;
  const ollamaLoading = status === null;
  const ollamaLabel =
    busy === "start"
      ? "starting…"
      : busy === "stop"
        ? "stopping…"
        : ollamaLoading
          ? "checking…"
          : ollamaRunning
            ? `running${status?.version ? ` · v${status.version}` : ""}`
            : "stopped";
  const ollamaDot = busy || ollamaLoading ? "bg-muted" : ollamaRunning ? "bg-ok" : "bg-danger";

  return (
    <div className="rounded-xl border border-border surface-glossy p-3">
      <button
        onClick={onOpenEngines}
        title="Open Engines"
        className="-mx-1.5 -my-1 flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
      >
        <span aria-hidden className="flex shrink-0 items-center gap-1">
          {(loaded ? engines : Array.from({ length: count }, () => null)).map((engine, i) => (
            <span
              key={engine?.id ?? i}
              title={engine ? `${engine.name}: ${isRunning(engine) ? "running" : "offline"}` : undefined}
              className={`h-2 w-2 rounded-full ${!engine ? "bg-muted" : isRunning(engine) ? "bg-ok" : "bg-danger"}`}
              style={engine ? undefined : { animation: "pulse-dot 1.2s ease-in-out infinite" }}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" aria-live="polite">
          {summary}
        </span>
      </button>
      {loaded && (
        <ul className="sr-only" aria-label="Engines">
          {engines.map((engine) => (
            <li key={engine.id}>
              {engine.name}: {isRunning(engine) ? "running" : "offline"}
            </li>
          ))}
        </ul>
      )}

      {powered && (
        <div className="mt-2 flex items-center gap-2.5 border-t border-border pt-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${ollamaDot}`}
            style={busy || ollamaLoading ? { animation: "pulse-dot 1.2s ease-in-out infinite" } : undefined}
          />
          <p className="min-w-0 flex-1 truncate text-xs text-muted" aria-live="polite">
            <span className="font-medium text-fg">{ollamaName}</span> · {ollamaLabel}
          </p>
          <button
            onClick={() => power(ollamaRunning ? "stop" : "start")}
            disabled={busy !== null || ollamaLoading}
            aria-label={ollamaRunning ? "Stop Ollama" : "Start Ollama"}
            title={ollamaRunning ? "Stop Ollama" : "Start Ollama"}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border transition-colors disabled:opacity-40 ${
              ollamaRunning ? "text-danger hover:bg-surface-2" : "text-ok hover:bg-surface-2"
            }`}
          >
            <PowerIcon width={15} height={15} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
