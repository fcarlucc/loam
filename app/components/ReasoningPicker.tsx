"use client";

import { thinkLabel } from "@/lib/settings";
import type { ModelInfo, ThinkValue } from "@/lib/types";
import { BulbIcon, ChevronUpIcon } from "./icons";

// Reasoning off, on or at a level, next to the model picker, for models that can reason.
// Unset means the model's own default. A native select (keyboard, screen readers) sits invisibly over a
// label sized to the current choice, since a select itself is as wide as its longest option.
export function ReasoningPicker({
  options,
  value,
  disabled,
  onChange,
}: {
  options: NonNullable<ModelInfo["thinking"]>;
  value: ThinkValue | undefined;
  disabled: boolean;
  onChange: (value: ThinkValue | undefined) => void;
}) {
  const encode = (v: ThinkValue) => JSON.stringify(v); // "false", "true", "\"low\""
  const choices = options.values.filter((v) => v !== options.default);
  // A value this model doesn't offer (set while another model was in use) is still listed, so it can be changed.
  const foreign = value !== undefined && !options.values.includes(value);
  return (
    <span
      className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors focus-within:bg-surface-2 focus-within:text-fg ${
        disabled ? "opacity-50" : "hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <BulbIcon width={14} height={14} className="shrink-0" />
      <span>Reasoning {thinkLabel(value ?? options.default)}</span>
      <ChevronUpIcon width={14} height={14} className="shrink-0 rotate-180" />
      <select
        value={value === undefined ? "" : encode(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? undefined : (JSON.parse(e.target.value) as ThinkValue))}
        aria-label="Reasoning"
        title="How much the model reasons before replying"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        <option value="">Reasoning {thinkLabel(options.default)} (default)</option>
        {choices.map((v) => (
          <option key={encode(v)} value={encode(v)}>
            Reasoning {thinkLabel(v)}
          </option>
        ))}
        {foreign && <option value={encode(value)}>Reasoning {thinkLabel(value)} (not offered by this model)</option>}
      </select>
    </span>
  );
}
