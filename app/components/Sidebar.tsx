"use client";

import { useRef, useState } from "react";
import type { ChatSummary } from "@/lib/types";
import { ChartIcon, ChatIcon, ColumnsIcon, CubeIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { OllamaStatus, type useOllamaStatus } from "./OllamaStatus";
import { ThemeToggle } from "./ThemeToggle";
import { SearchBox, SearchResults, useChatSearch } from "./ChatSearch";

const DAY = 86_400_000;

function groupChats(chats: ChatSummary[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups: { label: string; chats: ChatSummary[] }[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Older", chats: [] },
  ];
  for (const chat of chats) {
    const age = startOfToday - chat.updated_at;
    groups[age < 0 ? 0 : age < DAY ? 1 : age < 7 * DAY ? 2 : 3].chats.push(chat);
  }
  return groups.filter((g) => g.chats.length > 0);
}

function ChatItem({
  chat,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  chat: ChatSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  function commit(value: string) {
    setEditing(false);
    const title = value.trim();
    if (!cancelled.current && title && title !== chat.title) onRename(title);
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={chat.title}
        maxLength={120}
        aria-label="Chat title"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded-lg border border-accent bg-surface-2 px-3 py-2 text-sm outline-none"
      />
    );
  }

  if (confirming) {
    return (
      <div
        role="group"
        aria-label={`Delete chat "${chat.title}"?`}
        onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}
        className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm"
      >
        <span className="min-w-0 flex-1 truncate text-muted">Delete this chat?</span>
        <button
          onClick={onDelete}
          className="rounded-md bg-danger px-2 py-0.5 text-xs font-medium text-black hover:opacity-90"
        >
          Delete
        </button>
        {/* Focus lands on the safe choice */}
        <button
          autoFocus
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-0.5 text-xs text-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center rounded-lg transition-colors ${
        active ? "bg-accent-soft" : "hover:bg-surface-2"
      }`}
    >
      <button
        onClick={onSelect}
        onDoubleClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm ${active ? "font-medium" : ""}`}
      >
        {chat.title}
      </button>
      <button
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        aria-label={`Rename chat "${chat.title}"`}
        title="Rename chat"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
      >
        <PencilIcon width={15} height={15} />
      </button>
      <button
        onClick={() => setConfirming(true)}
        aria-label={`Delete chat "${chat.title}"`}
        title="Delete chat"
        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon width={15} height={15} />
      </button>
    </div>
  );
}

export function Sidebar({
  ollama,
  chats,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
  onOpenModels,
  onOpenResult,
  onOpenCompare,
  onOpenDashboard,
}: {
  ollama: ReturnType<typeof useOllamaStatus>;
  chats: ChatSummary[];
  activeId: number | null;
  onNewChat: () => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onOpenModels: () => void;
  onOpenResult: (chatId: number, messageId: number | null) => void;
  onOpenCompare: () => void;
  onOpenDashboard: () => void;
}) {
  const search = useChatSearch();
  return (
    <div className="flex h-full w-72 flex-col gap-3 border-r border-border bg-panel p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" width={32} height={32} className="h-8 w-8" />
        <span className="text-[15px] font-semibold tracking-tight">Ollama Wrap</span>
      </div>

      <button
        onClick={onNewChat}
        className="flex items-center gap-2 rounded-xl border border-border surface-glossy px-3 py-2.5 text-sm font-medium transition-colors hover:border-accent"
      >
        <PlusIcon width={16} height={16} />
        New chat
      </button>

      <SearchBox query={search.query} onChange={search.setQuery} />

      <nav aria-label="Saved chats" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {search.active ? (
          <SearchResults hits={search.hits} onOpen={onOpenResult} />
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
            <ChatIcon width={22} height={22} />
            <p>No saved chats.</p>
            <p className="text-xs">Your conversations will show up here.</p>
          </div>
        ) : (
          groupChats(chats).map((group) => (
            <section key={group.label} className="mb-3">
              <h2 className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">{group.label}</h2>
              <div className="flex flex-col gap-0.5">
                {group.chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeId}
                    onSelect={() => onSelect(chat.id)}
                    onDelete={() => onDelete(chat.id)}
                    onRename={(title) => onRename(chat.id, title)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </nav>

      <button
        onClick={onOpenCompare}
        className="-mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <ColumnsIcon width={16} height={16} />
        Compare models
      </button>
      <button
        onClick={onOpenDashboard}
        className="-mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <ChartIcon width={16} height={16} />
        Usage & benchmark
      </button>
      <button
        onClick={onOpenModels}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <CubeIcon width={16} height={16} />
        Models & memory
      </button>
      <OllamaStatus state={ollama} />
      <ThemeToggle />
    </div>
  );
}
