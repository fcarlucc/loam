"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { BUILTIN_OLLAMA_ID } from "@/lib/engines/presets";
import { isMac, keysOf, matches, SHORTCUTS, type ShortcutId } from "@/lib/shortcuts";
import { getPref, setPref, type ThemePref } from "@/lib/theme";
import type { ChatSettings, ChatSummary, EngineModels, ModelChoice, ModelInfo } from "@/lib/types";
import { Chat, type ChatHandle } from "./Chat";
import { type Command, CommandPalette, type PaletteMode, ShortcutsDialog } from "./CommandPalette";
import { CompareView } from "./CompareView";
import { DashboardView } from "./DashboardView";
import { EnginesDialog } from "./EnginesDialog";
import { ModelsDialog } from "./ModelsDialog";
import { useOllamaStatus } from "./OllamaStatus";
import { Sidebar } from "./Sidebar";
import { useEngines } from "./useEngines";

const ENGINE_KEY = "engine";
const MODEL_KEY = "model";
const SETTINGS_OPEN_KEY = "settingsOpen";

// The model used last time. Installs from before engines existed only saved the model: it was Ollama's.
function savedChoice(): ModelChoice | null {
  try {
    const model = localStorage.getItem(MODEL_KEY);
    return model ? { engine: localStorage.getItem(ENGINE_KEY) ?? BUILTIN_OLLAMA_ID, model } : null;
  } catch {
    return null;
  }
}

const offers = (engines: EngineModels[], c: ModelChoice) => engines.some((e) => e.id === c.engine && e.models.includes(c.model));

// What the palette offers, given the chat's state when it opened. Chats and models are found by their ids
// ("chat:12", "model:[engine, model]"), which AppShell's runCommand reads back.
function paletteItems({
  chat,
  chats,
  engines,
  choice,
  openChatId,
  canManageModels,
}: {
  chat: ReturnType<ChatHandle["state"]> | undefined; // undefined when no chat is on screen
  chats: ChatSummary[];
  engines: EngineModels[];
  choice: ModelChoice;
  openChatId: number | null;
  canManageModels: boolean;
}) {
  const theme = getPref();
  const commands: Command[] = [
    { id: "new-chat", group: "Actions", label: "New chat", keys: keysOf("newChat") },
    { id: "new-temporary-chat", group: "Actions", label: "New temporary chat", keywords: "private incognito not saved" },
    { id: "search", group: "Actions", label: "Search chats", keys: keysOf("search"), keywords: "find messages" },
    ...(chat?.streaming ? [] : [{ id: "model", group: "Actions", label: "Change model…", keys: keysOf("model"), keywords: "switch engine", opens: "models" as const }]),
    ...(chat?.canRegenerate
      ? [{ id: "regenerate", group: "Actions", label: "Regenerate the latest reply", keys: keysOf("regenerate"), keywords: "retry again" }]
      : []),
    ...(chat?.streaming ? [{ id: "stop", group: "Actions", label: "Stop generating", keys: keysOf("stop") }] : []),
    ...(chat?.canCompact ? [{ id: "compact", group: "Actions", label: "Compact chat", keywords: "summarize context free shorten" }] : []),
    ...(chat ? [{ id: "settings", group: "Actions", label: "Chat settings", keywords: "system prompt temperature context reasoning" }] : []),
    { id: "composer", group: "Actions", label: "Focus the message box", keys: keysOf("focusComposer"), keywords: "write type" },
    { id: "compare", group: "Go to", label: "Compare models", keywords: "side by side" },
    { id: "dashboard", group: "Go to", label: "Usage & benchmark", keywords: "stats speed dashboard" },
    ...(canManageModels ? [{ id: "models", group: "Go to", label: "Models & memory", keywords: "download delete unload" }] : []),
    { id: "engines", group: "Go to", label: "Engines", keywords: "ollama lm studio llama.cpp mlx server" },
    { id: "theme:light", group: "Theme", label: "Light theme", current: theme === "light" },
    { id: "theme:dark", group: "Theme", label: "Dark theme", current: theme === "dark" },
    { id: "theme:system", group: "Theme", label: "Match system theme", current: theme === "system" },
    { id: "help", group: "Help", label: "Keyboard shortcuts", keys: keysOf("help") },
  ];
  const chatItems: Command[] = chats.map((c) => ({
    id: `chat:${c.id}`,
    group: "Chats",
    label: c.title,
    current: c.id === openChatId,
  }));
  const online = engines.filter((e) => e.online);
  const modelItems: Command[] = chat?.streaming
    ? []
    : online.flatMap((e) =>
        e.models.map((m) => ({
          id: `model:${JSON.stringify([e.id, m])}`,
          group: "Models",
          label: m,
          hint: online.length > 1 ? e.name : undefined,
          keywords: e.name,
          current: e.id === choice.engine && m === choice.model,
        })),
      );
  return { commands, chats: chatItems, models: modelItems };
}

// Escape stops a reply when it comes from the chat itself (the message box, the conversation, or the page as
// a whole), not when it closes or cancels something of its own: the sidebar's search, a rename, a drawer.
function escapeStops(target: EventTarget | null) {
  if (!(target instanceof Element) || target === document.body) return true;
  if (target.closest("aside")) return false;
  if (target.matches('textarea[aria-label="Message"]')) return true;
  return !!target.closest("main") && !target.matches("input, textarea, select, [contenteditable]");
}

export function AppShell() {
  const { engines, loaded: enginesLoaded, refresh: refreshEngines } = useEngines();
  // After Ollama is started or stopped, the model picker and the engines card should follow at once.
  const ollama = useOllamaStatus(refreshEngines);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  // What the main area shows besides a chat.
  const [screen, setScreen] = useState<"chat" | "compare" | "dashboard">("chat");
  // Lives here, not in Chat, so the settings sidebar stays open when another chat is opened.
  // Only Chat (rendered after hydration) reads it, so reading storage during the first render is safe.
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try {
      return localStorage.getItem(SETTINGS_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [chats, setChats] = useState<ChatSummary[]>([]);
  // `key` changes when another chat is opened, so Chat remounts with fresh state.
  // `id` alone changes when Chat saves the new conversation it is already showing.
  // `focus` is a message to scroll to and highlight once the chat is open (from search).
  // `temporary` marks a new chat that is never saved; leaving it (any other view) discards it.
  const [view, setView] = useState<{ key: number; id: number | null; focus?: number | null; temporary?: boolean }>({ key: 0, id: null });
  const [draft, setDraft] = useState("");
  // The engine and model messages are sent with.
  const [choice, setChoice] = useState<ModelChoice>({ engine: "", model: "" });
  // Settings new chats start with (stored in SQLite, so they survive a port change).
  const [defaults, setDefaults] = useState<ChatSettings | null>(null);
  const [modelInfo, setModelInfo] = useState<{ choice: ModelChoice; info: ModelInfo } | null>(null);
  // The command palette (⌘K, or its model list with ⇧⌘L), the list of shortcuts (⌘/), and the chat they act on.
  // `chat` is the chat's state when the palette opened: what it can offer (regenerate, stop…).
  const [palette, setPalette] = useState<{ mode: PaletteMode; chat?: ReturnType<ChatHandle["state"]> } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const chatRef = useRef<ChatHandle>(null);

  const refreshChats = useCallback(async () => {
    try {
      const res = await fetch("/api/chats", { cache: "no-store" });
      if (res.ok) setChats((await res.json()).chats);
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the local database
    void refreshChats();
    // Defaults are optional: if they can't be loaded, chats start with the model's own settings.
    fetch("/api/settings", { cache: "no-store" })
      .then(async (r) => setDefaults(r.ok ? ((await r.json()).defaults ?? {}) : {}))
      .catch(() => setDefaults({}));
  }, [refreshChats]);

  // Keep the choice valid as engines come and go: the current one while its engine offers it (or is just
  // offline for now), else the one saved last time, else the first model of the first engine that has any.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from what the engines report
    setChoice((current) => {
      if (current.model && (offers(engines, current) || engines.some((e) => e.id === current.engine && !e.online))) return current;
      const saved = savedChoice();
      if (saved && offers(engines, saved)) return saved;
      const first = engines.find((e) => e.models.length > 0);
      return first ? { engine: first.id, model: first.models[0] } : current;
    });
  }, [engines]);

  const engine = engines.find((e) => e.id === choice.engine);
  const online = engine?.online ?? false;

  // Context window and default temperature of the selected model, for the settings panel.
  useEffect(() => {
    if (!online || !choice.model) return;
    let cancelled = false;
    fetch(`/api/engines/${encodeURIComponent(choice.engine)}/show?model=${encodeURIComponent(choice.model)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info: ModelInfo | null) => {
        if (!cancelled && info) setModelInfo({ choice, info });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online, choice]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const changeSettingsOpen = (open: boolean) => {
    setSettingsOpen(open);
    try {
      localStorage.setItem(SETTINGS_OPEN_KEY, open ? "1" : "0");
    } catch {}
  };

  const choose = (next: ModelChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(ENGINE_KEY, next.engine);
      localStorage.setItem(MODEL_KEY, next.model);
    } catch {}
  };

  const saveDefaults = async (settings: ChatSettings) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults: settings }),
      });
      if (!res.ok) return false;
      setDefaults((await res.json()).defaults);
      return true;
    } catch {
      return false;
    }
  };

  const installed = async (engineId: string, name: string) => {
    await refreshEngines();
    choose({ engine: engineId, model: name });
  };

  // Continue a saved chat with the engine and model it was using, if that model is still there.
  const followChat = (id: number | null) => {
    const chat = chats.find((c) => c.id === id);
    if (chat && offers(engines, { engine: chat.engine, model: chat.model })) setChoice({ engine: chat.engine, model: chat.model });
  };

  const open = (id: number | null) => {
    setMobileOpen(false);
    setScreen("chat");
    if (id !== null && id === view.id) return; // already open: don't interrupt a streaming reply
    setView((v) => ({ key: v.key + 1, id }));
    followChat(id);
  };

  // Opens a search result: switch the chat to the branch that holds the message, then show it there.
  const openResult = async (id: number, messageId: number | null) => {
    if (messageId !== null) {
      await fetch(`/api/chats/${id}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      }).catch(() => {});
    }
    setMobileOpen(false);
    setScreen("chat");
    setView((v) => ({ key: v.key + 1, id, focus: messageId }));
    followChat(id);
  };

  // A chat branched off the one on screen: open it right away, then refresh the list from the server.
  // The model picker stays as it is, so the branch can go on with another model.
  const openBranch = (chat: ChatSummary) => {
    setChats((list) => [chat, ...list.filter((c) => c.id !== chat.id)]);
    setView((v) => ({ key: v.key + 1, id: chat.id }));
    void refreshChats();
  };

  const remove = async (id: number) => {
    // Leave the chat first, so a reply still streaming into it stops before it is deleted.
    if (id === view.id) open(null);
    try {
      await fetch(`/api/chats/${id}`, { method: "DELETE" });
    } catch {}
    await refreshChats();
  };

  const rename = async (id: number, title: string) => {
    try {
      await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {}
    await refreshChats();
  };

  // The search box of the sidebar on screen; on a small window the sidebar is a drawer, opened first.
  const focusSearch = () => {
    const visible = () =>
      [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Search chats"]')].find((el) => el.offsetParent !== null);
    const box = visible();
    if (box) return box.focus();
    setMobileOpen(true);
    setTimeout(() => visible()?.focus(), 0);
  };

  const focusComposer = () => {
    setMobileOpen(false);
    if (screen === "chat") return chatRef.current?.focusComposer();
    setScreen("chat");
    setTimeout(() => chatRef.current?.focusComposer(), 0);
  };

  const openPalette = (mode: PaletteMode) => setPalette({ mode, chat: screen === "chat" ? chatRef.current?.state() : undefined });

  // Shortcuts work from anywhere on the page, the message box included, but not over a dialog: it has the keyboard.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
    const mac = isMac();
    const is = (id: ShortcutId) => matches(e, id, mac);
    const handle = (action: () => void) => {
      e.preventDefault();
      action();
    };
    const chat = chatRef.current?.state();
    if (is("palette")) handle(() => openPalette("all"));
    else if (is("newChat")) handle(() => open(null));
    else if (is("search")) handle(focusSearch);
    else if (is("model")) handle(() => !chat?.streaming && openPalette("models"));
    else if (is("help")) handle(() => setShortcutsOpen(true));
    else if (is("focusComposer")) handle(focusComposer);
    else if (is("regenerate") && screen === "chat") handle(() => chatRef.current?.regenerate());
    else if (is("stop") && screen === "chat" && chat?.streaming && escapeStops(e.target)) handle(() => chatRef.current?.stop());
  });
  useEffect(() => {
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  function runCommand(id: string) {
    if (id.startsWith("chat:")) return open(Number(id.slice(5)));
    if (id.startsWith("model:")) {
      const [engine, model] = JSON.parse(id.slice(6)) as [string, string];
      return choose({ engine, model });
    }
    if (id.startsWith("theme:")) return setPref(id.slice(6) as ThemePref);
    const actions: Record<string, () => void> = {
      "new-chat": () => open(null),
      // An empty new chat, switched to temporary like the header's toggle does, from whatever was on screen.
      "new-temporary-chat": () => {
        setMobileOpen(false);
        setScreen("chat");
        setView((v) => ({ key: v.key + 1, id: null, temporary: true }));
      },
      search: focusSearch,
      regenerate: () => chatRef.current?.regenerate(),
      stop: () => chatRef.current?.stop(),
      settings: () => chatRef.current?.toggleSettings(),
      compact: () => chatRef.current?.compact(),
      composer: focusComposer,
      compare: () => setScreen("compare"),
      dashboard: () => setScreen("dashboard"),
      models: () => setModelsOpen(true),
      engines: () => setEnginesOpen(true),
      help: () => setShortcutsOpen(true),
    };
    actions[id]?.();
  }

  const current = chats.find((c) => c.id === view.id);
  const branchOf = current?.branch_of != null ? chats.find((c) => c.id === current.branch_of) : undefined;
  // The models panel manages the Ollama in use, or the built-in one when another kind of engine is selected.
  const managed = engine?.kind === "ollama" ? engine : engines.find((e) => e.id === BUILTIN_OLLAMA_ID);

  // Built again only when what it lists changes, not on every status poll, so the list keeps its place.
  const openChatId = screen === "chat" ? view.id : null;
  const canManageModels = !!managed;
  const paletteContent = useMemo(
    () => palette && paletteItems({ chat: palette.chat, chats, engines, choice, openChatId, canManageModels }),
    [palette, chats, engines, choice, openChatId, canManageModels],
  );

  const sidebar = (
    <Sidebar
      ollama={ollama}
      engines={engines}
      enginesLoaded={enginesLoaded}
      chats={chats}
      activeId={view.id}
      onNewChat={() => open(null)}
      onSelect={open}
      onDelete={remove}
      onRename={rename}
      onOpenResult={(id, messageId) => void openResult(id, messageId)}
      onOpenCompare={() => {
        setMobileOpen(false);
        setScreen("compare");
      }}
      onOpenDashboard={() => {
        setMobileOpen(false);
        setScreen("dashboard");
      }}
      onOpenModels={() => {
        setMobileOpen(false);
        setModelsOpen(true);
      }}
      onOpenEngines={() => {
        setMobileOpen(false);
        setEnginesOpen(true);
      }}
    />
  );

  return (
    <div className="flex h-full">
      {/* Desktop: fixed sidebar. Mobile: drawer with overlay */}
      <aside className="hidden md:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close sidebar" className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-72 shadow-card">{sidebar}</aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1">
        {screen === "dashboard" ? (
          <DashboardView engines={engines} onClose={() => setScreen("chat")} onOpenSidebar={() => setMobileOpen(true)} />
        ) : screen === "compare" ? (
          <CompareView engines={engines} defaultChoice={choice} onClose={() => setScreen("chat")} onOpenSidebar={() => setMobileOpen(true)} />
        ) : (
          defaults && (
            <Chat
              ref={chatRef}
              key={view.key}
              chatId={view.id}
              temporary={!!view.temporary}
              // Only an empty new chat can switch, so it stays mounted: files and settings already set are kept.
              onTemporaryChange={(temporary) => setView((v) => ({ ...v, temporary }))}
              focusMessageId={view.focus ?? null}
              initialSettings={defaults}
              modelInfo={modelInfo && modelInfo.choice.engine === choice.engine && modelInfo.choice.model === choice.model ? modelInfo.info : null}
              onSaveDefaults={saveDefaults}
              title={current?.title ?? (view.temporary ? "Temporary chat" : "New chat")}
              branchOf={branchOf ? { id: branchOf.id, title: branchOf.title } : null}
              onBranched={openBranch}
              onOpenChat={open}
              draft={draft}
              onDraftChange={setDraft}
              engines={engines}
              choice={choice}
              onChoose={choose}
              onModelInstalled={installed}
              onChatCreated={(id) => setView((v) => ({ ...v, id }))}
              onChatsChanged={refreshChats}
              onOpenSidebar={() => setMobileOpen(true)}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={changeSettingsOpen}
            />
          )
        )}
      </main>

      {modelsOpen && managed && (
        <ModelsDialog engine={managed} onClose={() => setModelsOpen(false)} onModelsChanged={() => void refreshEngines()} />
      )}
      {enginesOpen && <EnginesDialog engines={engines} onClose={() => setEnginesOpen(false)} onChanged={() => void refreshEngines()} />}
      {palette && (
        <CommandPalette {...paletteContent!} initialMode={palette.mode} onRun={runCommand} onClose={() => setPalette(null)} />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog
          shortcuts={(Object.keys(SHORTCUTS) as ShortcutId[]).map((id) => ({ label: SHORTCUTS[id].label, keys: keysOf(id) }))}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
    </div>
  );
}
