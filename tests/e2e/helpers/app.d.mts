// Types of app.mjs, for the browser tests (tests/ui) written in TypeScript.
import type { ChildProcess } from "node:child_process";

export const ROOT: string;
export const DIST_DIR: string;
export function sleep(ms: number): Promise<void>;
export function waitFor<T>(check: () => T | Promise<T>, options?: { timeout?: number; every?: number; what?: string }): Promise<T>;
export function canConnect(host: string, port: number, timeout?: number): Promise<boolean>;
export function freePort(): Promise<number>;
export function exited(child: ChildProcess, timeout: number): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>;

export type App = {
  child: ChildProcess;
  dataDir: string;
  dbPath: string;
  output: string;
  tree: number[];
  port: number | null;
  readonly url: string;
  ready(timeout?: number): Promise<App>;
  cleanup(): Promise<void>;
  stop(): Promise<void>;
};
export function startApp(options?: {
  ollamaUrl?: string;
  manageOllama?: boolean;
  port?: number | null;
  args?: string[];
  env?: Record<string, string>;
  detached?: boolean;
}): Promise<App>;
