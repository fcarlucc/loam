"use client";

import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, PRESETS, parseEngineName, parseEngineUrl } from "@/lib/engines/presets";
import type { EngineConfig, EngineKind, EngineModels } from "@/lib/types";
import { PencilIcon, TrashIcon, XIcon } from "./icons";

const buttonClass = "rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:border-accent disabled:opacity-40";
const fieldClass = "rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

type Draft = { name: string; kind: EngineKind; baseUrl: string };
type TestResult = { ok: true; version?: string; models: number } | { ok: false; error: string };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// The engines the app talks to: add one from a preset or by hand, rename it, change its URL, test it, remove it.
export function EnginesDialog({ engines, onClose, onChanged }: { engines: EngineModels[]; onClose: () => void; onChanged: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [remoteAllowed, setRemoteAllowed] = useState(false);
  const [editing, setEditing] = useState<"new" | string | null>(null); // "new", or the id being edited
  const [draft, setDraft] = useState<Draft>({ name: "", kind: "openai", baseUrl: "" });
  const [tests, setTests] = useState<Record<string, TestResult | "testing">>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    fetch("/api/engines", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { remoteAllowed: boolean }) => setRemoteAllowed(data.remoteAllowed))
      .catch(() => {});
  }, []);

  // Close the native modal first: while it is open the rest of the page is inert.
  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function startAdd(preset?: (typeof PRESETS)[number]) {
    setError(null);
    setEditing("new");
    setDraft(preset ? { name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl } : { name: "", kind: "openai", baseUrl: "" });
  }

  function startEdit(engine: EngineConfig) {
    setError(null);
    setEditing(engine.id);
    setDraft({ name: engine.name, kind: engine.kind, baseUrl: engine.baseUrl });
  }

  // What the page can tell before asking the server (which checks the same rules).
  const problem = (() => {
    if (editing === null) return null;
    if (!parseEngineName(draft.name)) return "Give the engine a name.";
    const url = parseEngineUrl(draft.baseUrl, remoteAllowed);
    return "error" in url ? url.error : null;
  })();

  async function save() {
    if (editing === null || problem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        editing === "new" ? "/api/engines" : `/api/engines/${encodeURIComponent(editing)}`,
        json(editing === "new" ? "POST" : "PATCH", editing === "new" ? draft : { name: draft.name, baseUrl: draft.baseUrl }),
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't save the engine");
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the engine");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/engines/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't remove the engine");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the engine");
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setTests((t) => ({ ...t, [id]: "testing" }));
    try {
      const res = await fetch(`/api/engines/${encodeURIComponent(id)}/test`, { method: "POST" });
      const data = await res.json();
      setTests((t) => ({ ...t, [id]: res.ok ? (data as TestResult) : { ok: false, error: data.error ?? "Something went wrong" } }));
    } catch {
      setTests((t) => ({ ...t, [id]: { ok: false, error: "Couldn't reach the app" } }));
    }
  }

  const form = (
    <div className="flex flex-col gap-3 rounded-xl border border-accent p-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Name</span>
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={40}
          placeholder="e.g. LM Studio"
          aria-label="Engine name"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Kind</span>
        <select
          value={draft.kind}
          disabled={editing !== "new"} // chats remember an engine by id: its kind stays
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as EngineKind })}
          aria-label="Engine kind"
          className={`${fieldClass} disabled:opacity-60`}
        >
          <option value="ollama">{KIND_LABEL.ollama}</option>
          <option value="openai">{KIND_LABEL.openai} (LM Studio, llama.cpp, MLX…)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">URL</span>
        <input
          value={draft.baseUrl}
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder={draft.kind === "ollama" ? "http://localhost:11434" : "http://127.0.0.1:1234/v1"}
          spellCheck={false}
          aria-label="Engine URL"
          className={`${fieldClass} font-mono`}
        />
        <span className="text-xs text-muted">
          {draft.kind === "openai" ? "The server's base URL, usually ending in /v1. " : ""}
          Only engines on this machine are accepted{remoteAllowed ? ", and others since ALLOW_REMOTE_ENGINES is set" : ""}.
        </span>
      </label>
      {problem && draft.baseUrl && <p className="text-xs text-danger">{problem}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !!problem}
          className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {editing === "new" ? "Add engine" : "Save"}
        </button>
      </div>
    </div>
  );

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
      aria-labelledby="engines-title"
      className="m-auto max-h-[85vh] w-[min(94vw,36rem)] rounded-2xl border border-border surface-glossy p-0 text-fg backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-5 pr-2">
          <h2 id="engines-title" className="text-sm font-semibold">
            Engines
          </h2>
          <button onClick={close} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <p className="text-xs text-muted">
            The local AI servers the app talks to. Ollama is built in; add LM Studio, llama.cpp, MLX or any other server that speaks
            the OpenAI chat API. Nothing is sent anywhere else.
          </p>
          {error && (
            <p role="alert" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {engines.map((engine) => {
              const result = tests[engine.id];
              return (
                <li key={engine.id} className="rounded-xl border border-border px-3 py-2.5">
                  {editing === engine.id ? (
                    form
                  ) : confirming === engine.id ? (
                    <div
                      role="group"
                      aria-label={`Remove ${engine.name}?`}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirming(null);
                        }
                      }}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1">Remove {engine.name}? Chats that used it stay, and can go on with another engine.</span>
                      <button onClick={() => void remove(engine.id)} className="rounded-md bg-danger px-2 py-0.5 text-xs font-medium text-black hover:opacity-90">
                        Remove
                      </button>
                      <button autoFocus onClick={() => setConfirming(null)} className="px-2 py-0.5 text-xs text-muted hover:text-fg">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        title={engine.online ? "Online" : "Offline"}
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${engine.online ? "bg-ok" : "bg-danger"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{engine.name}</span>
                          <span className="shrink-0 text-xs font-normal text-muted">{engine.builtin ? "Built in" : KIND_LABEL[engine.kind]}</span>
                          {engine.remote && (
                            <span className="shrink-0 rounded bg-danger/15 px-1 text-xs font-normal text-danger" title="On another machine: your messages leave this computer">
                              Remote
                            </span>
                          )}
                        </p>
                        <p className="truncate font-mono text-xs text-muted">
                          {engine.baseUrl}
                          <span className="font-sans"> · {engine.online ? `${engine.models.length} ${engine.models.length === 1 ? "model" : "models"}` : "offline"}</span>
                        </p>
                        {result && (
                          <p aria-live="polite" className={`mt-1 text-xs ${result === "testing" ? "text-muted" : result.ok ? "text-ok" : "text-danger"}`}>
                            {result === "testing"
                              ? "Testing…"
                              : result.ok
                                ? `Connected${result.version ? ` · v${result.version}` : ""} · ${result.models} ${result.models === 1 ? "model" : "models"}`
                                : result.error}
                          </p>
                        )}
                      </div>
                      <button onClick={() => void test(engine.id)} disabled={result === "testing"} className={buttonClass}>
                        Test connection
                      </button>
                      <button
                        onClick={() => startEdit(engine)}
                        aria-label={`Edit ${engine.name}`}
                        title="Edit"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-fg"
                      >
                        <PencilIcon width={15} height={15} />
                      </button>
                      {!engine.builtin && (
                        <button
                          onClick={() => setConfirming(engine.id)}
                          disabled={busy}
                          aria-label={`Remove ${engine.name}`}
                          title="Remove engine"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-danger disabled:opacity-40"
                        >
                          <TrashIcon width={15} height={15} />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {editing === "new" ? (
            form
          ) : (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Add an engine</h3>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.name} onClick={() => startAdd(p)} title={`${p.note} · ${p.baseUrl}`} className={buttonClass}>
                    {p.name}
                  </button>
                ))}
                <button onClick={() => startAdd()} className={buttonClass}>
                  Other…
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
