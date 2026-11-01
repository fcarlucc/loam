"use client";

import { useEffect, useRef, useState } from "react";
import { FIT_DETAIL, fitFor, isValidModelName, normalizeModelName } from "@/lib/catalog";
import { readNdjson } from "@/lib/ndjson";
import { memoryGb, useSystemInfo } from "./useSystemInfo";

type Step = "name" | "confirm" | "downloading" | "error";
type PullChunk = { status?: string; digest?: string; total?: number; completed?: number; error?: string };

// Downloads a model into an Ollama engine (`engine` is its id) and reports the progress.
export function InstallDialog({
  engine,
  initialName,
  sizeGb,
  onClose,
  onInstalled,
}: {
  engine: string;
  initialName?: string;
  sizeGb?: number;
  onClose: () => void;
  onInstalled: (name: string) => void;
}) {
  const system = useSystemInfo();
  const [name, setName] = useState(initialName ?? "");
  const [step, setStep] = useState<Step>(initialName ? "confirm" : "name");
  const [status, setStatus] = useState("Starting…");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    return () => abortRef.current?.abort();
  }, []);

  const trimmed = name.trim();
  const validName = isValidModelName(trimmed);

  async function download() {
    const controller = new AbortController();
    abortRef.current = controller;
    setStep("downloading");
    setStatus("Starting…");
    setPercent(null);
    setError(null);

    const layers = new Map<string, { total: number; completed: number }>();
    let done = false;
    try {
      const res = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine, name: trimmed }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Download failed");

      for await (const part of readNdjson<PullChunk>(res.body)) {
        if (part.error) throw new Error(part.error);
        if (part.digest && part.total) layers.set(part.digest, { total: part.total, completed: part.completed ?? 0 });
        if (part.status) setStatus(part.status);
        if (part.status === "success") done = true;
        let total = 0;
        let completed = 0;
        for (const l of layers.values()) {
          total += l.total;
          completed += l.completed;
        }
        if (total > 0) setPercent(Math.min(100, Math.round((completed / total) * 100)));
      }
      if (!done) throw new Error("Download was interrupted");
      // Ollama lists untagged models as "name:latest"
      onInstalled(normalizeModelName(trimmed));
      close();
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Download failed");
      setStep("error");
    }
  }

  // Close the native modal first: while it is open the rest of the page is inert and can't take focus back.
  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function cancel() {
    abortRef.current?.abort();
    close();
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && step !== "downloading") cancel();
      }}
      aria-labelledby="install-title"
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-border surface-glossy p-0 text-fg backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-5">
        {step === "name" && (
          <>
            <div>
              <h2 id="install-title" className="text-base font-semibold">
                Add a model
              </h2>
              <p className="mt-1 text-sm text-muted">
                Enter any model name from the Ollama library, e.g. <span className="font-mono">llama3.1:8b</span>.
              </p>
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && validName && setStep("confirm")}
              placeholder="model:tag"
              spellCheck={false}
              aria-label="Model name"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {step === "confirm" && (
          <div>
            <h2 id="install-title" className="text-base font-semibold">
              Download <span className="font-mono">{trimmed}</span>?
            </h2>
            <p className="mt-1 text-sm text-muted">
              It isn&apos;t installed yet. {sizeGb ? `The download is about ${sizeGb} GB` : "The download can be several GB"} and is
              stored on this Mac. It runs fully locally.
            </p>
            {sizeGb && system && (
              <p className={`mt-2 text-sm ${fitFor(sizeGb, memoryGb(system)) === "good" ? "text-muted" : "text-danger"}`}>
                Your Mac has {memoryGb(system)} GB of memory and this model needs about {Math.round(sizeGb + 1.5)} GB while
                running: {FIT_DETAIL[fitFor(sizeGb, memoryGb(system))]}
              </p>
            )}
          </div>
        )}

        {step === "downloading" && (
          <div aria-live="polite">
            <h2 id="install-title" className="text-base font-semibold">
              Downloading <span className="font-mono">{trimmed}</span>
            </h2>
            <div
              role="progressbar"
              aria-valuenow={percent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className="h-full rounded-full bg-accent-grad transition-[width] duration-300"
                style={{ width: `${percent ?? 4}%`, ...(percent === null ? { animation: "pulse-dot 1.2s ease-in-out infinite" } : {}) }}
              />
            </div>
            <p className="mt-2 flex justify-between text-xs text-muted">
              <span className="truncate">{status.replace(/sha256:\w+/, "layer")}</span>
              {percent !== null && <span className="font-mono">{percent}%</span>}
            </p>
          </div>
        )}

        {step === "error" && (
          <div>
            <h2 id="install-title" className="text-base font-semibold">
              Couldn&apos;t download
            </h2>
            <p role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={cancel} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg">
            {step === "error" ? "Close" : "Cancel"}
          </button>
          {step === "name" && (
            <button
              onClick={() => setStep("confirm")}
              disabled={!validName}
              className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              Continue
            </button>
          )}
          {(step === "confirm" || step === "error") && (
            <button onClick={download} className="rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-medium text-accent-fg">
              {step === "error" ? "Try again" : "Download"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
