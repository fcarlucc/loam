"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatSettings, ChatSummary, ModelInfo } from "@/lib/types";
import { Chat } from "./Chat";
import { ModelsDialog } from "./ModelsDialog";
import { useOllamaStatus } from "./OllamaStatus";
import { Sidebar } from "./Sidebar";

const MODEL_KEY = "model";
const SETTINGS_OPEN_KEY = "settingsOpen";

function savedModel() {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export function AppShell() {
  const ollama = useOllamaStatus();
  const running = ollama.status?.running ?? false;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
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
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  // Settings new chats start with (stored in SQLite, so they survive a port change).
  const [defaults, setDefaults] = useState<ChatSettings | null>(null);
  const [modelInfo, setModelInfo] = useState<{ model: string; info: ModelInfo } | null>(null);

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

  const refreshModels = useCallback(async () => {
    try {
      const { models }: { models: string[] } = await (await fetch("/api/ollama/models", { cache: "no-store" })).json();
      setModels(models);
      setModel((current) => {
        if (current && models.includes(current)) return current;
        const saved = savedModel();
        return saved && models.includes(saved) ? saved : (models[0] ?? "");
      });
    } catch {}
  }, []);

  // Load the installed models whenever Ollama comes up.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is only set after the fetch resolves
    if (running) void refreshModels();
  }, [running, refreshModels]);

  // Context window and default temperature of the selected model, for the settings panel.
  useEffect(() => {
    if (!running || !model) return;
    let cancelled = false;
    fetch(`/api/ollama/show?model=${encodeURIComponent(model)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info: ModelInfo | null) => {
        if (!cancelled && info) setModelInfo({ model, info });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [running, model]);

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

  const chooseModel = (name: string) => {
    setModel(name);
    try {
      localStorage.setItem(MODEL_KEY, name);
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

  const installed = async (name: string) => {
    await refreshModels();
    chooseModel(name);
  };

  const open = (id: number | null) => {
    setMobileOpen(false);
    if (id !== null && id === view.id) return; // already open: don't interrupt a streaming reply
    setView((v) => ({ key: v.key + 1, id }));
    // Continue a saved chat with the model it was using, if that model is still installed.
    const chatModel = chats.find((c) => c.id === id)?.model;
    if (chatModel && models.includes(chatModel)) setModel(chatModel);
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
    setView((v) => ({ key: v.key + 1, id, focus: messageId }));
    const chatModel = chats.find((c) => c.id === id)?.model;
    if (chatModel && models.includes(chatModel)) setModel(chatModel);
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
      onOpenModels={() => {
        setMobileOpen(false);
        setModelsOpen(true);
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
        {defaults && (
          <Chat
            key={view.key}
            chatId={view.id}
            focusMessageId={view.focus ?? null}
            initialSettings={defaults}
            modelInfo={modelInfo?.model === model ? modelInfo.info : null}
            onSaveDefaults={saveDefaults}
            title={chats.find((c) => c.id === view.id)?.title ?? "New chat"}
            draft={draft}
            onDraftChange={setDraft}
            ollamaRunning={running}
            models={models}
            model={model}
            onModelChange={chooseModel}
            onModelInstalled={installed}
            onChatCreated={(id) => setView((v) => ({ ...v, id }))}
            onChatsChanged={refreshChats}
            onOpenSidebar={() => setMobileOpen(true)}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={changeSettingsOpen}
          />
        )}
      </main>

      {modelsOpen && (
        <ModelsDialog ollamaRunning={running} onClose={() => setModelsOpen(false)} onModelsChanged={() => void refreshModels()} />
      )}
    </div>
  );
}
