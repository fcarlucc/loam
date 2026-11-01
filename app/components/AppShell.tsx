"use client";

import { useCallback, useEffect, useState } from "react";
import { BUILTIN_OLLAMA_ID } from "@/lib/engines/presets";
import type { ChatSettings, ChatSummary, EngineModels, ModelChoice, ModelInfo } from "@/lib/types";
import { Chat } from "./Chat";
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

export function AppShell() {
  const ollama = useOllamaStatus();
  const { engines, refresh: refreshEngines } = useEngines();

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
  const [view, setView] = useState<{ key: number; id: number | null; focus?: number | null }>({ key: 0, id: null });
  const [draft, setDraft] = useState("");
  // The engine and model messages are sent with.
  const [choice, setChoice] = useState<ModelChoice>({ engine: "", model: "" });
  // Settings new chats start with (stored in SQLite, so they survive a port change).
  const [defaults, setDefaults] = useState<ChatSettings | null>(null);
  const [modelInfo, setModelInfo] = useState<{ choice: ModelChoice; info: ModelInfo } | null>(null);

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

  const current = chats.find((c) => c.id === view.id);
  const branchOf = current?.branch_of != null ? chats.find((c) => c.id === current.branch_of) : undefined;
  // The models panel manages the Ollama in use, or the built-in one when another kind of engine is selected.
  const managed = engine?.kind === "ollama" ? engine : engines.find((e) => e.id === BUILTIN_OLLAMA_ID);

  const sidebar = (
    <Sidebar
      ollama={ollama}
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
              key={view.key}
              chatId={view.id}
              focusMessageId={view.focus ?? null}
              initialSettings={defaults}
              modelInfo={modelInfo && modelInfo.choice.engine === choice.engine && modelInfo.choice.model === choice.model ? modelInfo.info : null}
              onSaveDefaults={saveDefaults}
              title={current?.title ?? "New chat"}
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
    </div>
  );
}
