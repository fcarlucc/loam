"use client";

import { useEffect, useRef, useState } from "react";
import { readNdjson } from "@/lib/ndjson";
import type { ChatEvent, ReplyStats } from "@/lib/types";
import { TypingDots } from "./Chat";
import { MenuIcon, SendIcon, StopIcon, XIcon } from "./icons";
import { Markdown } from "./Markdown";
import { StatsLine } from "./StatsLine";

type Answer = {
  model: string;
  text: string;
  stats?: ReplyStats;
  status: "waiting" | "streaming" | "done" | "stopped" | "error";
  error?: string;
};

const selectClass =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs outline-none focus:border-accent disabled:opacity-50";

// Same prompt to two models, answers side by side. The models run one after the other so only one
// has to be loaded at a time; nothing is saved to the chat history.
export function CompareView({
  models,
  defaultModel,
  ollamaRunning,
  onClose,
  onOpenSidebar,
}: {
  models: string[];
  defaultModel: string;
  ollamaRunning: boolean;
  onClose: () => void;
  onOpenSidebar: () => void;
}) {
  const [modelA, setModelA] = useState(defaultModel);
  const [modelB, setModelB] = useState(() => models.find((m) => m !== defaultModel) ?? defaultModel);
  const [prompt, setPrompt] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const running = answers?.some((a) => a.status === "waiting" || a.status === "streaming") ?? false;
  const ready = ollamaRunning && !!modelA && !!modelB && !running;

  const update = (i: number, change: (a: Answer) => Answer) =>
    setAnswers((list) => list && list.map((a, j) => (j === i ? change(a) : a)));

  async function ask(i: number, model: string, content: string, signal: AbortSignal) {
    update(i, (a) => ({ ...a, status: "streaming" }));
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, content }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Something went wrong");
    for await (const event of readNdjson<ChatEvent>(res.body)) {
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "delta") update(i, (a) => ({ ...a, text: a.text + event.text }));
      if (event.type === "done") update(i, (a) => ({ ...a, stats: event.stats, status: "done" }));
    }
  }

  async function run() {
    const content = prompt.trim();
    if (!ready || !content) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAsked(content);
    setPrompt("");
    const pair = [modelA, modelB];
    setAnswers(pair.map((model) => ({ model, text: "", status: "waiting" })));
    for (const [i, model] of pair.entries()) {
      if (controller.signal.aborted) {
        update(i, (a) => ({ ...a, status: "stopped" }));
        continue;
      }
      try {
        await ask(i, model, content, controller.signal);
      } catch (e) {
        update(i, (a) =>
          controller.signal.aborted
            ? { ...a, status: "stopped" }
            : { ...a, status: "error", error: e instanceof Error ? e.message : "Something went wrong" },
        );
      }
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <button
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg md:hidden"
        >
          <MenuIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-muted">Compare models</h1>
        <button
          onClick={onClose}
          aria-label="Close comparison"
          title="Back to chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        >
          <XIcon width={16} height={16} />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <select value={modelA} onChange={(e) => setModelA(e.target.value)} disabled={running} aria-label="Model A" className={selectClass}>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <span className="text-xs text-muted">vs</span>
        <select value={modelB} onChange={(e) => setModelB(e.target.value)} disabled={running} aria-label="Model B" className={selectClass}>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!answers ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Which model answers better?</h2>
            <p className="text-sm text-muted">
              Ask both models the same question and compare the answers, their speed and the time spent loading. They run one
              after the other, with your default chat settings, and nothing is saved.
            </p>
            {models.length < 2 && (
              <p className="text-sm text-muted">Only one model is installed: download another from the model picker to compare.</p>
            )}
          </div>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
            <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-grad px-4 py-2.5 text-accent-fg">
              {asked}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {answers.map((a, i) => (
                <section key={i} aria-label={`Answer from ${a.model}`} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-4">
                  <h3 className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono">{a.model}</span>
                    <span className="shrink-0 text-muted">
                      {a.status === "waiting" ? "Waiting for the other model…" : a.status === "stopped" ? "Stopped" : ""}
                    </span>
                  </h3>
                  {a.text ? <Markdown>{a.text}</Markdown> : a.status === "streaming" && <TypingDots />}
                  {a.status === "error" && (
                    <p role="alert" className="text-sm text-danger">
                      {a.error}
                    </p>
                  )}
                  {a.stats && (
                    <div className="mt-auto">
                      <StatsLine stats={a.stats} />
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border surface-glossy p-2 focus-within:border-accent">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void run();
              }
            }}
            rows={2}
            autoFocus
            disabled={!ollamaRunning}
            placeholder={ollamaRunning ? "Ask both models…" : "Start Ollama to compare"}
            aria-label="Prompt for both models"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
          {running ? (
            <button
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-fg hover:border-accent"
            >
              <StopIcon width={14} height={14} />
            </button>
          ) : (
            <button
              onClick={() => void run()}
              disabled={!ready || !prompt.trim()}
              aria-label="Ask both models"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-grad text-accent-fg transition-opacity disabled:opacity-30"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
