"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format";
import { ChevronRightIcon } from "./icons";

// What a reasoning model thought before its reply: open while it thinks, folded once the reply starts.
export function Reasoning({ text, live, ms }: { text: string; live: boolean; ms?: number }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null); // null until the user chooses
  const open = userOpen ?? live;
  const label = live ? "Thinking…" : ms !== undefined ? `Thought for ${formatDuration(ms)}` : "Reasoning";
  return (
    <div className="mb-2 rounded-lg border border-border">
      <button
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-fg"
      >
        <ChevronRightIcon width={14} height={14} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className={live ? "animate-pulse" : ""}>{label}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-muted">{text}</div>
      )}
    </div>
  );
}
