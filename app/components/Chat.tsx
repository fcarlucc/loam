"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import { notify, snippet, userIsAway } from "@/lib/notify";
import { hasCustomSettings } from "@/lib/settings";
import type { ChatEvent, ChatMessage, ChatSettings as Settings, ModelInfo, Versions } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MenuIcon,
  PencilIcon,
  RefreshIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
} from "./icons";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { Reasoning } from "./Reasoning";
import { ReasoningPicker } from "./ReasoningPicker";
import { nearlyFull, StatsLine } from "./StatsLine";
import { SETTINGS_SIDEBAR_ID, SettingsSidebar } from "./SettingsSidebar";

const SUGGESTIONS = [
  "Explain a hard concept in simple terms",
  "Help me write a TypeScript function",
  "Summarize a text I paste here",
  "Give me ideas for a weekend project",
];

const actionClass =
  "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:text-fg disabled:opacity-40";

// An error Ollama reported in the middle of a reply (sent as an "error" event).
class StreamError extends Error {}

function describeError(e: unknown, accepted: boolean) {
  if (e instanceof StreamError) return e.message;
  if (e instanceof TypeError) return accepted ? "The reply was interrupted." : "Couldn't reach the app. Is it still running?";
  return e instanceof Error ? e.message : "Something went wrong";
}

// What a run asks for: a new message, a new version of a sent message, a new version of a reply,
// or a reply to a message that has none.
type Action =
  | { kind: "send"; content: string }
  | { kind: "edit"; id: number; content: string }
  | { kind: "regenerate"; id: number }
  | { kind: "retry" };


export function Chat({
  chatId,
  focusMessageId,
  initialSettings,
  modelInfo,
  onSaveDefaults,
  title,
  draft,
  onDraftChange,
  ollamaRunning,
  models,
  model,
  onModelChange,
  onModelInstalled,
  onChatCreated,
  onChatsChanged,
  onOpenSidebar,
  settingsOpen,
  onSettingsOpenChange,
}: {
  chatId: number | null;
  focusMessageId: number | null;
  initialSettings: Settings;
  modelInfo: ModelInfo | null;
  onSaveDefaults: (settings: Settings) => Promise<boolean>;
  title: string;
  draft: string;
  onDraftChange: Dispatch<SetStateAction<string>>;
  ollamaRunning: boolean;
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  onModelInstalled: (model: string) => void;
  onChatCreated: (id: number) => void;
  onChatsChanged: () => void;
  onOpenSidebar: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  // The chat this view was opened on. A chat created here later is already on screen, so it isn't reloaded.
  const [openedId] = useState(chatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(openedId !== null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  // A message opened from search: scrolled into view and highlighted for a moment.
  const [highlight, setHighlight] = useState<number | null>(focusMessageId);

  // The reply being streamed: its request, and the chat id once the server has accepted it.
  const activeRef = useRef<{ controller: AbortController; chatId: number | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Content height at the last update, and whether the next update must jump to the bottom.
  const followRef = useRef({ height: 0, force: true });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settingsToggleRef = useRef<HTMLButtonElement>(null);
  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  // Focus moves into the settings only when the user opens them, never when a chat mounts with them open.
  const focusSettingsOnOpen = useRef(false);
  // The current title, for the notification sent when a reply finishes: a new chat gets its title mid-reply.
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    if (openedId === null) return;
    let cancelled = false;
    fetch(`/api/chats/${openedId}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load this chat");
        if (cancelled) return;
        setMessages(data.messages as ChatMessage[]);
        setSettings(data.chat.settings as Settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load this chat");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openedId]);

  // Leaving this chat stops a reply that is still streaming; the server keeps what was already written.
  useEffect(() => () => activeRef.current?.controller.abort(), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // Follow the reply as it streams, unless the user scrolled up to read. The position is compared with the
  // previous content height, so a scroll that hasn't fired its event yet still counts.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { height, force } = followRef.current;
    if (force || el.scrollTop + el.clientHeight >= height - 8) el.scrollTop = el.scrollHeight;
    followRef.current = { height: el.scrollHeight, force: false };
  }, [messages, loading]);

  // After the follow-the-bottom scroll above, so this one wins.
  useEffect(() => {
    if (loading || highlight === null) return;
    document.querySelector(`[data-message-id="${highlight}"]`)?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [loading, highlight]);

  useEffect(() => {
    if (settingsOpen && focusSettingsOnOpen.current) systemPromptRef.current?.focus();
    focusSettingsOnOpen.current = false;
  }, [settingsOpen]);

  function toggleSettings() {
    focusSettingsOnOpen.current = !settingsOpen;
    onSettingsOpenChange(!settingsOpen);
  }

  function closeSettings() {
    onSettingsOpenChange(false);
    settingsToggleRef.current?.focus();
  }

  // A saved chat stores its settings right away; a new one stores them with its first message.
  function changeSettings(next: Settings) {
    setSettings(next);
    if (chatId === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: next }),
      }).catch(() => {});
    }, 400);
  }

  function changeThink(think: Settings["think"]) {
    const next = { ...settings };
    if (think === undefined) delete next.think;
    else next.think = think;
    changeSettings(next);
  }

  // What is sent: a context length above the model's maximum is capped to it.
  const max = modelInfo?.contextMax;
  const effectiveSettings: Settings =
    settings.contextLength !== undefined && max && settings.contextLength > max ? { ...settings, contextLength: max } : settings;

  const ready = ollamaRunning && !!model && !streaming && !loading;
  const last = messages.at(-1);
  const canRetry = !streaming && chatId !== null && last?.role === "user";

  function sendDraft() {
    const content = draft.trim();
    if (!ready || !content) return; // a draft that can't be sent yet stays in the box
    onDraftChange("");
    void run({ kind: "send", content });
  }

  // The server holds the final branch (ids, versions, stats); returns false if it couldn't be loaded.
  async function loadBranch(id: number) {
    try {
      const res = await fetch(`/api/chats/${id}`, { cache: "no-store" });
      if (!res.ok) return false;
      setMessages((await res.json()).messages as ChatMessage[]);
      return true;
    } catch {
      return false;
    }
  }

  async function showVersion(messageId: number) {
    if (chatId === null || streaming) return;
    setEditing(null); // the edited message may not be on the new branch
    try {
      const res = await fetch(`/api/chats/${chatId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) setMessages((await res.json()).messages as ChatMessage[]);
    } catch {}
  }

  // Once the server has the chat it stops the reply itself, saves what was written and ends the stream,
  // so the saved version comes back like any other. Before that, cancelling the request is enough.
  async function stop() {
    const active = activeRef.current;
    if (!active) return;
    if (active.chatId !== null) {
      const res = await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: active.chatId }),
      }).catch(() => null);
      if (res?.ok && (await res.json()).stopped) return;
    }
    active.controller.abort();
  }

  async function run(action: Action) {
    if (!ready || (action.kind !== "send" && chatId === null)) return;

    const before = messages;
    // While the reply streams, the branch is cut where the new version starts.
    const cut = action.kind === "edit" || action.kind === "regenerate" ? before.findIndex((m) => m.id === action.id) : before.length;
    if (cut < 0) return;
    const replaced = action.kind === "regenerate" ? before[cut] : undefined;
    const content = action.kind === "send" || action.kind === "edit" ? action.content : null;

    setError(null);
    setEditing(null);
    setStreaming(true);
    followRef.current.force = true;
    setMessages([
      ...before.slice(0, cut),
      ...(content !== null ? [{ role: "user" as const, content }] : []),
      { role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    const active = { controller, chatId: null as number | null };
    activeRef.current = active;
    let accepted = false;
    let text = ""; // the reply so far
    let failure: string | null = null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          model,
          settings: effectiveSettings,
          ...(action.kind === "send"
            ? { content: action.content }
            : action.kind === "edit"
              ? { content: action.content, editOf: action.id }
              : action.kind === "regenerate"
                ? { regenerate: action.id }
                : { retry: true }),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Something went wrong");
      accepted = true;
      const savedId = Number(res.headers.get("X-Chat-Id"));
      active.chatId = Number.isSafeInteger(savedId) ? savedId : chatId;
      if (chatId === null && active.chatId !== null) onChatCreated(active.chatId);
      onChatsChanged(); // the message is saved: show the chat and its title in the sidebar right away

      let finished = false;
      for await (const event of readNdjson<ChatEvent>(res.body)) {
        if (controller.signal.aborted) break;
        if (event.type === "error") throw new StreamError(event.message);
        if (event.type === "done") finished = true;
        if (event.type === "delta") text += event.text;
        setMessages((m) => {
          const tail = m[m.length - 1];
          const next =
            event.type === "delta"
              ? { ...tail, content: tail.content + event.text }
              : event.type === "thinking"
                ? { ...tail, thinking: (tail.thinking ?? "") + event.text }
                : { ...tail, stats: event.stats };
          return [...m.slice(0, -1), next];
        });
      }
      if (!finished && !controller.signal.aborted) throw new TypeError("stream ended early");
    } catch (e) {
      if (!controller.signal.aborted) {
        failure = describeError(e, accepted);
        setError(failure);
      }
    } finally {
      // The reply ended while the user was in another app or tab: tell them, if they asked for it.
      if (accepted && !controller.signal.aborted && userIsAway()) {
        notify(failure ? { title: "Reply failed", body: failure } : { title: titleRef.current || "Reply ready", body: snippet(text) });
      }
      if (!accepted) {
        // Nothing was saved: restore the conversation and give the text back.
        setMessages(before);
        if (action.kind === "send") onDraftChange((d) => d || action.content);
        if (action.kind === "edit") setEditing({ id: action.id, text: action.content });
      } else if (controller.signal.aborted || active.chatId === null || !(await loadBranch(active.chatId))) {
        // Couldn't reload the saved branch: drop the empty bubble, or bring back the reply being regenerated.
        setMessages((m) => {
          const tail = m.at(-1);
          if (tail?.role !== "assistant" || tail.content) return m;
          return replaced ? [...m.slice(0, -1), replaced] : m.slice(0, -1);
        });
      }
      if (activeRef.current === active) activeRef.current = null;
      setStreaming(false);
      onChatsChanged();
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
          <button
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg md:hidden"
          >
            <MenuIcon />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{title}</p>
          <button
            ref={settingsToggleRef}
            onClick={toggleSettings}
            aria-expanded={settingsOpen}
            aria-controls={SETTINGS_SIDEBAR_ID}
            aria-label={hasCustomSettings(settings) ? "Chat settings (customized)" : "Chat settings"}
            title="Chat settings"
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 hover:text-fg ${
              settingsOpen ? "bg-surface-2 text-fg" : "text-muted"
            }`}
          >
            <SlidersIcon width={17} height={17} />
            {hasCustomSettings(settings) && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="pt-24 text-center text-sm text-muted">Loading chat…</p>
          ) : messages.length === 0 && !error ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">How can I help?</h1>
                <p className="mt-2 text-muted">
                  {ollamaRunning ? "Your local model is ready." : "Ollama is stopped: start it from the sidebar to begin."}
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void run({ kind: "send", content: s })}
                    disabled={!ready}
                    className="rounded-xl border border-border surface-glossy px-4 py-3 text-left text-sm transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const key = m.id ?? `pending-${i}`;
                if (m.role === "user") {
                  if (editing && m.id === editing.id) {
                    return (
                      <EditMessage
                        key={key}
                        initial={editing.text}
                        disabled={!ready}
                        onCancel={() => setEditing(null)}
                        onSubmit={(text) => void run({ kind: "edit", id: editing.id, content: text })}
                      />
                    );
                  }
                  return (
                    <div key={key} data-message-id={m.id} className="group/msg ml-auto flex max-w-[85%] flex-col items-end gap-1">
                      <div
                        className={`whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-grad px-4 py-2.5 text-accent-fg transition-shadow ${
                          highlight !== null && m.id === highlight ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
                        }`}
                      >
                        {m.content}
                      </div>
                      {m.id !== undefined && !streaming && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditing({ id: m.id!, text: m.content })}
                            className={`${actionClass} opacity-0 focus-visible:opacity-100 group-hover/msg:opacity-100`}
                          >
                            <PencilIcon width={14} height={14} />
                            Edit
                          </button>
                          {m.versions && <VersionNav versions={m.versions} onSelect={showVersion} />}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={key}
                    data-message-id={m.id}
                    className={`group/msg max-w-[95%] rounded-xl transition-shadow ${
                      highlight !== null && m.id === highlight ? "ring-2 ring-accent ring-offset-4 ring-offset-bg" : ""
                    }`}
                  >
                    {m.thinking && <Reasoning text={m.thinking} live={streaming && isLast && !m.content} ms={m.stats?.thinkingMs} />}
                    {m.content ? <Markdown>{m.content}</Markdown> : streaming && isLast && !m.thinking && <TypingDots />}
                    {m.content && !(streaming && isLast) && (
                      // The latest reply, and replies with versions, always show their actions; others on hover or focus.
                      <div
                        className={`mt-1 flex flex-wrap items-center gap-1 transition-opacity ${
                          isLast || m.versions ? "" : "opacity-0 focus-within:opacity-100 group-hover/msg:opacity-100"
                        }`}
                      >
                        {m.versions && <VersionNav versions={m.versions} disabled={streaming} onSelect={showVersion} />}
                        <CopyButton text={m.content} label="Copy" />
                        {isLast && m.id !== undefined && (
                          <button onClick={() => void run({ kind: "regenerate", id: m.id! })} disabled={!ready} className={actionClass}>
                            <RefreshIcon width={14} height={14} />
                            Regenerate
                          </button>
                        )}
                        {m.stats && <StatsLine stats={m.stats} />}
                      </div>
                    )}
                    {isLast && !streaming && nearlyFull(m.stats) && (
                      <p className="mt-1 px-1.5 text-xs text-danger">
                        This chat is close to the model&apos;s context limit: the oldest messages will be left out. Start a new chat,
                        or raise the context length in the chat settings if the model allows it.
                      </p>
                    )}
                  </div>
                );
              })}
              {(error || canRetry) && (
                <div
                  role={error ? "alert" : undefined}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                >
                  <span className={`min-w-0 flex-1 ${error ? "text-danger" : "text-muted"}`}>
                    {error ?? "This message has no reply yet."}
                  </span>
                  {canRetry && (
                    <button onClick={() => void run({ kind: "retry" })} disabled={!ready} className={actionClass}>
                      <RefreshIcon width={14} height={14} />
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="mx-auto flex max-w-3xl flex-col rounded-2xl border border-border surface-glossy p-2 focus-within:border-accent">
            <textarea
              ref={textareaRef}
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendDraft();
                }
              }}
              rows={1}
              placeholder={ollamaRunning ? "Write a message…" : "Start Ollama to write"}
              disabled={!ollamaRunning}
              aria-label="Message"
              className="max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <ModelPicker
                  models={models}
                  model={model}
                  ollamaRunning={ollamaRunning}
                  disabled={streaming}
                  onChange={onModelChange}
                  onInstalled={onModelInstalled}
                />
                {modelInfo?.thinking && (
                  <ReasoningPicker options={modelInfo.thinking} value={settings.think} disabled={streaming} onChange={changeThink} />
                )}
              </div>
              {streaming ? (
                <button
                  onClick={() => void stop()}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg transition-colors hover:border-accent"
                >
                  <StopIcon width={14} height={14} />
                </button>
              ) : (
                <button
                  onClick={sendDraft}
                  disabled={!ready || !draft.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-grad text-accent-fg transition-opacity disabled:opacity-30"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
      <SettingsSidebar
        open={settingsOpen}
        settings={settings}
        modelInfo={modelInfo}
        systemRef={systemPromptRef}
        onChange={changeSettings}
        onSaveDefaults={() => onSaveDefaults(settings)}
        onClose={closeSettings}
      />
    </div>
  );
}

// ◀ 2/3 ▶ between the versions of a message.
function VersionNav({ versions, disabled = false, onSelect }: { versions: Versions; disabled?: boolean; onSelect: (id: number) => void }) {
  const { ids, index } = versions;
  const navClass = "rounded-md p-1 transition-colors hover:text-fg disabled:opacity-30";
  return (
    <span className="flex items-center text-xs text-muted tabular-nums">
      <button onClick={() => onSelect(ids[index - 1])} disabled={disabled || index === 0} aria-label="Previous version" className={navClass}>
        <ChevronLeftIcon width={14} height={14} />
      </button>
      <span aria-hidden>
        {index + 1}/{ids.length}
      </span>
      <span className="sr-only">
        Version {index + 1} of {ids.length}
      </span>
      <button
        onClick={() => onSelect(ids[index + 1])}
        disabled={disabled || index === ids.length - 1}
        aria-label="Next version"
        className={navClass}
      >
        <ChevronRightIcon width={14} height={14} />
      </button>
    </span>
  );
}

// Inline editor for a sent message. Sending it adds a new version; the original stays one click away.
function EditMessage({
  initial,
  disabled,
  onCancel,
  onSubmit,
}: {
  initial: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  const canSend = !disabled && text.trim().length > 0;
  const submit = () => {
    if (canSend) onSubmit(text.trim());
  };

  return (
    <div className="ml-auto flex w-full max-w-[85%] flex-col gap-2 rounded-2xl border border-accent surface-glossy p-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={1}
        aria-label="Edit message"
        className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto px-2 text-xs text-muted">The original stays available as a version.</span>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSend}
          className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export function TypingDots() {
  return (
    <span role="status" className="inline-flex gap-1 align-middle">
      <span className="sr-only">The model is thinking…</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-muted"
          style={{ animation: "pulse-dot 1s ease-in-out infinite", animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
