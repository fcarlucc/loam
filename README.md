# Ollama Wrap

A local web UI for chatting with your [Ollama](https://ollama.com) models. Chats are saved in SQLite and stay in the sidebar between launches.

- Streaming replies with Markdown and syntax-highlighted code, stop / regenerate / retry
- Edit a sent message or regenerate a reply: every version is kept, switch between them with ◀ 2/3 ▶
- Per-chat settings in a right sidebar: system prompt, temperature, context length, plus defaults for new chats
- Stats under every reply (speed, tokens, how full the context is), with a warning before old messages get dropped
- Chat history in the sidebar (rename, delete), grouped by date, with full-text search across every message
- Chats are named by the model after the first reply (a few words, in the language of the conversation); rename them
  anytime. Skipped when models are set to unload right after each reply, since naming would load the model again
- Model picker next to the composer, with one-click download of popular models, labelled by how well they fit this Mac's memory
- Compare two models side by side on the same prompt (answers, speed, load time; not saved)
- Models & memory panel: what's loaded in RAM, free it, how long models stay loaded, model details, delete models
- Usage dashboard (activity, tokens, speed per model) and a repeatable speed benchmark
- Start/stop Ollama from the sidebar; light, dark and system themes
- Optional desktop notification when a reply finishes while you are in another app or tab (bell in the sidebar)
- Reasoning models: turn the reasoning off, on or to a level per chat (next to the model picker) and read what the
  model thought in a fold-out block under the reply. The reasoning is kept with the reply but never sent back to the model
- Attachments: drop, paste or pick text and code files (up to 8 per message, 200K characters each), and images for
  models that can see them, resized in the browser to about 1024 px. Files stay with the chat on this Mac and are
  deleted with it; a warning shows when they take more than half of the model's context. No PDF yet

## Requirements

- macOS with Ollama installed through Homebrew: `brew install ollama`
- Node.js `^22.13.0 || >=23.4.0` (the built-in `node:sqlite` module is used, no native dependencies)

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts Ollama (`brew services restart ollama`), then the app, and prints the address to open:
<http://localhost:3000>, or the next free port if another app already uses it.
When the app exits (Ctrl+C, closing the terminal, a crash) it runs `brew services stop ollama`, so the model never keeps running in the background.

| Script | What it does |
| --- | --- |
| `npm run dev` | Ollama + app, Ollama stopped on exit |
| `npm run dev:raw` | App only, Ollama untouched |
| `npm run build` / `npm start` | Production build on <http://127.0.0.1:3000>; Ollama is managed from the sidebar |
| `npm run test:e2e` | End-to-end tests, see [Tests](#tests) |

Pass `-p <port>` (e.g. `npm run dev -- -p 4000`) to choose the port yourself.

## Data

Chats and settings live in `data/` (ignored by git). To back them up, copy the whole folder while the app is stopped:
SQLite keeps recent changes in `ollama-wrap.db-wal` next to the database, so the `.db` file alone may be incomplete.

## Privacy and security

Everything stays on this machine:

- The server listens on `127.0.0.1` only, so other devices on the network can't reach it.
- The API (`proxy.ts`) rejects requests whose `Host` isn't local (DNS rebinding) and changes that don't come from the app's own page (CSRF).
- Images in model replies are shown as links and never loaded automatically, so a reply can't send data to a remote server.
- Next.js telemetry is switched off by the scripts, and the page loads nothing from the internet. The only outbound
  connections are the ones you ask for (downloading a model) and Next.js fetching the Geist font files once when it compiles.
- Reply notifications are off by default. When on, your browser shows them through macOS, so the start of a reply
  appears in Notification Center like any other notification. Nothing is sent anywhere.

All of this is checked by the tests below. Two things are outside the app's control:

- Ollama's own API on port 11434 also listens on the loopback only, but Ollama lets any page served from `localhost`
  call it directly (that is its default `OLLAMA_ORIGINS`). Another local web app could use your models; this app can't change that.
- If the `node` process is killed with `kill -9`, nothing can run, so Ollama stays up until you run `brew services stop ollama`.

## Tests

```bash
npm run test:e2e
```

`tests/e2e/api.test.mjs` starts the app exactly as `npm run dev` does (`scripts/dev.mjs`), with a throwaway database
and its own build directory (`.next-e2e`), so it can run while the app is open and never touches your chats. It talks
to a fake Ollama (`tests/e2e/helpers/fake-ollama.mjs`) that needs no model and no memory, and checks every API route:
the loopback-only binding, the `Host` and `Origin` guards on every route (new ones included), streaming, stop and
disconnect, message versions, deleting for good, search, settings, usage, benchmark, compare, the models panel.

`tests/e2e/lifecycle.test.mjs` uses the real Homebrew Ollama service: it checks that `npm run dev` starts it and stops it
on Ctrl+C, when the terminal is closed and when Next crashes, leaving no process behind, that the sidebar's power switch
works and that a taken port is skipped. It restarts that service, so it skips itself when Ollama is already running.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `OLLAMA_HOST_URL` | `http://localhost:11434` | Where the Ollama API is |
| `OLLAMA_WRAP_DATA_DIR` | `data/` | Where chats and settings are stored |

## Project layout

```
app/api/chat           send, edit, regenerate or retry, streamed reply (and /stop)
app/api/chats          list, rename, delete chats, per-chat settings, switch versions
app/api/search         full-text search (SQLite FTS5)
app/api/compare        one model's answer for the comparison view (nothing saved)
app/api/settings       defaults for new chats, keep-alive
app/api/system         this Mac's chip and memory (model recommendations)
app/api/usage          usage totals, replies per day, per model
app/api/benchmark      run / list / clear benchmark results
app/api/ollama         status, start/stop, models (list, delete), model info, memory (ps, unload), downloads
app/components         UI (AppShell, Chat, Sidebar, ModelPicker, …)
lib/db.ts              SQLite schema, migrations and queries (messages form a tree of versions)
proxy.ts               request guard for /api
scripts/dev.mjs        starts and stops Ollama around `next dev`
tests/e2e              end-to-end tests: API against a fake Ollama, lifecycle against the real one
```
