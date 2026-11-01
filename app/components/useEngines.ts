"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineModels } from "@/lib/types";

// Every engine with its models and whether it answers, kept fresh while the page is visible: the model
// picker shows offline engines, and a model becomes available as soon as its engine comes up.
export function useEngines() {
  const [engines, setEngines] = useState<EngineModels[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (res.ok) setEngines(((await res.json()) as { engines: EngineModels[] }).engines);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), 5000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { engines: engines ?? [], loaded: engines !== null, refresh };
}

// How an engine that doesn't answer is described, where the page would otherwise say "Ollama is stopped".
export function offlineLabel(engine: EngineModels | undefined) {
  if (!engine) return "No engine is set up";
  return engine.builtin ? "Ollama is stopped" : `${engine.name} is offline`;
}
