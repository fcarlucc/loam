"use client";

import { useSyncExternalStore } from "react";
import { getPref, setPref, subscribe, type ThemePref } from "@/lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const options: { value: ThemePref; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "system", label: "Match system", Icon: MonitorIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, getPref, () => "system" as ThemePref);

  return (
    <div role="group" aria-label="Theme" className="flex rounded-lg border border-border surface-glossy p-0.5">
      {options.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setPref(value)}
            className={`flex h-7 flex-1 items-center justify-center rounded-md transition-colors ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"
            }`}
          >
            <Icon width={16} height={16} />
          </button>
        );
      })}
    </div>
  );
}
