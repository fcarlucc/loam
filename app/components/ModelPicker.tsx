"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CATALOG, fitFor } from "@/lib/catalog";
import { CheckIcon, ChevronUpIcon, CubeIcon, DownloadIcon, PlusIcon } from "./icons";
import { FitBadge } from "./FitBadge";
import { InstallDialog } from "./InstallDialog";
import { memoryGb, useSystemInfo } from "./useSystemInfo";

type Installing = { name?: string; sizeGb?: number };

export function ModelPicker({
  models,
  model,
  ollamaRunning,
  disabled,
  onChange,
  onInstalled,
}: {
  models: string[];
  model: string;
  ollamaRunning: boolean;
  disabled: boolean;
  onChange: (model: string) => void;
  onInstalled: (model: string) => void;
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
  // Models that fit this Mac first; ones too big for it last.
  const order = { good: 0, tight: 1, "too-big": 2 };
  const downloadable = CATALOG.filter((c) => !models.includes(c.name))
    .map((c) => ({ ...c, fit: ram === null ? null : fitFor(c.sizeGb, ram) }))
    .sort((a, b) => (a.fit && b.fit ? order[a.fit] - order[b.fit] : 0));
  const startInstall = (target: Installing) => {
    setOpen(false);
    setInstalling(target);
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2";
  const headingClass = "px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted";

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
        title="Choose model"
        className="flex max-w-[14rem] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
      >
        <CubeIcon width={14} height={14} className="shrink-0" />
        <span className="truncate font-mono">{model || (ollamaRunning ? "No model" : "Ollama stopped")}</span>
        <ChevronUpIcon width={14} height={14} className={`shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          onKeyDown={onListKeyDown}
          className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(24rem,60vh)] w-72 overflow-y-auto rounded-xl border border-border surface-glossy p-1.5"
        >
          <p className={`${headingClass} pt-1.5`}>Installed</p>
          {models.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-muted">{ollamaRunning ? "No models installed yet." : "Start Ollama to see your models."}</p>
          )}
          {models.map((m) => (
            <button
              key={m}
              aria-pressed={m === model}
              onClick={() => {
                onChange(m);
                close();
              }}
              className={itemClass}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m}</span>
              {m === model && <CheckIcon width={15} height={15} className="shrink-0 text-accent" />}
            </button>
          ))}

          {ollamaRunning && downloadable.length > 0 && (
            <>
              <p className={`${headingClass} mt-1 border-t border-border pt-2.5`}>Available to download</p>
              {system && (
                <p className="px-2.5 pb-1 text-xs text-muted">
                  For this Mac: {system.chip ? `${system.chip}, ` : ""}
                  {ram} GB of memory
                </p>
              )}
              {downloadable.map((c) => (
                <button
                  key={c.name}
                  onClick={() => startInstall({ name: c.name, sizeGb: c.sizeGb })}
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

          {ollamaRunning && (
            <button onClick={() => startInstall({})} className={`${itemClass} mt-1 border-t border-border pt-2.5`}>
              <PlusIcon width={15} height={15} className="shrink-0" />
              Add another model…
            </button>
          )}
        </div>
      )}

      {installing && (
        <InstallDialog
          initialName={installing.name}
          sizeGb={installing.sizeGb}
          onClose={() => {
            setInstalling(null);
            triggerRef.current?.focus();
          }}
          onInstalled={onInstalled}
        />
      )}
    </div>
  );
}
