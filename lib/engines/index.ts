import { isModelId, isValidModelName } from "../catalog";
import { getEngineRow, listEngineRows } from "../db";
import type { EngineConfig } from "../types";
import { OllamaEngine } from "./ollama";
import { OpenAIEngine } from "./openai";
import { BUILTIN_OLLAMA_ID, DEFAULT_OLLAMA_URL, isEngineId, isLoopbackUrl } from "./presets";
import { type Engine, EngineError } from "./types";

export type { ChatRequest, Completion, Engine, EngineFeatures, EngineStatus, ModelCapabilities, ModelMessage, StreamEvent } from "./types";
export { EngineError } from "./types";

// The engines the user configured, as Engine objects. The built-in Ollama exists without any setup, at
// OLLAMA_HOST_URL or http://localhost:11434; editing it in the app stores a row that takes precedence.

// Engines on other machines are accepted only when asked for explicitly: the app's promise is that
// chats stay on this machine.
export const remoteEnginesAllowed = () => process.env.ALLOW_REMOTE_ENGINES === "1";

function builtinOllama(): EngineConfig {
  const baseUrl = (process.env.OLLAMA_HOST_URL ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
  return { id: BUILTIN_OLLAMA_ID, name: "Ollama", kind: "ollama", baseUrl, builtin: true, remote: !isLoopbackUrl(baseUrl) };
}

const fromRow = (row: ReturnType<typeof listEngineRows>[number]): EngineConfig => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  baseUrl: row.base_url,
  builtin: row.id === BUILTIN_OLLAMA_ID,
  remote: !isLoopbackUrl(row.base_url),
});

// Every configured engine, the built-in Ollama first.
export function engineConfigs(): EngineConfig[] {
  const rows = listEngineRows();
  const edited = rows.find((r) => r.id === BUILTIN_OLLAMA_ID);
  return [edited ? fromRow(edited) : builtinOllama(), ...rows.filter((r) => r.id !== BUILTIN_OLLAMA_ID).map(fromRow)];
}

export function engineConfig(id: string): EngineConfig | undefined {
  if (id === BUILTIN_OLLAMA_ID) {
    const row = getEngineRow(id);
    return row ? fromRow(row) : builtinOllama();
  }
  const row = getEngineRow(id);
  return row && fromRow(row);
}

export function engineFrom(config: EngineConfig): Engine {
  return config.kind === "ollama" ? new OllamaEngine(config) : new OpenAIEngine(config);
}

// The engine with this id, ready to use. Throws an EngineError the route can answer with.
export function getEngine(id: string): Engine {
  const config = engineConfig(id);
  if (!config) throw new EngineError("Engine not found", 404);
  if (config.remote && !remoteEnginesAllowed()) {
    throw new EngineError(`${config.name} is on another machine: set ALLOW_REMOTE_ENGINES=1 to use it`, 403);
  }
  return engineFrom(config);
}

// The engine a request names (`engine` in its body or query), the built-in Ollama when it names none.
// Returns the error response to send when the id is malformed, unknown or not allowed.
export function resolveEngine(id: unknown): Engine | Response {
  const wanted = id === undefined || id === null ? BUILTIN_OLLAMA_ID : id;
  if (!isEngineId(wanted)) return Response.json({ error: "Invalid engine" }, { status: 400 });
  try {
    return getEngine(wanted);
  } catch (e) {
    return engineFailure(e);
  }
}

// The response for something an engine refused or couldn't do; anything else is a bug and is rethrown.
export function engineFailure(e: unknown): Response {
  if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
}

// Whether `model` is a name this engine can be asked for: Ollama's own name format, or any id an
// OpenAI-compatible server lists (a file path, an id with @, ...).
export function acceptsModel(engine: Engine, model: string) {
  return engine.config.kind === "ollama" ? isValidModelName(model) : isModelId(model);
}

// Same, for the routes under /api/ollama: the engine must be an Ollama.
export function resolveOllama(id: unknown): Engine | Response {
  const engine = resolveEngine(id);
  if (engine instanceof Response) return engine;
  if (engine.config.kind !== "ollama") return Response.json({ error: `${engine.config.name} is not an Ollama engine` }, { status: 400 });
  return engine;
}
