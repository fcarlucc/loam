"use client";

import { useEffect, useState } from "react";
import type { SystemInfo } from "@/lib/types";

// The Mac's chip and memory never change while the app runs: fetched once and shared.
let cached: Promise<SystemInfo | null> | null = null;

export function useSystemInfo() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    cached ??= fetch("/api/system")
      .then((r) => (r.ok ? (r.json() as Promise<SystemInfo>) : null))
      .catch(() => null);
    let alive = true;
    void cached.then((value) => {
      if (alive) setInfo(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

export const memoryGb = (info: SystemInfo) => Math.round(info.memoryBytes / 1024 ** 3);
