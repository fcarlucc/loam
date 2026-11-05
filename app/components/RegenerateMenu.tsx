"use client";

import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { EngineModels, ModelChoice } from "@/lib/types";
import { CheckIcon, ChevronUpIcon } from "./icons";

const MENU_WIDTH = 288;
const MARGIN = 12; // kept clear of the window's edges

// "Regenerate with…": the models of every engine that answers, to write a new version of a reply with
// another model once. The list is fixed to the window, so the chat's scroll area can't cut it off; it opens
// above the button, or below when there is more room there.
export function RegenerateMenu({
  engines,
  current,
  disabled,
  className,
  onPick,
}: {
  engines: EngineModels[];
  current: ModelChoice;
  disabled: boolean;
  className: string;
  onPick: (choice: ModelChoice) => void;
}) {
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const open = place !== null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const available = engines.filter((e) => e.online && e.models.length > 0);

  function show() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - MENU_WIDTH - MARGIN));
    const above = rect.top - MARGIN;
    const below = window.innerHeight - rect.bottom - MARGIN;
    setPlace(
      above >= below
        ? { left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(160, above - 4) }
        : { left, top: rect.bottom + 4, maxHeight: Math.max(160, below - 4) },
    );
  }

  function close(refocus = true) {
    setPlace(null);
    if (refocus) buttonRef.current?.focus();
  }

  // Focus the current model (or the first one) so the list works from the keyboard.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>("[aria-current=true]") ?? list?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // A click elsewhere, a scroll of the chat or a resized window closes it: it is placed for where the button was.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) setPlace(null);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setPlace(null);
    };
    const onResize = () => setPlace(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    // Tab leaves from the button, so focus goes on to the next control instead of falling off the page.
    if (e.key === "Tab") {
      buttonRef.current?.focus();
      setPlace(null);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  const showEngineNames = available.length > 1 || available.some((e) => !e.builtin);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => (open ? close() : show())}
        disabled={disabled || available.length === 0}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label="Try another model"
        title="Regenerate with another model"
        className={className}
      >
        <ChevronUpIcon width={13} height={13} className={`transition-transform ${open && place.top === undefined ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="group"
          aria-label="Regenerate with"
          onKeyDown={onKeyDown}
          style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, width: MENU_WIDTH }}
          className="fixed z-40 overflow-y-auto rounded-xl border border-border surface-glossy p-1.5 shadow-card"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-xs text-muted">Write a new version with</p>
          {available.map((engine, i) => (
            <div key={engine.id} className={i > 0 ? "mt-1 border-t border-border pt-1.5" : ""}>
              {showEngineNames && (
                <p className="truncate px-2.5 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted">{engine.name}</p>
              )}
              {engine.models.map((m) => {
                const isCurrent = engine.id === current.engine && m === current.model;
                return (
                  <button
                    key={m}
                    aria-current={isCurrent}
                    title={isCurrent ? "The chat's model: the same as Regenerate" : undefined}
                    onClick={() => {
                      close();
                      onPick({ engine: engine.id, model: m });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m}</span>
                    {isCurrent && (
                      <>
                        <CheckIcon width={15} height={15} className="shrink-0 text-accent" />
                        <span className="sr-only">(the chat&apos;s model)</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
