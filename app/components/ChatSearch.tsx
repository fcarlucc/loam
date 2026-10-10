"use client";

import { useEffect, useState } from "react";
import { MARK_END, MARK_START } from "@/lib/format";
import type { SearchHit } from "@/lib/types";
import { SearchIcon, XIcon } from "./icons";

// Snippet text with the matched words highlighted.
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(MARK_START).map((part, i) => {
        if (i === 0) return part;
        const [hit, rest] = part.split(MARK_END);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-accent-soft text-fg">{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}

// Search box for the sidebar. While it has text, `results` replaces the chat list.
export function useChatSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const active = query.trim().length > 0;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: { hits: SearchHit[] }) => setHits(data.hits))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, active]);

  return { query, setQuery, hits: active ? hits : null, active };
}

export function SearchBox({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  return (
    <div className="relative">
      <SearchIcon width={15} height={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder="Search chats"
        aria-label="Search chats"
        className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-8 text-sm outline-none placeholder:text-muted focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg"
        >
          <XIcon width={13} height={13} />
        </button>
      )}
    </div>
  );
}

export function SearchResults({ hits, onOpen }: { hits: SearchHit[] | null; onOpen: (chatId: number, messageId: number | null) => void }) {
  if (hits === null) return <p className="px-3 py-4 text-sm text-muted">Searching…</p>;
  if (hits.length === 0) return <p className="px-3 py-4 text-sm text-muted">No matches.</p>;
  return (
    <ul aria-label="Search results" className="flex flex-col gap-0.5">
      {hits.map((h) => (
        <li key={h.messageId ?? `chat-${h.chatId}`}>
          <button
            onClick={() => onOpen(h.chatId, h.messageId)}
            className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
          >
            <span className="block truncate text-xs font-medium text-muted">
              {h.title}
              {h.role && <span className="font-normal"> · {h.role === "user" ? "you" : "reply"}</span>}
            </span>
            <span className="line-clamp-2 text-sm">{h.snippet ? <Snippet text={h.snippet} /> : h.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
