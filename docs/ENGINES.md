# Engines

How the app talks to local AI servers, for contributors. The user-facing side (which engines are supported, how to
add one) is in the README's [Engines](../README.md#engines) section.

## The idea

The app is a client. Every route that needs a model goes through `lib/engines/` and never calls a server's own API:
an engine turns the app's requests into whatever its server speaks and turns the answers back into one shape.
Adding a kind of server means adding one engine class; routes, the database and the UI don't change.

```
app/api/*  ──►  lib/engines/index.ts  ──►  OllamaEngine   (lib/engines/ollama.ts)  ──►  Ollama's API
                 getEngine(id)         ──►  OpenAIEngine   (lib/engines/openai.ts)  ──►  /v1/models, /v1/chat/completions
```

## The interface (`lib/engines/types.ts`)

```ts
interface Engine {
  config: EngineConfig;      // id, name, kind, baseUrl, builtin, remote
  supports: EngineFeatures;  // which management features the UI may show
  status(): Promise<EngineStatus>;                                     // { running, version?, host }
  listModels(): Promise<InstalledModel[]>;                             // throws EngineError when unreachable
  capabilities(model): Promise<ModelCapabilities | undefined>;         // { vision, tools, thinking }, undefined = unknown
  modelInfo(model): Promise<ModelInfo>;                                // for the settings and models panels
  chat(request): Promise<AsyncIterable<StreamEvent>>;                  // see below
  complete(request): Promise<Completion>;                              // a whole reply: titles, benchmarks
  pull?, deleteModel?, loadedModels?, unload?                          // only where `supports` says so
}
```

`ChatRequest` carries the model, the messages (`role`, `content`, and images as base64 with their MIME type) and the
per-chat settings: `temperature`, `contextLength`, `think`, `maxTokens`, `seed`, `keepAlive`, plus an `AbortSignal`.
An engine applies what its server understands and ignores the rest; `supports` tells the UI which settings exist.

`chat()` works in two phases, and that split matters:

1. The promise resolves once the server has **accepted** the request. Until then nothing is written to the database,
   so a refused model or a server that is off leaves no trace. It rejects with an `EngineError` whose `status` the
   route answers with (502 "Cannot reach X. Is it running?", or the server's own message).
2. The iterable then yields normalized events: `{ type: "content", text }`, `{ type: "thinking", text }` and finally
   `{ type: "done", stats? }`. A failure mid-reply (an error object in the stream, a cut connection, a line that
   isn't JSON) is thrown while iterating; the route saves what arrived and ends its own stream with an error event.
   Aborting the request's signal stops the server too.

`stats` is a `ReplyStats` (tokens, tokens per second, prompt tokens, load and total time, context used and size).
Each engine fills what it can measure; what it can't is 0 or left out.

## The engines

| | Ollama | OpenAI-compatible |
| --- | --- | --- |
| Models | `GET /api/tags`, with size and details | `GET /models` (`data[].id`; `meta.n_ctx_train` from llama.cpp gives the context size) |
| Reply | `POST /api/chat`, NDJSON | `POST /chat/completions`, server-sent events, `stream_options.include_usage` |
| Reasoning | `message.thinking`; `think` on, off or a level for models that can | `delta.reasoning_content` (or `reasoning`) when the server sends it; `think` is ignored |
| Images | `images` on the message | `image_url` content parts with a data URL |
| Stats | Ollama's durations and counts | `usage` counts; speed from llama.cpp's `timings` when present, else measured here |
| Capabilities | `POST /api/show`, cached 5 minutes | unknown: images are sent and the server may refuse them |
| Settings | temperature, `num_ctx`, `num_predict`, `seed`, `keep_alive` | temperature, `max_tokens`, `seed` |
| Management | download, delete, loaded models, unload, start/stop (Homebrew) | none: the server loads models itself |

## Configuration and storage

`lib/engines/index.ts` assembles the configured engines: the built-in Ollama (`id: "ollama"`, at `OLLAMA_HOST_URL`
or `http://localhost:11434`, no row needed) and the rows of the `engines` table. Editing the built-in one stores a
row with the same id, which then wins. The built-in engine can't be removed.

`lib/engines/presets.ts` is safe for client components: the kinds, the presets (LM Studio, llama.cpp, MLX) and
`parseEngineUrl`, which enforces the loopback rule. An engine URL must be `http` or `https` on `localhost`,
`127.0.0.1` or `[::1]`; anything else is refused unless `ALLOW_REMOTE_ENGINES=1`, and is then marked `remote` in
the UI. A stored remote engine is refused again when the variable is unset.

Chats remember the engine they were last continued with (`chats.engine`), replies the engine that wrote them
(`messages.engine`), and so do benchmarks. Rows from before engines existed were Ollama's: the migration sets them so.
Engines are referenced by id, not by a foreign key: removing an engine leaves its chats, which can go on with another.

## Routes

- `POST /api/chat`, `/api/compare`, `/api/benchmark` take `engine` (an id; the built-in Ollama when missing).
  `/api/chats/[id]/title` uses the chat's own engine.
- `/api/engines`: list and add; `/api/engines/[id]`: read, rename or re-point, remove; `/api/engines/[id]/test`;
  `/api/engines/[id]/show?model=`.
- `/api/models`: every engine with its models and whether it answers, for the model picker.
- `/api/ollama/*` keep their shapes and take an optional `engine` (query for GET, body otherwise), which must name
  an Ollama engine.

All of them are behind the request guard in `proxy.ts` and swept by `tests/e2e/suites/security.mjs`.

## Adding a kind of engine

1. Add the kind to `EngineKind` (`lib/types.ts`), `ENGINE_KINDS`, `KIND_LABEL` and, if useful, `PRESETS`.
2. Write `lib/engines/<kind>.ts` implementing `Engine`, and construct it in `engineFrom()`.
3. Write a fake server for it in `tests/e2e/helpers/` (see `fake-openai.mjs`) and run `engineChatSuite` against it
   with a target that normalizes what the fake received (see `tests/e2e/suites/engine-chat.mjs`).

## Tests

`tests/e2e/suites/engine-chat.mjs` is the contract: streaming, stop, regenerate and versions, edit, branch,
attachments, reasoning, a server that is off, a malformed stream. It runs once per engine against its fake.
`tests/e2e/suites/engines.mjs` covers configuration (the loopback rule included), the picker, the test button and
the engine-aware routes. `tests/e2e/migration.test.mjs` opens a database built from the schema of the version before
engines (`tests/e2e/fixtures/schema-before-engines.sql`) and checks that nothing was lost.
