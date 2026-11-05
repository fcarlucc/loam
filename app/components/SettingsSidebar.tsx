"use client";

import { type RefObject, useId, useState } from "react";
import { formatTokens } from "@/lib/format";
import { CONTEXT_CHOICES, hasCustomSettings, SYSTEM_PROMPT_MAX } from "@/lib/settings";
import type { ChatSettings, ModelInfo } from "@/lib/types";
import { XIcon } from "./icons";

export const SETTINGS_SIDEBAR_ID = "chat-settings";

const fieldClass = "rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

// Right-hand sidebar with the current chat's settings. Docked next to the chat on large screens,
// a drawer over it on smaller ones. Always rendered (inert when closed) so it can slide in and out.
export function SettingsSidebar({
  open,
  settings,
  modelInfo,
  contextLength = true,
  systemRef,
  onChange,
  onSaveDefaults,
  onClose,
}: {
  open: boolean;
  settings: ChatSettings;
  modelInfo: ModelInfo | null;
  // Whether the chat's engine applies a per-chat context length (OpenAI-compatible servers decide it themselves).
  contextLength?: boolean;
  systemRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (settings: ChatSettings) => void;
  onSaveDefaults: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [savedAsDefault, setSavedAsDefault] = useState(false);
  const temperatureId = useId();

  function update(patch: ChatSettings, remove?: keyof ChatSettings) {
    const next = { ...settings, ...patch };
    if (remove) delete next[remove];
    setSavedAsDefault(false);
    onChange(next);
  }

  const max = modelInfo?.contextMax ?? null;
  const choices = CONTEXT_CHOICES.filter((n) => max === null || n <= max);
  const tooLarge = settings.contextLength !== undefined && max !== null && settings.contextLength > max;

  return (
    <>
      {/* Small screens: the drawer covers the chat, a click on the dimmed area closes it (X and Esc do too) */}
      {open && <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}
      <aside
        id={SETTINGS_SIDEBAR_ID}
        aria-label="Chat settings"
        inert={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className={`fixed inset-y-0 right-0 z-40 transition-[translate,width] duration-200 motion-reduce:transition-none lg:relative lg:z-auto lg:translate-x-0 lg:overflow-hidden ${
          open ? "translate-x-0 lg:w-80" : "translate-x-full lg:w-0"
        }`}
      >
        <div className="flex h-full w-80 max-w-[85vw] flex-col border-l border-border bg-panel shadow-card lg:max-w-none lg:shadow-none">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
            <h2 className="text-sm font-semibold">Chat settings</h2>
            <button
              onClick={onClose}
              aria-label="Close chat settings"
              title="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <XIcon width={16} height={16} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <p className="text-xs text-muted">These settings apply to this chat only.</p>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">System prompt</span>
              <textarea
                ref={systemRef}
                value={settings.system ?? ""}
                onChange={(e) => (e.target.value ? update({ system: e.target.value }) : update({}, "system"))}
                rows={6}
                maxLength={SYSTEM_PROMPT_MAX}
                placeholder="e.g. Keep answers short and use bullet points."
                className={`${fieldClass} resize-y`}
              />
              <span className="text-xs text-muted">Instructions the model follows for the whole conversation.</span>
            </label>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={temperatureId} className="text-xs font-medium">
                  Temperature
                </label>
                <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
                  {settings.temperature !== undefined
                    ? settings.temperature.toFixed(1)
                    : modelInfo?.temperature != null
                      ? `Model default (${modelInfo.temperature})`
                      : "Model default"}
                  {settings.temperature !== undefined && (
                    <button onClick={() => update({}, "temperature")} className="text-accent hover:underline">
                      Reset
                    </button>
                  )}
                </span>
              </div>
              <input
                id={temperatureId}
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.temperature ?? modelInfo?.temperature ?? 0.8}
                onChange={(e) => update({ temperature: Number(e.target.value) })}
                className={`accent-accent ${settings.temperature === undefined ? "opacity-50" : ""}`}
              />
              <div className="flex justify-between text-[11px] text-muted">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>

            {contextLength && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Context length</span>
                <select
                  value={settings.contextLength ?? ""}
                  onChange={(e) => (e.target.value ? update({ contextLength: Number(e.target.value) }) : update({}, "contextLength"))}
                  className={fieldClass}
                >
                  <option value="">Automatic{max !== null ? ` (up to ${formatTokens(max)})` : ""}</option>
                  {choices.map((n) => (
                    <option key={n} value={n}>
                      {formatTokens(n)} tokens
                    </option>
                  ))}
                  {tooLarge && (
                    <option value={settings.contextLength}>
                      {formatTokens(settings.contextLength!)} tokens (more than this model supports)
                    </option>
                  )}
                </select>
                <span className="text-xs text-muted">
                  How much of the conversation the model can see. Larger values use more memory. Changing it reloads the model, and
                  so does switching between chats with different values.
                </span>
              </label>
            )}

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={settings.autoCompact ?? false}
                onChange={(e) => (e.target.checked ? update({ autoCompact: true }) : update({}, "autoCompact"))}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col gap-1">
                <span className="text-xs font-medium">Compact automatically</span>
                <span className="text-xs text-muted">
                  When the conversation nearly fills the context, the model summarizes the older messages before your next one is
                  sent, instead of losing them.
                </span>
              </span>
            </label>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-4">
            <button
              onClick={() => {
                setSavedAsDefault(false);
                onChange({});
              }}
              disabled={!hasCustomSettings(settings)}
              className="text-xs text-muted hover:text-fg disabled:opacity-40"
            >
              Reset to model defaults
            </button>
            <button
              onClick={async () => setSavedAsDefault(await onSaveDefaults())}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:border-accent"
            >
              {savedAsDefault ? "Saved for new chats ✓" : "Use for new chats"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
