"use client";

import { useCallback, useEffect, useState } from "react";
import { PowerIcon } from "./icons";

type Status = { running: boolean; version?: string; host?: string };

// `onPowered` runs once a start or stop has finished, whether or not it worked.
export function useOllamaStatus(onPowered?: () => void) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/status", { cache: "no-store" });
      setStatus(await res.json());
    } catch {
      setStatus((s) => ({ ...s, running: false }));
    }
  }, []);

  // Poll while the page is visible, and check right away when it becomes visible again.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), 4000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const power = useCallback(
    async (action: "start" | "stop") => {
      setBusy(action);
      setError(null);
      try {
        const res = await fetch("/api/ollama/power", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Something went wrong");
        setStatus(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        void refresh();
      } finally {
        setBusy(null);
        onPowered?.();
      }
    },
    [refresh, onPowered],
  );

  return { status, busy, error, power };
}

// The card for an install with the built-in Ollama alone (see EngineStatus for several engines).
export function OllamaStatus({ state }: { state: ReturnType<typeof useOllamaStatus> }) {
  const { status, busy, error, power } = state;
  const running = status?.running ?? false;
  const loading = status === null;

  const label = busy === "start" ? "Starting…" : busy === "stop" ? "Stopping…" : loading ? "Checking…" : running ? "Ollama is running" : "Ollama is stopped";
  const dot = busy || loading ? "bg-muted" : running ? "bg-ok" : "bg-danger";

  return (
    <div className="rounded-xl border border-border surface-glossy p-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
          style={busy || loading ? { animation: "pulse-dot 1.2s ease-in-out infinite" } : undefined}
        />
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted">{running && status?.version ? `v${status.version}` : (status?.host ?? "")}</p>
        </div>
        <button
          onClick={() => power(running ? "stop" : "start")}
          disabled={busy !== null || loading}
          aria-label={running ? "Stop Ollama" : "Start Ollama"}
          title={running ? "Stop Ollama" : "Start Ollama"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors disabled:opacity-40 ${
            running ? "text-danger hover:bg-surface-2" : "text-ok hover:bg-surface-2"
          }`}
        >
          <PowerIcon width={16} height={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
