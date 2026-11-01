<p align="center">
  <img src="app/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">Loam</h1>

<p align="center">
  <strong>Every local model, one private app.</strong><br>
  <em>Loam</em> stands for <strong>L</strong>ocal <strong>O</strong>ffline <strong>A</strong>I <strong>M</strong>odel.
</p>

<p align="center">
  <a href="https://github.com/fcarlucc/loam/actions/workflows/ci.yml"><img src="https://github.com/fcarlucc/loam/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="macOS">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/chat-dark.png">
    <img src="docs/screenshots/chat-light.png" alt="A chat in Loam: a reasoning model's reply with code, the chat list grouped by date, model and reasoning pickers" width="900">
  </picture>
</p>

Loam is a chat app for the AI models that run on your own computer. Your conversations, files and settings stay on
your Mac: no account, no cloud, no telemetry. It works with [Ollama](https://ollama.com) out of the box, and with
LM Studio, llama.cpp, MLX or any other local server that speaks the OpenAI chat API (see [Engines](#engines)).

## Why

I wanted the comfort of a modern AI chat app without my conversations leaving my machine. The local tools I tried were
either a bare chat box or a server platform that needs Docker. Loam sits in between: a polished, fast chat app for one
person, where privacy is a guarantee checked by tests, not a promise.

## Features

**Chat**
- Streaming replies with Markdown and syntax-highlighted code; stop, regenerate, retry
- Edit a sent message or regenerate a reply: every version is kept, switch between them with ◀ 2/3 ▶
- Branch a conversation from any reply into a new chat
- Reasoning models: turn reasoning off, on or to a level per chat, and read what the model thought in a fold-out block
- Attachments: drop, paste or pick text and code files, and images for models that can see them. Files stay with the
  chat on your Mac and are deleted with it
- Per-chat settings in a side panel: system prompt, temperature, context length, plus defaults for new chats
- Stats under every reply (speed, tokens, how full the context is), with a warning before old messages get dropped
- Chats are named by the model after the first reply; rename them anytime
- Optional desktop notification when a reply finishes while you are in another app

**History**
- Chat list grouped by date, with full-text search across every message
- Deleting a chat wipes its text from the database files, not just from the list

**Models**
- Every local engine in one place: Ollama, LM Studio, llama.cpp, MLX. The model picker groups models by engine and
  shows which engines are off; each chat remembers the engine and model it was using
- One-click download of popular Ollama models, labelled by how well they fit your Mac's memory
- Models & memory panel: what's loaded in RAM, free it, how long models stay loaded, model details, delete models
- Start and stop Ollama from the sidebar
- To help you pick a model to chat with: answers from two models side by side on the same prompt, and a quick speed test
- Usage dashboard: activity, tokens and speed per model

**Privacy**, details in [SECURITY.md](SECURITY.md)
- The app listens on `127.0.0.1` only: other devices on your network can't reach it
- Other websites can't use it: requests with a foreign `Host` or `Origin` are rejected
- The page loads nothing from the internet, and images in replies are never loaded automatically
- Engines must be on this machine (`localhost`, `127.0.0.1`, `[::1]`) unless you opt in explicitly
- All of this is covered by the tests, which run on every push

Light, dark and system themes.

## Requirements

- macOS
- Node.js `^22.13.0 || >=23.4.0` (the built-in `node:sqlite` module is used, no native dependencies)
- At least one engine: [Ollama](https://ollama.com) (the official app, or Homebrew's `brew install ollama`),
  LM Studio, llama.cpp or MLX

## Getting started

```bash
npm install
npm run dev       # with Homebrew's Ollama: starts it, and stops it when the app exits
npm run dev:raw   # with the Ollama app, or any Ollama that is already running
```

Then open the address printed in the terminal: <http://localhost:3000>, or the next free port.

| Script | What it does |
| --- | --- |
| `npm run dev` | Homebrew's Ollama + app; Ollama is stopped when the app exits (Ctrl+C, terminal closed, crash) |
| `npm run dev:raw` | App only, Ollama untouched |
| `npm run build` / `npm start` | Production build on <http://127.0.0.1:3000>; Ollama is managed from the sidebar |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run test:api` | API tests against a fake Ollama, no model needed |
| `npm run test:e2e` | API tests + lifecycle tests with Homebrew's real Ollama |

Pass `-p <port>` (e.g. `npm run dev -- -p 4000`) to choose the port yourself.

## Engines

An engine is a local server that runs models; the app is a client of the engines you already run and never runs,
serves or shares models itself. Ollama at `http://localhost:11434` is set up from the start. To add another, open
**Engines** in the sidebar, pick a preset (or **Other…**), check the URL and press **Test connection**:

| Engine | How it is reached | Preset URL |
| --- | --- | --- |
| [Ollama](https://ollama.com) | Its own API | `http://localhost:11434` |
| [LM Studio](https://lmstudio.ai) | Its local server (Developer tab, "Start server") | `http://127.0.0.1:1234/v1` |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | `llama-server -m model.gguf` | `http://127.0.0.1:8080/v1` |
| [MLX](https://github.com/ml-explore/mlx-lm) | `mlx_lm.server --model …` | `http://127.0.0.1:8080/v1` |
| Anything else | The OpenAI chat API (`/v1/models`, `/v1/chat/completions`) | its base URL, usually ending in `/v1` |

What works where:

| | Ollama | LM Studio, llama.cpp, MLX |
| --- | --- | --- |
| Chat, streaming, stop, edit, regenerate, branch, search | ✓ | ✓ |
| Text attachments | ✓ | ✓ |
| Image attachments | models that can see | sent to the model, which may refuse them |
| Reasoning shown apart from the reply | ✓ | ✓ when the server sends it (`reasoning_content`) |
| Reasoning off / on / level per chat | ✓ | set it in the server |
| System prompt, temperature | ✓ | ✓ |
| Context length per chat | ✓ | set it in the server when loading the model |
| Stats under a reply | tokens, speed, load time, context | tokens; speed as measured here (llama.cpp reports its own) |
| Download, delete, memory, keep-alive, start and stop | ✓ | the server manages its models |
| Compare, benchmark, usage | ✓ | ✓ |

Only engines on this machine are accepted: `localhost`, `127.0.0.1` or `[::1]`. An engine on another computer
would send your messages over the network, so it is refused unless you start the app with
`ALLOW_REMOTE_ENGINES=1`; it is then marked **Remote** wherever it appears.

## Data

Chats and settings live in `data/` (ignored by git). To back them up, copy the whole folder while the app is stopped:
SQLite keeps recent changes in `ollama-wrap.db-wal` next to the database, so the `.db` file alone may be incomplete.

## Tests

`tests/e2e/api.test.mjs` starts the app exactly as `npm run dev` does (`scripts/dev.mjs`), with a throwaway database and
its own build directory, so it can run while the app is open and never touches your chats. It talks to a fake Ollama
(`tests/e2e/helpers/fake-ollama.mjs`) and a fake OpenAI-compatible server (`tests/e2e/helpers/fake-openai.mjs`) that
need no model and no memory, and checks every API route: the loopback-only binding, the `Host` and `Origin` guards on
every route (new ones included), streaming, stop and disconnect, message versions, branching, attachments, deleting
for good, search, settings, usage, the models panel, and the same chat flow through each engine. Engines must be on
this machine: that rule is tested too.

`tests/e2e/migration.test.mjs` opens a database created by the version before engines existed, lets the app migrate
it, and checks that every chat, message, version, attachment and search hit is still there, now attributed to Ollama.

`tests/e2e/lifecycle.test.mjs` uses Homebrew's real Ollama service: it checks that `npm run dev` starts it and stops it
on Ctrl+C, when the terminal is closed and when Next crashes, leaving no process behind. It restarts that service, so it
skips itself when Ollama is already running.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `OLLAMA_HOST_URL` | `http://localhost:11434` | Where the built-in Ollama is (editing it in **Engines** takes precedence) |
| `OLLAMA_WRAP_DATA_DIR` | `data/` | Where chats and settings are stored |
| `ALLOW_REMOTE_ENGINES` | unset | `1` accepts engine URLs on other machines (see [Engines](#engines)) |

## Project layout

```
app/api/chat           send, edit, regenerate or retry, streamed reply (and /stop)
app/api/chats          list, rename, delete, branch chats, per-chat settings, switch versions
app/api/search         full-text search (SQLite FTS5)
app/api/compare        one model's answer for the side-by-side view (nothing saved)
app/api/settings       defaults for new chats, keep-alive
app/api/system         this Mac's chip and memory (model recommendations)
app/api/usage          usage totals, replies per day, per model
app/api/benchmark      speed test results
app/api/engines        the configured engines: list, add, edit, remove, test, model details
app/api/models         every engine with its models, for the model picker
app/api/ollama         Ollama only: status, start/stop, models (list, delete), model info, memory (ps, unload), downloads
app/components         UI (AppShell, Chat, Sidebar, ModelPicker, EnginesDialog, …)
lib/engines            the engine layer: one interface, an Ollama engine and an OpenAI-compatible one (docs/ENGINES.md)
lib/db.ts              SQLite schema, migrations and queries (messages form a tree of versions)
proxy.ts               request guard for /api
scripts/dev.mjs        starts and stops Ollama around `next dev`
tests/e2e              end-to-end tests: API against a fake Ollama, lifecycle against the real one
```

## Roadmap

- **v0.2 · Easy install**: LM Studio, llama.cpp and MLX next to Ollama are in (see [Engines](#engines)); next:
  works with any Ollama install; one-command install; data in `~/Library/Application Support/Loam`
- **v0.3 · Tools and projects**: MCP tools with an approval step before anything runs; projects that group chats with
  shared instructions and files
- **v0.4 · Desktop app**: a native macOS app with a global shortcut, keeping every feature and the UI (strategy in
  [`docs/DESKTOP.md`](docs/DESKTOP.md))
- **Later**: chat with your documents (local, with cited sources), PDF attachments, prompt library, export and import
  (including from other chat apps), local voice input

Progress is tracked in the [issues](https://github.com/fcarlucc/loam/issues).

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately,
as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
