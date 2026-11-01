"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { modelBudgetGb } from "@/lib/catalog";
import { formatBytes, formatTokens, formatUnload } from "@/lib/format";
import { KEEP_ALIVE_CHOICES } from "@/lib/settings";
import type { EngineModels, InstalledModel, LoadedModel, ModelInfo } from "@/lib/types";
import { TrashIcon, XIcon } from "./icons";
import { memoryGb, useSystemInfo } from "./useSystemInfo";

const buttonClass =
  "rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:border-accent disabled:opacity-40";

// Models & memory of an Ollama engine: what is loaded in RAM, how long it stays there, and the models
// installed on disk. Other kinds of engine load and keep models on their own, so this panel is Ollama's.
export function ModelsDialog({ engine, onClose, onModelsChanged }: { engine: EngineModels; onClose: () => void; onModelsChanged: () => void }) {
  const ollamaRunning = engine.online;
  const query = `?engine=${encodeURIComponent(engine.id)}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<LoadedModel[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [keepAlive, setKeepAlive] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<string, ModelInfo | "loading" | "error">>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const system = useSystemInfo();

  const refresh = useCallback(async () => {
    try {
      const [ps, tags] = await Promise.all([
        fetch(`/api/ollama/ps${query}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/ollama/models${query}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setLoaded(ps.models);
      setInstalled(tags.installed);
      setNow(Date.now());
    } catch {}
  }, [query]);

  useEffect(() => {
    dialogRef.current?.showModal();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { keepAlive: number }) => setKeepAlive(data.keepAlive))
      .catch(() => {});
  }, []);

  // Memory changes on its own (models load and unload), so keep the view fresh while open.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh, ollamaRunning]);

  // Close the native modal first: while it is open the rest of the page is inert.
  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function act(key: string, request: () => Promise<Response>) {
    setBusy(key);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Something went wrong");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const json = (method: string, body: unknown) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const unload = (model: string) => act(`unload:${model}`, () => fetch("/api/ollama/unload", json("POST", { engine: engine.id, model })));

  async function remove(model: string) {
    setConfirming(null);
    if (await act(`delete:${model}`, () => fetch("/api/ollama/models", json("DELETE", { engine: engine.id, model })))) onModelsChanged();
  }

  async function changeKeepAlive(seconds: number) {
    setKeepAlive(seconds);
    await act("keepAlive", () => fetch("/api/settings", json("PUT", { keepAlive: seconds })));
  }

  async function toggleDetails(model: string) {
    if (details[model]) {
      setDetails((d) => {
        const next = { ...d };
        delete next[model];
        return next;
      });
      return;
    }
    setDetails((d) => ({ ...d, [model]: "loading" }));
    try {
      const res = await fetch(`/api/ollama/show${query}&model=${encodeURIComponent(model)}`);
      const info = res.ok ? ((await res.json()) as ModelInfo) : "error";
      setDetails((d) => ({ ...d, [model]: info }));
    } catch {
      setDetails((d) => ({ ...d, [model]: "error" }));
    }
  }

  const memoryUsed = loaded.reduce((sum, m) => sum + m.bytes, 0);
  const diskUsed = (installed ?? []).reduce((sum, m) => sum + (m.bytes ?? 0), 0);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      aria-labelledby="models-title"
      className="m-auto max-h-[85vh] w-[min(94vw,36rem)] rounded-2xl border border-border surface-glossy p-0 text-fg backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-5 pr-2">
          <h2 id="models-title" className="text-sm font-semibold">
            Models & memory{engine.builtin ? "" : ` · ${engine.name}`}
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-5">
          {!ollamaRunning && (
            <p className="text-sm text-muted">
              {engine.builtin ? "Ollama is stopped: start it from the sidebar to manage models." : `${engine.name} is offline: start it to manage its models.`}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-muted">
              In memory
              {loaded.length > 0 && <span className="normal-case tracking-normal">{formatBytes(memoryUsed)} in use</span>}
            </h3>
            {system && (
              <p className="text-xs text-muted">
                This Mac: {system.chip ? `${system.chip}, ` : ""}
                {memoryGb(system)} GB of memory, of which about {Math.round(modelBudgetGb(memoryGb(system)))} GB can hold models.
              </p>
            )}
            {loaded.length === 0 ? (
              <p className="text-sm text-muted">No model is loaded. Ollama loads one when you send a message.</p>
            ) : (
              loaded.map((m) => (
                <div key={m.name} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px]">{m.name}</p>
                    <p className="text-xs text-muted">
                      {formatBytes(m.bytes)}
                      {m.contextLength ? ` · context ${formatTokens(m.contextLength)}` : ""}
                      {m.expiresAt ? ` · ${formatUnload(m.expiresAt, now)}` : ""}
                    </p>
                  </div>
                  <button onClick={() => void unload(m.name)} disabled={busy !== null} className={buttonClass}>
                    {busy === `unload:${m.name}` ? "Freeing…" : "Free memory"}
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-1.5">
            <label htmlFor="keep-alive" className="text-xs font-medium uppercase tracking-wide text-muted">
              Keep a model in memory after a reply
            </label>
            <select
              id="keep-alive"
              value={keepAlive ?? ""}
              disabled={keepAlive === null}
              onChange={(e) => void changeKeepAlive(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {KEEP_ALIVE_CHOICES.map((c) => (
                <option key={c.seconds} value={c.seconds}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              Longer means faster replies but the memory stays busy. Applies from the next reply.
            </span>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-muted">
              Installed
              {installed && installed.length > 0 && (
                <span className="normal-case tracking-normal">{formatBytes(diskUsed)} on disk</span>
              )}
            </h3>
            {installed?.length === 0 && <p className="text-sm text-muted">No models installed.</p>}
            {installed?.map((m) => {
              const info = details[m.name];
              return (
                <div key={m.name} className="rounded-xl border border-border px-3 py-2.5">
                  {confirming === m.name ? (
                    <div
                      role="group"
                      aria-label={`Delete ${m.name}?`}
                      onKeyDown={(e) => {
                        // Esc backs out of the confirmation only, not the whole dialog.
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirming(null);
                        }
                      }}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        Delete <span className="font-mono">{m.name}</span>? This frees {formatBytes(m.bytes ?? 0)}; you can download it again later.
                      </span>
                      <button
                        onClick={() => void remove(m.name)}
                        className="rounded-md bg-danger px-2 py-0.5 text-xs font-medium text-black hover:opacity-90"
                      >
                        Delete
                      </button>
                      <button autoFocus onClick={() => setConfirming(null)} className="px-2 py-0.5 text-xs text-muted hover:text-fg">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[13px]">{m.name}</p>
                        <p className="text-xs text-muted">
                          {[m.parameterSize, m.quantization, m.bytes === null ? null : formatBytes(m.bytes)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <button onClick={() => void toggleDetails(m.name)} aria-expanded={!!info} className={buttonClass}>
                        {info ? "Hide details" : "Details"}
                      </button>
                      <button
                        onClick={() => setConfirming(m.name)}
                        disabled={busy !== null}
                        aria-label={`Delete ${m.name}`}
                        title="Delete model"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-danger disabled:opacity-40"
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    </div>
                  )}
                  {info && (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
                      {info === "loading" ? (
                        <dd className="col-span-2 text-muted">Loading…</dd>
                      ) : info === "error" ? (
                        <dd className="col-span-2 text-danger">Couldn&apos;t load the model details.</dd>
                      ) : (
                        <>
                          <dt className="text-muted">Family</dt>
                          <dd>{info.family ?? "—"}</dd>
                          <dt className="text-muted">Parameters</dt>
                          <dd>{info.parameterSize ?? "—"}</dd>
                          <dt className="text-muted">Quantization</dt>
                          <dd>{info.quantization ?? "—"}</dd>
                          <dt className="text-muted">Max context</dt>
                          <dd>{info.contextMax ? `${formatTokens(info.contextMax)} tokens` : "—"}</dd>
                          <dt className="text-muted">Can do</dt>
                          <dd>{info.capabilities?.length ? info.capabilities.join(", ") : "—"}</dd>
                          <dt className="text-muted">License</dt>
                          <dd className="text-muted">{info.license ?? "—"}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </dialog>
  );
}
