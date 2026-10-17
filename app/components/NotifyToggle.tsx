"use client";

import { useSyncExternalStore } from "react";
import { getState, type NotifyState, setEnabled, subscribe } from "@/lib/notify";
import { BellIcon, BellOffIcon } from "./icons";

const titles: Record<Exclude<NotifyState, "unsupported">, string> = {
  on: "Reply notifications are on. Click to turn them off",
  off: "Notify me when a reply finishes while I'm in another app or tab",
  blocked: "Notifications are blocked for this site. Allow them in the browser's site settings",
};

// Bell in the sidebar: a desktop notification when a reply finishes and the user is elsewhere.
export function NotifyToggle() {
  const state = useSyncExternalStore(subscribe, getState, () => "off" as NotifyState);
  if (state === "unsupported") return null;
  const on = state === "on";
  return (
    <button
      aria-pressed={on}
      aria-label="Notify when a reply finishes"
      title={titles[state]}
      onClick={() => void setEnabled(!on)}
      className={`flex w-9 shrink-0 items-center justify-center rounded-lg border surface-glossy transition-colors ${
        on
          ? "border-accent text-accent"
          : state === "blocked"
            ? "cursor-not-allowed border-border text-muted opacity-50"
            : "border-border text-muted hover:text-fg"
      }`}
    >
      {state === "blocked" ? <BellOffIcon width={16} height={16} /> : <BellIcon width={16} height={16} />}
    </button>
  );
}
