# Ollama Wrap

A local web UI for chatting with your [Ollama](https://ollama.com) models. Chats are saved in SQLite and stay in the sidebar between launches.

- Streaming replies with Markdown and syntax-highlighted code, stop / regenerate / retry
- Edit a sent message or regenerate a reply: every version is kept, switch between them with ◀ 2/3 ▶
- Per-chat settings in a right sidebar: system prompt, temperature, context length, plus defaults for new chats
- Stats under every reply (speed, tokens, how full the context is), with a warning before old messages get dropped
- Chat history in the sidebar (rename, delete), grouped by date
- Model picker next to the composer, with one-click download of popular models
- Models & memory panel: what's loaded in RAM, free it, how long models stay loaded, model details, delete models
- Start/stop Ollama from the sidebar; light, dark and system themes

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

Pass `-p <port>` (e.g. `npm run dev -- -p 4000`) to choose the port yourself.

## Data

Chats and settings live in `data/` (ignored by git). To back them up, copy the whole folder while the app is stopped:
SQLite keeps recent changes in `ollama-wrap.db-wal` next to the database, so the `.db` file alone may be incomplete.

## Privacy and security

Everything stays on this machine:

- The server listens on `127.0.0.1` only, so other devices on the network can't reach it.
- The API (`proxy.ts`) rejects requests whose `Host` isn't local (DNS rebinding) and changes that don't come from the app's own page (CSRF).
- Images in model replies are shown as links and never loaded automatically, so a reply can't send data to a remote server.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `OLLAMA_HOST_URL` | `http://localhost:11434` | Where the Ollama API is |

## Project layout

```
app/api/chat           send, edit, regenerate or retry, streamed reply (and /stop)
app/api/chats          list, rename, delete chats, per-chat settings, switch versions
app/api/settings       defaults for new chats
app/api/ollama         status, start/stop, models (list, delete), model info, memory (ps, unload), downloads
app/components         UI (AppShell, Chat, Sidebar, ModelPicker, …)
lib/db.ts              SQLite schema, migrations and queries (messages form a tree of versions)
proxy.ts               request guard for /api
scripts/dev.mjs        starts and stops Ollama around `next dev`
```
