"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTokens } from "@/lib/format";
import type { BenchmarkResult, Usage } from "@/lib/types";
import { type Bar, BarChart } from "./BarChart";
import { MenuIcon, XIcon } from "./icons";

const DAY = 24 * 3600 * 1000;
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });
const seconds = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const thClass = "px-3 py-2 text-left text-xs font-medium text-muted";
const tdClass = "px-3 py-2 tabular-nums";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}

// Usage of the app (from the saved chats) and a repeatable speed benchmark of the installed models.
export function DashboardView({
  models,
  ollamaRunning,
  onClose,
  onOpenSidebar,
}: {
  models: string[];
  ollamaRunning: boolean;
  onClose: () => void;
  onOpenSidebar: () => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loadedAt, setLoadedAt] = useState(0); // "today" for the chart: when the data was loaded
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>(() => models.slice(0, 1));
  const [cold, setCold] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, b] = await Promise.all([fetch("/api/usage").then((r) => r.json()), fetch("/api/benchmark").then((r) => r.json())]);
      setUsage(u);
      setLoadedAt(Date.now());
      setResults(b.results);
      setPrompt(b.prompt);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => {
      clearTimeout(first);
      abortRef.current?.abort();
    };
  }, [load]);

  async function runBenchmark() {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    for (const [i, model] of selected.entries()) {
      setProgress(`Running ${model} (${i + 1} of ${selected.length})… a cold start of a large model takes a while.`);
      try {
        const res = await fetch("/api/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, cold }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Benchmark failed");
      } catch (e) {
        if (!controller.signal.aborted) setError(`${model}: ${e instanceof Error ? e.message : "Benchmark failed"}`);
        break;
      }
    }
    setProgress(null);
    abortRef.current = null;
    await load();
  }

  async function clearResults() {
    await fetch("/api/benchmark", { method: "DELETE" }).catch(() => {});
    await load();
  }

  // Last 30 days, including days without replies.
  const perDay = new Map(usage?.daily.map((d) => [d.day, d]) ?? []);
  const days: Bar[] = Array.from({ length: 30 }, (_, i) => {
    const day = localDay(loadedAt - (29 - i) * DAY);
    const d = perDay.get(day);
    const replies = d?.replies ?? 0;
    return {
      key: day,
      label: shortDate(day),
      value: replies,
      detail: `${replies} ${replies === 1 ? "reply" : "replies"}${d?.tokens ? `, ${formatTokens(d.tokens)} tokens` : ""}`,
    };
  });

  // Latest run of each model.
  const latest = [...new Map([...results].reverse().map((r) => [r.model, r])).values()];
  const fastest = Math.max(...latest.map((r) => r.tokensPerSecond), 0);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <button
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg md:hidden"
        >
          <MenuIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-muted">Usage & benchmark</h1>
        <button
          onClick={onClose}
          aria-label="Close usage and benchmark"
          title="Back to chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <XIcon width={16} height={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-6">
          <section className="flex flex-col gap-5" aria-labelledby="usage-title">
            <h2 id="usage-title" className="text-lg font-semibold tracking-tight">
              Usage
            </h2>
            {usage && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Tile label="Chats" value={String(usage.totals.chats)} />
                  <Tile label="Messages sent" value={String(usage.totals.sent)} />
                  <Tile label="Tokens generated" value={formatTokens(usage.totals.tokens)} />
                  <Tile label="Time generating" value={seconds(usage.totals.generatingMs)} />
                </div>
                <p className="-mt-2 text-xs text-muted">
                  Tokens and time come from reply statistics, which replies saved before they were added don&apos;t have.
                </p>
                <BarChart
                  title="Replies per day, last 30 days"
                  bars={days}
                  format={(n) => String(n)}
                  axisLabels={[days[0].label, "Today"]}
                />
                {usage.models.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Usage by model</caption>
                      <thead className="border-b border-border">
                        <tr>
                          <th className={thClass}>Model</th>
                          <th className={thClass}>Replies</th>
                          <th className={thClass}>Tokens</th>
                          <th className={thClass}>Avg speed</th>
                          <th className={thClass}>Cold starts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.models.map((m) => (
                          <tr key={m.model} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-mono text-[13px]">{m.model}</td>
                            <td className={tdClass}>{m.replies}</td>
                            <td className={tdClass}>{formatTokens(m.tokens)}</td>
                            <td className={tdClass}>{m.avgTokensPerSecond ? `${m.avgTokensPerSecond.toFixed(1)} tok/s` : "—"}</td>
                            <td className={tdClass}>
                              {m.coldStarts ? `${m.coldStarts} (avg ${seconds(m.avgColdLoadMs ?? 0)})` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-4" aria-labelledby="bench-title">
            <div>
              <h2 id="bench-title" className="text-lg font-semibold tracking-tight">
                Benchmark
              </h2>
              <p className="mt-1 text-sm text-muted">
                Every run uses the same prompt with fixed settings (temperature 0, at most 300 tokens), so results compare across
                models and over time. Prompt: <span className="italic">“{prompt}”</span>
              </p>
            </div>

            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2" disabled={progress !== null}>
              <legend className="sr-only">Models to benchmark</legend>
              {models.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(m)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))}
                    className="accent-accent"
                  />
                  <span className="font-mono text-[13px]">{m}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} className="accent-accent" />
                Measure a cold start (unload the model first)
              </label>
            </fieldset>

            <div className="flex items-center gap-3">
              {progress ? (
                <button onClick={() => abortRef.current?.abort()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void runBenchmark()}
                  disabled={!ollamaRunning || selected.length === 0}
                  className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
                >
                  Run benchmark
                </button>
              )}
              <span aria-live="polite" className="text-sm text-muted">
                {progress ?? (!ollamaRunning ? "Start Ollama to run a benchmark." : "")}
              </span>
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            {latest.length > 0 && (
              // One labelled row per model: easy to compare, and still readable with a single model.
              <figure className="flex flex-col gap-2">
                <figcaption className="text-sm font-medium">Generation speed, latest run per model</figcaption>
                <ul className="flex flex-col gap-2">
                  {latest.map((r) => (
                    <li key={r.model} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem] items-center gap-3 text-sm">
                      <span className="truncate font-mono text-[13px]">{r.model}</span>
                      <span className="h-3 overflow-hidden rounded-r-[4px] bg-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-r-[4px] bg-viz-1"
                          style={{ width: `${fastest > 0 ? (r.tokensPerSecond / fastest) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums">{r.tokensPerSecond} tok/s</span>
                    </li>
                  ))}
                </ul>
              </figure>
            )}

            {results.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Benchmark results</caption>
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thClass}>When</th>
                      <th className={thClass}>Model</th>
                      <th className={thClass}>Generation</th>
                      <th className={thClass}>Reading</th>
                      <th className={thClass}>Load</th>
                      <th className={thClass}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className={`${tdClass} text-muted`}>
                          {new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="px-3 py-2 font-mono text-[13px]">{r.model}</td>
                        <td className={tdClass}>{r.tokensPerSecond} tok/s</td>
                        <td className={tdClass}>{r.promptPerSecond} tok/s</td>
                        <td className={tdClass}>
                          {seconds(r.loadMs)}
                          {r.loadMs > 1000 && <span className="text-muted"> · cold</span>}
                        </td>
                        <td className={tdClass}>{seconds(r.totalMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {results.length > 0 && (
              <button onClick={() => void clearResults()} disabled={progress !== null} className="self-start text-xs text-muted hover:text-fg">
                Clear results
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
