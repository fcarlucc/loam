"use client";

import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { matches } from "@/lib/shortcuts";
import { SearchIcon } from "./icons";

// Something the palette can do, run by its id (see onRun). `opens: "models"` switches the palette to the
// list of models instead.
export type Command = {
  id: string;
  group: string;
  label: string;
  keys?: string; // its shortcut, as shown
  hint?: string; // a word on the right (a model's engine)
  keywords?: string; // more words it is found by
  current?: boolean; // the model in use, the theme in use…
  opens?: "models";
};

export type PaletteMode = "all" | "models";

const RECENT_CHATS = 8;
const MAX_CHATS = 30;

// Every word typed must appear somewhere in the label, the keywords or the group; labels that start with
// the query come first.
function filter(items: Command[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const q = query.trim().toLowerCase();
  return items
    .filter((c) => {
      const text = `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .map((c, i) => ({ c, i, rank: c.label.toLowerCase().startsWith(q) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ c }) => c);
}

// ⌘K: find a command, a chat or a model by typing, and run it with Enter. Commands come with their
// shortcut, so the palette also teaches them.
export function CommandPalette({
  commands,
  chats,
  models,
  initialMode = "all",
  onRun,
  onClose,
}: {
  commands: Command[];
  chats: Command[]; // most recent first
  models: Command[];
  initialMode?: PaletteMode;
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  // What is listed, by group, in order: commands and recent chats until something is typed; then whatever
  // matches among commands, every chat and every model.
  const groups = useMemo(() => {
    const typed = query.trim().length > 0;
    const items =
      mode === "models"
        ? filter(models, query)
        : typed
          ? [...filter(commands, query), ...filter(chats, query).slice(0, MAX_CHATS), ...filter(models, query)]
          : [...commands, ...chats.slice(0, RECENT_CHATS)];
    const byGroup = new Map<string, Command[]>();
    for (const item of items) byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
    return [...byGroup].map(([name, list]) => ({ name, list }));
  }, [mode, query, commands, chats, models]);
  const flat = groups.flatMap((g) => g.list);
  const current = flat[Math.min(active, flat.length - 1)];
  const optionId = (c: Command) => `${listId}-${c.id}`;

  // Keep the highlighted entry in view while moving through the list.
  // By id: the lists are rebuilt when chats or engines change, and that alone mustn't move the list.
  const currentId = current?.id;
  useEffect(() => {
    if (currentId) document.getElementById(`${listId}-${currentId}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, currentId]);

  function finish(command?: Command) {
    dialogRef.current?.close();
    restoreRef.current?.focus();
    onClose();
    // After the palette is gone, so a command can move the focus or open a dialog of its own.
    if (command) setTimeout(() => onRun(command.id), 0);
  }

  function choose(command: Command | undefined) {
    if (!command) return;
    if (command.opens === "models") {
      setMode("models");
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    finish(command);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // The shortcut that opens the palette also closes it.
    if (matches(e.nativeEvent, "palette")) {
      e.preventDefault();
      finish();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const index = Math.min(active, flat.length - 1) + (e.key === "ArrowDown" ? 1 : -1);
      setActive((index + flat.length) % flat.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(current);
    } else if (e.key === "Backspace" && !query && mode === "models" && initialMode === "all") {
      e.preventDefault();
      setMode("all");
      setActive(0);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={mode === "models" ? "Choose a model" : "Command palette"}
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) finish();
      }}
      className="mx-auto mt-[12vh] w-[min(94vw,36rem)] rounded-2xl border border-border surface-glossy p-0 text-fg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <SearchIcon width={16} height={16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label={mode === "models" ? "Model" : "Command"}
          placeholder={mode === "models" ? "Choose a model…" : "Type a command, a chat or a model…"}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
        {mode === "models" && initialMode === "all" && <span className="shrink-0 text-xs text-muted">⌫ back</span>}
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
        {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</p>}
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name} className="mb-1 last:mb-0">
            <p aria-hidden className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
              {g.name}
            </p>
            {g.list.map((c) => {
              const selected = c === current;
              return (
                <div
                  key={c.id}
                  id={optionId(c)}
                  role="option"
                  aria-selected={selected}
                  aria-current={c.current || undefined}
                  onMouseMove={() => setActive(flat.indexOf(c))}
                  onClick={() => choose(c)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? "bg-accent-soft" : ""}`}
                >
                  <span className={`min-w-0 flex-1 truncate ${g.name === "Models" ? "font-mono text-[13px]" : ""}`}>{c.label}</span>
                  {c.hint && <span className="shrink-0 truncate text-xs text-muted">{c.hint}</span>}
                  {c.current && <span className="shrink-0 text-xs text-accent">current</span>}
                  {c.keys && <kbd className="shrink-0 font-sans text-xs text-muted">{c.keys}</kbd>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </dialog>
  );
}

// The list of shortcuts (⌘/), also reachable from the palette.
export function ShortcutsDialog({ shortcuts, onClose }: { shortcuts: { label: string; keys: string }[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
  }, []);

  function close() {
    dialogRef.current?.close();
    restoreRef.current?.focus();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="m-auto w-[min(94vw,26rem)] rounded-2xl border border-border surface-glossy p-0 text-fg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-12 items-center justify-between border-b border-border pl-5 pr-2">
        <h2 id="shortcuts-title" className="text-sm font-semibold">
          Keyboard shortcuts
        </h2>
        <button onClick={close} className="rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg">
          Close
        </button>
      </div>
      <dl className="flex flex-col gap-0.5 p-3">
        {shortcuts.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-sm">
            <dt>{s.label}</dt>
            <dd>
              <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-muted">{s.keys}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
