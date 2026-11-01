"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CATALOG, fitFor } from "@/lib/catalog";
import { KIND_LABEL } from "@/lib/engines/presets";
import type { EngineModels, ModelChoice } from "@/lib/types";
import { CheckIcon, ChevronUpIcon, CubeIcon, DownloadIcon, PlusIcon } from "./icons";
import { FitBadge } from "./FitBadge";
import { InstallDialog } from "./InstallDialog";
import { memoryGb, useSystemInfo } from "./useSystemInfo";

type Installing = { engine: string; name?: string; sizeGb?: number };

// The model to chat with, grouped by engine. Engines that don't answer are listed too, so it is clear
// where a model went. Downloads are offered under Ollama engines only: the others load models themselves.
export function ModelPicker({
  engines,
  choice,
  disabled,
  onChange,
  onInstalled,
}: {
  engines: EngineModels[];
  choice: ModelChoice;
  disabled: boolean;
  onChange: (choice: ModelChoice) => void;
  onInstalled: (engine: string, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState<Installing | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // On open, focus the current model (or the first entry) so the list works from the keyboard.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    (list?.querySelector<HTMLElement>("[aria-pressed=true]") ?? list?.querySelector<HTMLElement>("button"))?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  const system = useSystemInfo();
  const ram = system ? memoryGb(system) : null;
  const current = engines.find((e) => e.id === choice.engine);
  // Models that fit this Mac first; ones too big for it last. Offered under the built-in Ollama.
  const order = { good: 0, tight: 1, "too-big": 2 };
  const downloadable = (installed: string[]) =>
    CATALOG.filter((c) => !installed.includes(c.name))
      .map((c) => ({ ...c, fit: ram === null ? null : fitFor(c.sizeGb, ram) }))
      .sort((a, b) => (a.fit && b.fit ? order[a.fit] - order[b.fit] : 0));
  const startInstall = (target: Installing) => {
    setOpen(false);
    setInstalling(target);
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2";
  const headingClass = "flex items-center gap-1.5 px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted";

  const label = choice.model || (current ? (current.online ? "No model" : current.builtin ? "Ollama stopped" : `${current.name} offline`) : "No engine");

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        // Close when keyboard focus leaves the picker.
        // A click on plain text inside moves focus nowhere (relatedTarget null): that must not close it,
        // and clicks outside are handled by the mousedown listener.
        if (open && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        title={current && engines.length > 1 ? `Choose model (${current.name})` : "Choose model"}
        className="flex max-w-[14rem] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
      >
        <CubeIcon width={14} height={14} className="shrink-0" />
        <span className="truncate font-mono">{label}</span>
        <ChevronUpIcon width={14} height={14} className={`shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          onKeyDown={onListKeyDown}
          className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(24rem,60vh)] w-72 overflow-y-auto rounded-xl border border-border surface-glossy p-1.5"
        >
          {engines.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">No engine is set up.</p>}
          {engines.map((engine, i) => {
            return (
              <div key={engine.id} className={i > 0 ? "mt-1 border-t border-border pt-2" : ""}>
                <p className={`${headingClass} pt-1.5`}>
                  <span className="truncate">{engines.length > 1 || !engine.builtin ? engine.name : "Installed"}</span>
                  {engine.kind === "openai" && <span className="normal-case tracking-normal text-muted/70">{KIND_LABEL.openai}</span>}
                  {engine.remote && <span className="rounded bg-danger/15 px-1 normal-case tracking-normal text-danger">Remote</span>}
                  {!engine.online && (
                    <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-danger">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" />
                      offline
                    </span>
                  )}
                </p>
                {!engine.online && (
                  <p className="px-2.5 py-2 text-sm text-muted">
                    {engine.builtin ? "Start Ollama to see your models." : (engine.error ?? `Start ${engine.name} to see its models.`)}
                  </p>
                )}
                {engine.online && engine.models.length === 0 && (
                  <p className="px-2.5 py-2 text-sm text-muted">{engine.kind === "ollama" ? "No models installed yet." : "No model is loaded."}</p>
                )}
                {engine.models.map((m) => {
                  const selected = engine.id === choice.engine && m === choice.model;
                  return (
                    <button
                      key={m}
                      aria-pressed={selected}
                      onClick={() => {
                        onChange({ engine: engine.id, model: m });
                        close();
                      }}
                      className={itemClass}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m}</span>
                      {selected && <CheckIcon width={15} height={15} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Downloads come after every engine's models, so other engines aren't pushed out of sight. */}
          {engines
            .filter((engine) => engine.kind === "ollama" && engine.online)
            .map((engine) => {
              const catalog = engine.builtin ? downloadable(engine.models) : [];
              return (
                <div key={`add-${engine.id}`}>
                  {catalog.length > 0 && (
                    <>
                      <p className={`${headingClass} mt-1 border-t border-border pt-2.5`}>
                        Available to download{engines.length > 1 ? ` to ${engine.name}` : ""}
                      </p>
                    {system && (
                      <p className="px-2.5 pb-1 text-xs text-muted">
                        For this Mac: {system.chip ? `${system.chip}, ` : ""}
                        {ram} GB of memory
                      </p>
                    )}
                      {catalog.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => startInstall({ engine: engine.id, name: c.name, sizeGb: c.sizeGb })}
                          aria-label={`Download ${c.label}, about ${c.sizeGb} GB${c.fit ? `, ${c.fit === "good" ? "runs well" : c.fit === "tight" ? "tight fit" : "too big"} on this Mac` : ""}`}
                          className={itemClass}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-muted">{c.label}</span>
                            <span className="block truncate text-xs text-muted/70">
                              {c.note} · ~{c.sizeGb} GB
                            </span>
                          </span>
                          {c.fit && <FitBadge fit={c.fit} />}
                          <DownloadIcon width={15} height={15} className="shrink-0 text-muted" />
                        </button>
                      ))}
                    </>
                  )}
                  <button onClick={() => startInstall({ engine: engine.id })} className={`${itemClass} mt-1 border-t border-border pt-2.5`}>
                    <PlusIcon width={15} height={15} className="shrink-0" />
                    {engines.length > 1 ? `Add a model to ${engine.name}…` : "Add another model…"}
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {installing && (
        <InstallDialog
          engine={installing.engine}
          initialName={installing.name}
          sizeGb={installing.sizeGb}
          onClose={() => {
            setInstalling(null);
            triggerRef.current?.focus();
          }}
          onInstalled={(name) => onInstalled(installing.engine, name)}
        />
      )}
    </div>
  );
}
