"use client";

import { type Dispatch, Fragment, type Ref, type SetStateAction, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from "@/lib/attachments";
import { compactionRange } from "@/lib/compact";
import { formatTokens } from "@/lib/format";
import { readNdjson } from "@/lib/ndjson";
import { notify, snippet, userIsAway } from "@/lib/notify";
import { keysOf } from "@/lib/shortcuts";
import { hasCustomSettings } from "@/lib/settings";
import { MAX_TEMPORARY_MESSAGES, TEMPORARY_FILES_TOO_BIG, TEMPORARY_TOO_LONG } from "@/lib/temporary";
import type { ChatEvent, ChatMessage, ChatSettings as Settings, ChatSummary, EngineModels, ModelChoice, ModelInfo, NewAttachment, Versions } from "@/lib/types";
import { acceptFor, AttachmentChips, blobOf, metaOf, readFiles, sizeOf, textTokens } from "./Attachments";
import { CopyButton } from "./CopyButton";
import {
  BranchIcon,
  CompactIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MenuIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
  TemporaryIcon,
  XIcon,
} from "./icons";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { Reasoning } from "./Reasoning";
import { ReasoningPicker } from "./ReasoningPicker";
import { RegenerateMenu } from "./RegenerateMenu";
import { StatsLine } from "./StatsLine";
import { SETTINGS_SIDEBAR_ID, SettingsSidebar } from "./SettingsSidebar";
import { offlineLabel } from "./useEngines";

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

// The settings as another model takes them, for a reply it writes once: the context length capped to its
// window, and a reasoning setting it doesn't offer left out (it then reasons as it does by default). Unknown
// details (an engine that can't tell) change nothing.
function fitSettings(settings: Settings, info: ModelInfo | null): Settings {
  const out = { ...settings };
  const max = info?.contextMax;
  if (out.contextLength !== undefined && max && out.contextLength > max) out.contextLength = max;
  if (out.think !== undefined && info && !info.thinking?.values.includes(out.think)) delete out.think;
  return out;
}

// An engine that doesn't report its context size: the latest reply offers to compact from this many tokens.
const UNKNOWN_CONTEXT_OFFER = 2048;
// Past this share of the context, the oldest messages are about to be left out (as StatsLine shows it).
const NEARLY_FULL = 0.9;
// The largest context a compaction accepts (see /api/chats/[id]/compact).
const MAX_CONTEXT = 1_048_576;

// What a run asks for: a new message, a new version of a sent message, a new version of a reply (by
// another model once, with `with`), or a reply to a message that has none.
type Action =
  | { kind: "send"; content: string; attachments?: NewAttachment[] }
  | { kind: "edit"; id: number; content: string }
  | { kind: "regenerate"; id: number; with?: ModelChoice }
  | { kind: "retry" };

// A message as the page holds it. In a temporary chat `files` keeps the attached files themselves, since the
// page sends the whole conversation with every message and the server keeps nothing.
type Message = ChatMessage & { files?: NewAttachment[] };

// What the app's shortcuts and command palette can do in the chat on screen.
export type ChatHandle = {
  focusComposer: () => void;
  regenerate: () => void;
  stop: () => void;
  toggleSettings: () => void;
  compact: () => void;
  state: () => { streaming: boolean; canRegenerate: boolean; canCompact: boolean };
};

export function Chat({
  ref,
  chatId,
  temporary,
  onTemporaryChange,
  focusMessageId,
  initialSettings,
  modelInfo,
  onSaveDefaults,
  title,
  branchOf,
  onBranched,
  onOpenChat,
  draft,
  onDraftChange,
  engines,
  choice,
  onChoose,
  onModelInstalled,
  onChatCreated,
  onChatsChanged,
  onOpenSidebar,
  settingsOpen,
  onSettingsOpenChange,
}: {
  ref?: Ref<ChatHandle>;
  chatId: number | null;
  // A temporary chat is never saved: it lives in this view only and is gone once the user leaves it.
  temporary: boolean;
  onTemporaryChange: (on: boolean) => void;
  focusMessageId: number | null;
  initialSettings: Settings;
  modelInfo: ModelInfo | null;
  onSaveDefaults: (settings: Settings) => Promise<boolean>;
  title: string;
  branchOf: { id: number; title: string } | null;
  onBranched: (chat: ChatSummary) => void;
  onOpenChat: (id: number) => void;
  draft: string;
  onDraftChange: Dispatch<SetStateAction<string>>;
  engines: EngineModels[];
  choice: ModelChoice;
  onChoose: (choice: ModelChoice) => void;
  onModelInstalled: (engine: string, model: string) => void;
  onChatCreated: (id: number) => void;
  onChatsChanged: () => void;
  onOpenSidebar: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}) {
  // The chat this view was opened on. A chat created here later is already on screen, so it isn't reloaded.
  const [openedId] = useState(chatId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(openedId !== null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [branching, setBranching] = useState(false);
  // A compaction under way (see compact), and whether a message waits for it to be sent.
  const [compacting, setCompacting] = useState(false);
  const compactRef = useRef<AbortController | null>(null);
  const sendAfterCompact = useRef(false);
  // Shown while the summary is written: the message in the box waits for it (see sendDraft).
  const [holding, setHolding] = useState(false);
  // The summary of a compacted chat, opened under its marker.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // A message opened from search: scrolled into view and highlighted for a moment.
  const [highlight, setHighlight] = useState<number | null>(focusMessageId);
  // Files waiting in the composer, what was wrong with the last ones added, and whether files hover over the chat.
  const [pending, setPending] = useState<NewAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ids for the messages of a temporary chat, which the server never numbers: negative, so they can't clash.
  const lastLocalId = useRef(0);
  const localId = () => --lastLocalId.current;
  // Links to a temporary chat's files (blob: URLs), released when the chat goes.
  const fileUrls = useRef<string[]>([]);
  useEffect(() => () => fileUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

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

  // Leaving this chat stops a reply that is still streaming (the server keeps what was already written)
  // and a compaction still under way (nothing is kept).
  useEffect(
    () => () => {
      activeRef.current?.controller.abort();
      compactRef.current?.abort();
    },
    [],
  );

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

  // The engine and model messages go to; nothing can be sent while the engine doesn't answer.
  const engine = engines.find((e) => e.id === choice.engine);
  const online = engine?.online ?? false;
  const model = choice.model;
  const ready = online && !!model && !streaming && !loading && !compacting;
  const last = messages.at(-1);
  const canRetry = !streaming && (chatId !== null || temporary) && last?.role === "user";
  // In a branched chat, the last message copied from the chat it came from (-1 elsewhere).
  const branchPoint = messages.findLastIndex((m) => m.copied);
  // Replies name their model where it tells them apart: in a chat written by several, and between versions.
  const severalModels = new Set(messages.flatMap((m) => (m.role === "assistant" && m.model ? [`${m.engine}/${m.model}`] : []))).size > 1;

  function sendDraft(compacted = false) {
    const content = draft.trim();
    if (!ready || temporaryFull || (!content && !pending.length)) return; // a draft that can't be sent yet stays in the box
    // Compacting first, when the chat asks for it: the message stays in the box until the summary is in.
    if (!compacted && settings.autoCompact && nearlyFullNow && !compactedNow && canCompact) {
      sendAfterCompact.current = true;
      setHolding(true);
      void compact();
      return;
    }
    const attachments = pending;
    onDraftChange("");
    setPending([]);
    setFileError(null);
    void run({ kind: "send", content, ...(attachments.length ? { attachments } : {}) });
  }

  // Images are refused up front for a model known not to see them; while the model's details aren't known
  // (none picked yet, or still loading) they are taken, and the server refuses them when the message is sent.
  const canSee = modelInfo?.capabilities ? modelInfo.capabilities.includes("vision") : undefined;

  // Files picked, dropped or pasted join the composer; the ones that can't are named under it.
  async function addFiles(files: File[]) {
    if (!files.length) return;
    const { accepted, refused } = await readFiles(files, { canSee, room: MAX_ATTACHMENTS - pending.length });
    setPending((p) => [...p, ...accepted].slice(0, MAX_ATTACHMENTS));
    setFileError(refused.length ? refused.join(" · ") : null);
  }

  // A temporary chat goes whole with every message: past its limits, the server would refuse the next one.
  const temporaryBytes = [...messages.flatMap((m) => m.files ?? []), ...pending].reduce((n, a) => n + sizeOf(a), 0);
  const temporaryFull = !temporary
    ? null
    : messages.length + 1 > MAX_TEMPORARY_MESSAGES
      ? TEMPORARY_TOO_LONG
      : temporaryBytes > MAX_TOTAL_BYTES
        ? TEMPORARY_FILES_TOO_BIG
        : null;
  // Compacting. The latest summary on the branch, if any: the model reads it instead of the messages up to it.
  const summaryAt = messages.findLastIndex((m) => m.summary);
  const lastQuestion = messages.findLastIndex((m) => m.role === "user");
  const lastReply = messages.findLast((m) => m.role === "assistant");
  // Compacted since the latest reply, whose stats still count the messages now summarized.
  const compactedNow = summaryAt >= 0 && summaryAt >= lastQuestion - 1;
  const canCompact = chatId !== null && online && !!model && !streaming && !loading && !compacting && compactionRange(messages) !== null;
  // Where the latest reply offers to compact: from half the context, until it is nearly full and the warning
  // under it does. An engine that doesn't say how big its context is (OpenAI-compatible servers) offers it
  // once the conversation is a few thousand tokens long; the warning and automatic compacting need the size.
  const lastStats = lastReply?.stats;
  const knownContext = lastStats?.contextSize ?? effectiveSettings.contextLength;
  const contextFill = lastStats && knownContext ? lastStats.contextUsed / knownContext : null;
  const nearlyFullNow = contextFill !== null && contextFill >= NEARLY_FULL;
  const offerCompact = contextFill !== null ? contextFill >= 0.5 && !nearlyFullNow : (lastStats?.contextUsed ?? 0) >= UNKNOWN_CONTEXT_OFFER;
  // The context a compaction plans its pieces for: the chat's own setting, or what the engine reported it
  // loaded. Not the model's maximum: the model may be loaded with less. Unknown, the server assumes 4K.
  const compactContext = effectiveSettings.contextLength ?? [...messages].reverse().find((m) => m.stats?.contextSize)?.stats?.contextSize;

  // What the attached text would take from the context the next reply has.
  const fileTokens = textTokens(pending);
  const contextSize = effectiveSettings.contextLength ?? [...messages].reverse().find((m) => m.stats?.contextSize)?.stats?.contextSize ?? max;
  const filesTooBig = !!contextSize && fileTokens > contextSize / 2;

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

  // Has the model summarize the older messages of the branch (see /api/chats/[id]/compact). Cancelling, or
  // leaving the chat, stops it and keeps nothing.
  async function compact() {
    if (!canCompact || chatId === null) return;
    const controller = new AbortController();
    compactRef.current = controller;
    setCompacting(true);
    setError(null);
    try {
      const size = compactContext && Number.isInteger(compactContext) ? Math.min(Math.max(compactContext, 512), MAX_CONTEXT) : undefined;
      const res = await fetch(`/api/chats/${chatId}/compact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: choice.engine, model, ...(size ? { contextSize: size } : {}) }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't compact this chat");
      setMessages(data.messages as ChatMessage[]);
      setSummaryOpen(false);
    } catch (e) {
      if (!controller.signal.aborted) setError(`Couldn't compact this chat: ${describeError(e, false)}`);
    } finally {
      if (compactRef.current === controller) compactRef.current = null;
      setCompacting(false);
    }
  }

  // The model reads the summarized messages again.
  async function undoCompact(messageId: number) {
    if (chatId === null || streaming || compacting) return;
    try {
      const res = await fetch(`/api/chats/${chatId}/compact`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) setMessages((await res.json()).messages as ChatMessage[]);
    } catch {}
  }

  // Copies the branch up to this message into a new chat, which then opens; this chat stays as it is.
  async function branchFrom(messageId: number) {
    if (chatId === null || streaming || branching) return;
    setBranching(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chatId}/branch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, settings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't branch this chat");
      onBranched(data.chat as ChatSummary);
    } catch (e) {
      setError(describeError(e, false));
      setBranching(false);
    }
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
    // "Regenerate with" another model writes this one reply with it; the chat keeps its model.
    const target = action.kind === "regenerate" && action.with ? action.with : choice;
    const oneOff = target.engine !== choice.engine || target.model !== choice.model;
    const targetOnline = engines.find((e) => e.id === target.engine)?.online ?? false;
    if (!(oneOff ? targetOnline && !streaming && !loading : ready) || (action.kind !== "send" && chatId === null && !temporary)) return;

    const before = messages;
    // While the reply streams, the branch is cut where the new version starts.
    const cut = action.kind === "edit" || action.kind === "regenerate" ? before.findIndex((m) => m.id === action.id) : before.length;
    if (cut < 0) return;
    const replaced = action.kind === "regenerate" ? before[cut] : undefined;
    const content = action.kind === "send" || action.kind === "edit" ? action.content : null;
    // The chat's first reply: once it is in, the model names the chat.
    const firstReply = !before.slice(0, cut).some((m) => m.role === "assistant");

    setError(null);
    setEditing(null);
    setStreaming(true);
    followRef.current.force = true;
    // The files shown with the message while it is sent: the new ones, or those of the message being edited.
    // In a temporary chat each file gets a link of its own, since the server never keeps it.
    const shown = (a: NewAttachment) => {
      if (!temporary) return metaOf(a);
      const url = URL.createObjectURL(blobOf(a));
      fileUrls.current.push(url);
      return { ...metaOf(a), preview: url };
    };
    const files = action.kind === "send" ? action.attachments?.map(shown) : action.kind === "edit" ? before[cut].attachments : undefined;
    // A temporary chat numbers its own messages and keeps their files, to send them again with the next ones.
    const sent: Message | null =
      content === null
        ? null
        : {
            role: "user",
            content,
            ...(files?.length ? { attachments: files } : {}),
            ...(temporary ? { id: localId() } : {}),
            ...(temporary && action.kind === "send" && action.attachments?.length ? { files: action.attachments } : {}),
            ...(temporary && action.kind === "edit" && before[cut].files ? { files: before[cut].files } : {}),
          };
    const conversation = [...before.slice(0, cut), ...(sent ? [sent] : [])];
    setMessages([...conversation, { role: "assistant", content: "", engine: target.engine, model: target.model, ...(temporary ? { id: localId() } : {}) }]);

    const controller = new AbortController();
    const active = { controller, chatId: null as number | null };
    activeRef.current = active;
    let accepted = false;
    let finished = false; // the server sent its final event
    let text = ""; // the reply so far
    let failure: string | null = null;
    try {
      // Another model's limits and reasoning levels aren't those of the chat's model: ask for them first.
      const sent = oneOff
        ? fitSettings(
            settings,
            await fetch(`/api/engines/${encodeURIComponent(target.engine)}/show?model=${encodeURIComponent(target.model)}`, {
              signal: controller.signal,
            })
              .then((r) => (r.ok ? (r.json() as Promise<ModelInfo>) : null))
              .catch(() => null),
          )
        : effectiveSettings;
      // A temporary chat sends the whole conversation, and keeps nothing: there is no chat model to keep.
      const res = temporary
        ? await fetch("/api/chat/temporary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              engine: target.engine,
              model: target.model,
              settings: sent,
              messages: conversation.map((m) => ({ role: m.role, content: m.content, ...(m.files ? { attachments: m.files } : {}) })),
            }),
            signal: controller.signal,
          })
        : await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              engine: target.engine,
              model: target.model,
              settings: sent,
              ...(oneOff ? { keepChatModel: true } : {}),
              ...(action.kind === "send"
                ? { content: action.content, ...(action.attachments?.length ? { attachments: action.attachments } : {}) }
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
      if (!temporary) {
        const savedId = Number(res.headers.get("X-Chat-Id"));
        active.chatId = Number.isSafeInteger(savedId) ? savedId : chatId;
        if (chatId === null && active.chatId !== null) onChatCreated(active.chatId);
        onChatsChanged(); // the message is saved: show the chat and its title in the sidebar right away
      }

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
      // A temporary chat's notification says nothing of the conversation: the system keeps notifications.
      if (accepted && !controller.signal.aborted && userIsAway()) {
        notify(
          failure
            ? { title: "Reply failed", body: failure }
            : temporary
              ? { title: "Temporary chat", body: "The reply is ready." }
              : { title: titleRef.current || "Reply ready", body: snippet(text) },
        );
      }
      if (!accepted) {
        // Nothing was saved: restore the conversation and give the text and files back.
        setMessages(before);
        if (action.kind === "send") {
          onDraftChange((d) => d || action.content);
          if (action.attachments?.length) setPending((p) => (p.length ? p : action.attachments!));
        }
        if (action.kind === "edit") setEditing({ id: action.id, text: action.content });
      } else if (controller.signal.aborted || active.chatId === null || !(await loadBranch(active.chatId))) {
        // A temporary chat keeps the reply as it streamed. Otherwise the saved branch couldn't be reloaded.
        // Either way: drop an empty bubble, or bring back the reply being regenerated.
        setMessages((m) => {
          const tail = m.at(-1);
          if (tail?.role !== "assistant" || tail.content) return m;
          return replaced ? [...m.slice(0, -1), replaced] : m.slice(0, -1);
        });
      }
      if (activeRef.current === active) activeRef.current = null;
      setStreaming(false);
      if (!temporary) onChatsChanged();
      // In the background, so the composer is free right away; the sidebar picks the title up when it lands.
      if (finished && !controller.signal.aborted && firstReply && active.chatId !== null) void nameChat(active.chatId);
    }
  }

  // The latest reply, when it can be written again.
  const regenerable = last?.role === "assistant" && last.id !== undefined && ready ? last.id : null;

  useImperativeHandle(ref, () => ({
    focusComposer: () => textareaRef.current?.focus(),
    regenerate: () => {
      if (regenerable !== null) void run({ kind: "regenerate", id: regenerable });
    },
    stop: () => void stop(),
    toggleSettings,
    compact: () => void compact(),
    state: () => ({ streaming, canRegenerate: regenerable !== null, canCompact: canCompact && !compactedNow }),
  }));
  // A message held back for an automatic compaction goes once it is done (also when it failed: the
  // conversation is then sent as it is, like before).
  const sendHeldMessage = useEffectEvent(() => {
    setHolding(false);
    sendDraft(true);
  });
  useEffect(() => {
    if (compacting || !sendAfterCompact.current) return;
    sendAfterCompact.current = false;
    sendHeldMessage();
  }, [compacting]);

  // Has the model name the chat (see /api/chats/[id]/title). Failing quietly is fine: the placeholder title stays.
  async function nameChat(id: number) {
    try {
      const res = await fetch(`/api/chats/${id}/title`, { method: "POST" });
      if (res.ok && (await res.json()).named) onChatsChanged();
    } catch {}
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div
        className="flex h-full min-w-0 flex-1 flex-col"
        // Files can be dropped anywhere on the chat; the composer shows where they land.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
          <button
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg md:hidden"
          >
            <MenuIcon />
          </button>
          <p data-testid="chat-title" className="min-w-0 flex-1 truncate text-sm font-medium text-muted">
            {title}
          </p>
          {/* Only an empty new chat can be made temporary; once it has messages it says so, and stays so. */}
          {temporary && messages.length > 0 ? (
            <span data-testid="temporary-badge" className="flex h-8 items-center gap-1.5 px-2 text-xs text-accent">
              <TemporaryIcon width={17} height={17} />
              Temporary chat
            </span>
          ) : (
            chatId === null &&
            messages.length === 0 && (
              <button
                onClick={() => onTemporaryChange(!temporary)}
                aria-pressed={temporary}
                title={temporary ? "Save this chat as usual" : "Temporary chat: not saved, not searchable, gone once you leave it"}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-surface-2 hover:text-fg ${
                  temporary ? "text-accent" : "text-muted"
                }`}
              >
                <TemporaryIcon width={17} height={17} />
                <span className={temporary ? "" : "sr-only"}>Temporary chat</span>
              </button>
            )
          )}
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
                <h1 className="text-3xl font-semibold tracking-tight">{temporary ? "Temporary chat" : "How can I help?"}</h1>
                <p className="mt-2 text-muted">
                  {temporary
                    ? "Not saved, not in search, not in your chat list. It's gone once you leave it."
                    : online
                      ? "Your local model is ready."
                      : engine?.builtin
                        ? "Ollama is stopped: start it from the sidebar to begin."
                        : `${offlineLabel(engine)}: start it, or pick a model from another engine.`}
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
                const note = (
                  <>
                    {i === branchPoint && <BranchNote from={branchOf} onOpen={onOpenChat} />}
                    {i === summaryAt && (
                      <SummaryNote
                        summary={m.summary!}
                        open={summaryOpen}
                        onToggle={() => setSummaryOpen((o) => !o)}
                        onUndo={streaming || compacting ? undefined : () => void undoCompact(m.id!)}
                      />
                    )}
                  </>
                );
                // Messages the model now reads as a summary are dimmed.
                const summarized = i <= summaryAt ? "opacity-60" : "";
                if (m.role === "user") {
                  if (editing && m.id === editing.id) {
                    return (
                      <Fragment key={key}>
                        <EditMessage
                          initial={editing.text}
                          note={temporary ? "Replaces this message and what follows." : "The original stays available as a version."}
                          disabled={!ready}
                          onCancel={() => setEditing(null)}
                          onSubmit={(text) => void run({ kind: "edit", id: editing.id, content: text })}
                        />
                        {note}
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={key}>
                      <div
                        data-testid="user-message"
                        data-message-id={m.id}
                        className={`group/msg ml-auto flex max-w-[85%] flex-col items-end gap-1 ${summarized}`}
                      >
                        {m.content && (
                          <div
                            className={`whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-grad px-4 py-2.5 text-accent-fg transition-shadow ${
                              highlight !== null && m.id === highlight ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
                            }`}
                          >
                            {m.content}
                          </div>
                        )}
                        {m.attachments && <AttachmentChips items={m.attachments} className="justify-end" />}
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
                      {note}
                    </Fragment>
                  );
                }
                return (
                  <Fragment key={key}>
                    <div
                      data-testid="assistant-message"
                      data-message-id={m.id}
                      className={`group/msg max-w-[95%] rounded-xl transition-shadow ${summarized} ${
                        highlight !== null && m.id === highlight ? "ring-2 ring-accent ring-offset-4 ring-offset-bg" : ""
                      }`}
                    >
                      {m.thinking && <Reasoning text={m.thinking} live={streaming && isLast && !m.content} ms={m.stats?.thinkingMs} />}
                      {m.content ? <Markdown live={streaming && isLast}>{m.content}</Markdown> : streaming && isLast && !m.thinking && <TypingDots />}
                      {m.content && !(streaming && isLast) && (
                        // The latest reply, replies with versions and, in a chat written by several models, every reply
                        // naming its model always show their actions; others on hover or focus.
                        <div
                          className={`mt-1 flex flex-wrap items-center gap-1 transition-opacity ${
                            isLast || m.versions || (severalModels && m.model) ? "" : "opacity-0 focus-within:opacity-100 group-hover/msg:opacity-100"
                          }`}
                        >
                          {m.versions && <VersionNav versions={m.versions} disabled={streaming} onSelect={showVersion} />}
                          {m.model && (m.versions || severalModels) && (
                            <span
                              data-testid="reply-model"
                              title={`Written by ${m.model}${m.engine ? ` (${engines.find((e) => e.id === m.engine)?.name ?? m.engine})` : ""}`}
                              className="max-w-[12rem] truncate px-1 font-mono text-xs text-muted"
                            >
                              {m.model}
                            </span>
                          )}
                          <CopyButton text={m.content} label="Copy" />
                          {isLast && m.id !== undefined && (
                            <span className="flex items-center">
                              <button onClick={() => void run({ kind: "regenerate", id: m.id! })} disabled={!ready} className={actionClass}>
                                <RefreshIcon width={14} height={14} />
                                Regenerate
                              </button>
                              <RegenerateMenu
                                engines={engines}
                                current={choice}
                                disabled={streaming || loading}
                                className={`${actionClass} -ml-1 px-1`}
                                onPick={(other) => void run({ kind: "regenerate", id: m.id!, with: other })}
                              />
                            </span>
                          )}
                          {m.id !== undefined && !streaming && !temporary && (
                            <button
                              onClick={() => void branchFrom(m.id!)}
                              disabled={branching}
                              title="Continue from here in a new chat"
                              className={actionClass}
                            >
                              <BranchIcon width={14} height={14} />
                              Branch
                            </button>
                          )}
                          {isLast && canCompact && offerCompact && !compactedNow && (
                            <button onClick={() => void compact()} title="Summarize the older messages to free context" className={actionClass}>
                              <CompactIcon width={14} height={14} />
                              Compact
                            </button>
                          )}
                          {m.stats && <StatsLine stats={m.stats} />}
                        </div>
                      )}
                      {isLast && m === lastReply && !streaming && !compacting && nearlyFullNow && !compactedNow && (
                        <p className="mt-1 px-1.5 text-xs text-danger">
                          This chat is close to the model&apos;s context limit: the oldest messages will be left out.{" "}
                          {canCompact ? (
                            <>
                              <button onClick={() => void compact()} className="font-medium underline underline-offset-2 hover:text-fg">
                                Compact the chat
                              </button>{" "}
                              {settings.autoCompact
                                ? " now, or just send your next message: the chat is compacted before it goes."
                                : " to have the model summarize them instead, or turn on automatic compacting in the chat settings."}
                            </>
                          ) : (
                            <>Start a new chat, or raise the context length in the chat settings if the model allows it.</>
                          )}
                        </p>
                      )}
                      {isLast && !streaming && compactedNow && (
                        <p className="mt-1 px-1.5 text-xs text-muted">Compacted: the next reply reads the summary instead of the older messages.</p>
                      )}
                    </div>
                    {note}
                  </Fragment>
                );
              })}
              {compacting && (
                <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                  <CompactIcon width={15} height={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 text-muted">
                    Summarizing the older messages…{holding && " Your message goes as soon as the summary is in."}
                  </span>
                  {/* Cancelling keeps the message in the box, unsent. */}
                  <button
                    onClick={() => {
                      sendAfterCompact.current = false;
                      setHolding(false);
                      compactRef.current?.abort();
                    }}
                    className={actionClass}
                  >
                    Cancel
                  </button>
                </div>
              )}
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
          <div
            className={`mx-auto flex max-w-3xl flex-col rounded-2xl border surface-glossy p-2 focus-within:border-accent ${
              dragging ? "border-dashed border-accent" : "border-border"
            }`}
          >
            {pending.length > 0 && (
              <AttachmentChips items={pending} onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))} className="px-2 pt-2" />
            )}
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
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (!files.length) return; // pasted text goes in as usual
                e.preventDefault();
                void addFiles(files);
              }}
              rows={1}
              placeholder={online ? (dragging ? "Drop the files here" : "Write a message…") : `${offlineLabel(engine)}`}
              disabled={!online}
              aria-label="Message"
              className="max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
            {fileError && (
              <p role="alert" className="flex items-start gap-1 px-2 pb-1 text-xs text-danger">
                <span className="min-w-0 flex-1">{fileError}</span>
                <button
                  onClick={() => setFileError(null)}
                  aria-label="Dismiss"
                  title="Dismiss"
                  className="shrink-0 rounded-md p-0.5 text-muted transition-colors hover:text-fg"
                >
                  <XIcon width={12} height={12} />
                </button>
              </p>
            )}
            {temporaryFull && <p className="px-2 pb-1 text-xs text-danger">{temporaryFull}</p>}
            {filesTooBig && (
              <p className="px-2 pb-1 text-xs text-danger">
                The attached text is about {formatTokens(fileTokens)} tokens, more than half of the {formatTokens(contextSize)} context:
                the model may lose part of it or of the conversation.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={acceptFor(canSee)}
                  className="hidden"
                  onChange={(e) => {
                    void addFiles([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!online}
                  aria-label="Attach files"
                  title={canSee === false ? "Attach text files (this model can't see images)" : "Attach text files or images"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  <PaperclipIcon width={16} height={16} />
                </button>
                <ModelPicker engines={engines} choice={choice} disabled={streaming} onChange={onChoose} onInstalled={onModelInstalled} />
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
                  onClick={() => sendDraft()}
                  disabled={!ready || !!temporaryFull || (!draft.trim() && !pending.length)}
                  aria-label="Send"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-grad text-accent-fg transition-opacity disabled:opacity-30"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted">Enter to send · Shift+Enter for a new line · {keysOf("palette")} for commands</p>
        </div>
      </div>
      <SettingsSidebar
        open={settingsOpen}
        settings={settings}
        modelInfo={modelInfo}
        contextLength={engine?.supports.contextLength ?? true}
        systemRef={systemPromptRef}
        onChange={changeSettings}
        onSaveDefaults={() => onSaveDefaults(settings)}
        onClose={closeSettings}
      />
    </div>
  );
}

// Where a branched chat's copied messages end, with a way back to the chat they came from.
function BranchNote({ from, onOpen }: { from: { id: number; title: string } | null; onOpen: (id: number) => void }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <BranchIcon width={14} height={14} />
      {from ? (
        <span className="flex min-w-0 max-w-[75%] gap-1">
          <span className="shrink-0">Branched from</span>
          <button onClick={() => onOpen(from.id)} className="min-w-0 truncate underline-offset-2 hover:text-fg hover:underline">
            {from.title}
          </button>
        </span>
      ) : (
        <span>Branched from another chat</span>
      )}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

// Where a compacted chat's summary takes over: the model reads it instead of the messages above.
function SummaryNote({ summary, open, onToggle, onUndo }: { summary: string; open: boolean; onToggle: () => void; onUndo?: () => void }) {
  return (
    <div data-testid="summary-note" className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <CompactIcon width={14} height={14} />
        <span>Summarized above this line</span>
        <button onClick={onToggle} aria-expanded={open} className="underline-offset-2 hover:text-fg hover:underline">
          {open ? "Hide summary" : "Show summary"}
        </button>
        {onUndo && (
          <button onClick={onUndo} title="The model reads these messages again" className="underline-offset-2 hover:text-fg hover:underline">
            Undo
          </button>
        )}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {open && (
        <div aria-label="Summary" className="max-h-80 overflow-y-auto rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          <Markdown>{summary}</Markdown>
        </div>
      )}
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

// Inline editor for a sent message. Sending it adds a new version; the original stays one click away
// (in a temporary chat, which keeps no versions, it replaces the message).
function EditMessage({
  initial,
  note,
  disabled,
  onCancel,
  onSubmit,
}: {
  initial: string;
  note: string;
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
        <span className="mr-auto px-2 text-xs text-muted">{note}</span>
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
