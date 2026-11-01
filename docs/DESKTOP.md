# Loam as a desktop app: strategy

> **What this is:** the options for turning Loam (formerly Ollama Wrap) from a local web app (Next.js) into a desktop app, keeping
> every feature and the UI, with their effect on privacy, security and speed. Nothing here is built yet.
>
> **Status:** proposal · **Written:** 2026-10-17

---

## 1. The question

Can the app become a desktop app while keeping every feature and the UI? What changes for security, and what changes
for speed? Privacy is the reason the project exists, so it is the yardstick for every option below.

## 2. What the app is today (read from the code on 2026-10-17)

- **UI:** 19 component files, about 3,100 lines, all rendered on the client (16 are marked
  `"use client"`, the other 3 are pure presentational pieces they import). Next.js is used by
  exactly two files: `app/layout.tsx` (the Geist fonts through `next/font/google`, page metadata) and
  `proxy.ts` (the guard in front of `/api`). No server components with logic, no Server Actions, no
  `next/link`, no `next/image`, no routing beyond the single page.
- **Backend:** 19 route handlers (about 640 lines) written as Web-standard `Request → Response`
  functions, plus `lib/` (about 760 lines; `lib/db.ts` with the schema, migrations and queries is the
  core). Node built-ins used: `node:sqlite`, `node:fs`, `node:path`, `node:os`, `node:child_process`
  (the Ollama power switch runs `brew services`).
- **UI ↔ backend:** 31 `fetch("/api/…")` calls spread over 9 files (8 components and one hook). There
  is no single API client module yet.
- **Streaming:** `/api/chat` forwards Ollama's NDJSON stream to the page and writes to SQLite when the
  reply starts and when it ends; `/api/chat/stop` uses an in-process registry of running replies.
- **Tests:** about 1,570 lines of end-to-end tests at **HTTP level** (`tests/e2e`), run against the
  server with a fake Ollama, plus lifecycle tests against the real Homebrew service. No browser
  automation. This is an asset: every option below is judged also by whether it keeps them.
- **Security already in place:** bound to `127.0.0.1`; `Host` check (DNS rebinding) and `Origin` check on
  every change (CSRF) in `proxy.ts`; Next.js telemetry off; the page loads nothing from the internet;
  images in replies are never auto-loaded; `secure_delete` and WAL truncation when a chat is deleted.
- **Data:** `./data` inside the repo folder (ignored by git), configurable with `OLLAMA_WRAP_DATA_DIR`.
- **Development runs the dev server:** `npm run dev` → `scripts/dev.mjs` → `next dev` (hot reload,
  source maps, Turbopack cache), with Ollama started and stopped around it.
- **Dependencies:** 6 runtime packages in `package.json`, 458 packages installed, `node_modules` 476 MB.

## 3. What "privacy" means here, and what a shell can and cannot change

The privacy property is *chats and prompts never leave the user's machine*. It comes from the design (the model runs
in Ollama locally, the app makes no outside calls), not from the shell. A web app and a desktop app can both keep it.
What a shell changes is the **attack surface** around the data and how **verifiable** the claim is.

**What a desktop app would remove**

1. **The listening socket.** Today a web server sits on a port of the machine. Web pages are kept out by the
   `Host`/`Origin` checks and by the browser's CORS rules; other local processes are not, but a process
   running as the same user can also open the SQLite file directly, so this is not a new exposure. The
   socket is still a door to keep guarding; an app with no server has no door.
2. **A general-purpose web framework between the user and the chats.** `proxy.ts` guards `/api` only; the
   framework's own endpoints (the React Server Components runtime) are guarded by Next.js itself.
   In December 2025 that runtime had a critical remote code execution bug (CVE-2025-55182,
   CVSS 10) that applied *"even if your app does not implement any React Server Function endpoints"*
   (react.dev advisory). On a loopback-only server the practical exposure was small, but it had to be
   noticed and patched. Next.js 16.3.8, the version in use, is past the fixed releases
   (16.0.11 / 16.1.5). The point is the category, not this one bug: a web server is patched several
   times a year, and a privacy tool is better off without one.
3. **Verifiability.** With a desktop app the whole thing is one process with a name. A firewall such as
   LuLu or Little Snitch shows "Loam" connecting only to `127.0.0.1:11434` (and to the model
   registry when a model is downloaded). That is something anyone can check and screenshot. With the web
   app the process is `node` and the UI is a browser tab.

**What a desktop app would NOT change**

- **Ollama's own port.** Ollama listens on `127.0.0.1:11434` with no authentication and lets any page
  served from `localhost` call it (its default `OLLAMA_ORIGINS`). The README already says so. No shell
  changes that.
- **Data at rest.** SQLite stays a plain file. FileVault protects the disk; app-level encryption is a
  separate decision.
- **Supply chain.** npm packages remain (fewer without Next.js, but still hundreds), and a Rust shell
  adds crates. The risk shrinks; it does not disappear.
- **Model downloads** still go to the Ollama registry, through Ollama.

**Security by option** (options are defined in §4)

| | Today: Next.js (`next dev`) | A: Next.js production + Dock | B: Tauri + Node sidecar | C: Tauri only | D: Electron |
|---|---|---|---|---|---|
| Listening socket | Yes, guarded by `Host`/`Origin` | Same | Yes, random loopback port, **secret per launch** required on every request | **None** | None |
| Server framework to keep patched | Next.js, RSC runtime included | Same | None: `node:http` plus a small router | None | None |
| Web engine | The user's browser (patched by its vendor) | Same | System WebKit (patched with macOS) | Same | Bundled Chromium (patched by **the app**, with every Electron release) |
| Who can call the backend | Any local process; web pages blocked | Same | A local process that reads the secret (same user; it can read the DB file anyway) | Only the app's own webview, through capability-scoped IPC | Only the renderer, with `contextIsolation` on |
| Outbound connections | Ollama; model downloads via Ollama; Geist fonts once at build time | Same | Ollama and model downloads only; fonts bundled | Same | Same, plus Chromium's own services unless disabled |
| Where the data lives | `./data` in the repo folder | `~/Library/Application Support/ollama-wrap` | The app's data folder | Same | Same |

## 4. Options

### A. Stay on Next.js, package it for comfort

Keep the code. Change how it runs:

- Daily use on the **production build** (`next build` + `next start -H 127.0.0.1`), started by the same
  kind of script as `dev.mjs` so Ollama still starts and stops with it. Measured: see §5.
- Data in `~/Library/Application Support/ollama-wrap`.
- Own window and Dock icon: Safari *File → Add to Dock*, or Chrome *Install page as app*. The
  page then opens as a standalone window, not a tab.
- Keep Next.js updated.

Keeps: everything. New toolchain: none. Effort: small. Reversible: completely.
Does not give: an `.app` someone can download; a server-free design; Node is still required.

### B. Tauri shell + the React UI + the Node backend as a sidecar

The "keep everything" route.

- **UI:** the 16 components move as they are to a Vite + React project. `layout.tsx` becomes
  `index.html` with the theme script; Geist is bundled as font files (they ship in the `geist` npm
  package) or replaced by the system font. `react-markdown`, `rehype-highlight`, Tailwind: unchanged.
- **Backend:** the 19 handlers and `lib/` stay as they are. A small entry file (about 60–100 lines,
  `node:http` plus a Web `Request`/`Response` adapter such as `srvx` or Hono's node server) routes
  method + path to the existing functions. The `Host`/`Origin` guard from `proxy.ts` becomes a function
  in that file, joined by a **per-launch secret**: the shell generates it, passes it to the sidecar and
  to the webview, and every request must carry it. The data folder comes in through the existing
  `OLLAMA_WRAP_DATA_DIR`.
- **Shell:** Tauri 2 (2.12.4 stable on 2026-10-14; Tauri 3 is in alpha). One
  window, the sidecar started with `tauri-plugin-shell`, a Content Security Policy whose `connect-src`
  allows the sidecar only, the app icon from `logo.png`. On quit: stop the sidecar and Ollama, as
  `dev.mjs` does today. Rust is needed to **build**, not to write: the generated `main.rs` plus a few
  lines for the sidecar.
- **Packaging the sidecar:** Node's Single Executable Application (`node --experimental-sea-config`)
  with the backend bundled into one file; built-in modules such as `node:sqlite` are available in a
  SEA, no native modules involved. Fallback: ship the `node` binary as a resource and a bundled
  `server.js`. Either way the Node runtime adds roughly 100 MB on disk.
- **Tests:** `tests/e2e` keep running, pointed at the sidecar instead of `next dev`. Simpler than today
  (no Turbopack build directory to manage). `tauri-driver` has no macOS support (Tauri docs; the
  WebdriverIO Tauri service does support macOS).

Keeps: UI, backend code, tests. New toolchain: Rust (`rustup`, about 1 GB) to build. Effort: medium.
Security: no port usable without the secret; system WebKit; no web framework. Not the smallest
possible app, because Node ships inside it.

### C. Tauri only, no Node at runtime

- UI as in B.
- SQLite through `tauri-plugin-sql`: `lib/db.ts` is rewritten on an **async** API, migrations become
  Rust `Migration` entries (Tauri docs), the FTS5 search and the triggers must be verified on
  the plugin's bundled SQLite.
- Ollama called **directly from the webview**: Ollama's default allowed origins include
  `tauri://*` (`envconfig/config.go`, checked on 2026-10-17), so no configuration is needed and
  streaming uses the browser `fetch` already in use.
- Power switch via `tauri-plugin-shell` (`brew services`), chip and memory via `tauri-plugin-os`.
- Tests: the 1,570 HTTP-level lines lose their target and are rewritten as unit tests on the data
  layer plus the fake Ollama.

Keeps: UI. Rewrites: data layer and tests. Effort: large. Security: the best of the four (no
socket at all). Size: the smallest (system WebKit, no Node). Worth it only if the size of B or the
sidecar itself turns out to be a problem. Privacy does not require it.

### D. Electron (not recommended here)

- Main process = Node: `lib/db.ts` as is (Electron enabled the built-in SQLite module in its
  Node build with PR #47706; the exact first version is to verify). Renderer = Vite + React. The 19
  handlers become IPC handlers; streaming through `webContents.send` or a `MessagePort`. No Rust.
- Costs for this project: it ships its own Chromium (about 200 MB), the heaviest memory of
  the four, and the app inherits Chromium's patch cadence. For a tool whose selling point is a small,
  verifiable surface, that is the wrong direction. Tests need rework as in C.

### E. Native Swift/SwiftUI: out

A full rewrite that drops the UI. It contradicts "keep everything".

## 5. Speed

Measured on an Apple Silicon Mac (M5, 32 GB) on 2026-10-17 (one run each, throwaway data folder, memory read 2 s after
the first requests; take them as orders of magnitude):

| | `next dev` | `next build` + `next start` |
|---|---|---|
| Ready to answer after launch | 1.0 s | 0.3 s |
| Memory of the server process | 784 MB | 112 MB |
| `/api/chats`, warm | 5 ms | 2 ms |
| Build | not needed | 4.6 s |

Two conclusions:

1. **The biggest speed and memory win needs no rewrite.** Running the production build for daily use
   frees roughly 670 MB, memory the models get back (a 14B model needs about 9 GB).
2. **Where the time goes is the model.** Tokens per second depend on Ollama and the chip, not on the
   shell. A desktop app changes launch time (window up in well under a second, no terminal, no
   browser), memory, and the number of hops: B keeps the same two hops as today (webview → sidecar →
   Ollama), C has one fewer.

Expected but **not measured**: a Tauri app is tens of MB on disk and uses the system webview;
Electron is about 200 MB and runs its own Chromium; a Node sidecar adds the Node runtime (about 100 MB
on disk, some tens of MB of memory).

## 6. Comparison

| | Keeps UI | Keeps backend code | Keeps tests | Socket | New toolchain | Effort |
|---|---|---|---|---|---|---|
| A. Next production + Dock | Yes | Yes | Yes | Yes, guarded | None | Small |
| B. Tauri + Node sidecar | Yes | Yes | Yes | Random port + secret | Rust to build | Medium |
| C. Tauri only | Yes | No (data layer rewritten) | No (rewritten) | None | Rust | Large |
| D. Electron | Yes | Mostly (IPC) | Partly | None | None | Medium |

## 7. Recommendation

1. **A first.** Production build for daily use, data folder moved, page added to the Dock. It gives the
   desktop feel with little work, the memory back, and a baseline to judge the rest against.
2. **B when a downloadable `.app` is wanted.** A well-guarded web app is not a mistake; B is the step that
   makes the app installable like any Mac app.
3. **B is the transition, in this order.** Every step leaves the app usable and the tests green:
   1. **`lib/api.ts`**: the 31 `fetch` calls go through one module (base URL, headers). Same behavior,
      tests unchanged. Needed by every desktop option and an improvement even without leaving Next.
   2. **Standalone backend**: the `node:http` entry that routes to the existing handlers, guard included.
      Done when `npm run test:e2e` passes against it with the fake Ollama. From here Next.js is only
      the UI's dev server.
   3. **UI on Vite**: components, `globals.css`, theme script, bundled fonts, the API base from config.
      Done when the UI works in the browser against step 2. At this point the project is also a leaner
      web app.
   4. **Tauri shell**: window, sidecar with secret and data folder, CSP, icon, quit hook (sidecar and
      Ollama stopped). Done when the `.app` launches from the Dock with every feature working and the
      checks in §8 pass.
   5. **Cut-over**: app stopped, copy `ollama-wrap.db` with its `-wal` and `-shm` files into the app
      data folder, then remove Next.js from `package.json` and update the README.
4. **C is a later option, not a goal.**
5. **D is not for this project.**

## 8. Checks for the desktop version (B)

Run on the Mac with the app open.

| # | Check | Expected |
|---|---|---|
| K1 | `lsof -nP -iTCP -sTCP:LISTEN` | Only the sidecar, on `127.0.0.1`, on a port that changes at every launch |
| K2 | `curl` the sidecar without the secret | Refused (401/403) on every route, including `GET` |
| K3 | `curl` with the secret and a foreign `Origin` | Refused on changes, as today |
| K4 | Firewall (LuLu or Little Snitch) while chatting and while downloading a model | Only `127.0.0.1:11434`; the registry only during the download; nothing else |
| K5 | `npm run test:e2e` against the sidecar | Green |
| K6 | Quit the app | Sidecar gone, Ollama stopped (if that rule stays, see Q3) |
| K7 | The data folder | Outside the repo, under `~/Library/Application Support` |
| K8 | Inspect the `.app` bundle | No `.env`, no `data/`, no chats inside |

## 9. Open questions

- **Q1.** Desktop app, or A only?
- **Q2.** If desktop: B (keep Node, keep tests) or C (no Node, rewrite data layer and tests)?
- **Q3.** Keep the rule "Ollama stops when the app quits" in the desktop app? Today it is a feature of
  `dev.mjs` and the lifecycle tests.
- **Q4.** Building B or C needs a Rust toolchain (`rustup`, about 1 GB) on the build machine.
- **Q5.** For public releases: sign and notarize the app (Apple Developer account, 99 $/year) or document the
  "right-click → Open" workaround?

## 10. To verify before building B

- Node SEA with `node:sqlite` and the bundled backend: build it once, run the tests against it.
- Streaming `fetch` from the webview to the sidecar (WKWebView supports `ReadableStream`; the sidecar
  must answer CORS for the `tauri://localhost` origin, or requests go through Tauri's HTTP plugin).
- `navigator.clipboard` in the copy button inside WKWebView; fallback `tauri-plugin-clipboard-manager`.
- `brew` from a GUI app: the power route already prepends `/opt/homebrew/bin` to `PATH`; confirm it
  still works when launched from the Dock (GUI apps do not inherit the shell's `PATH`).

## Sources, all read on 2026-10-17

- React advisory for CVE-2025-55182: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
- Ollama default origins: `envconfig/config.go` in https://github.com/ollama/ollama
- Tauri releases: https://github.com/tauri-apps/tauri/releases
- Tauri SQL plugin: https://v2.tauri.app/plugin/sql/
- Tauri WebDriver testing (macOS note): https://v2.tauri.app/develop/tests/webdriver/
- Electron built-in SQLite: PR #47706 in https://github.com/electron/electron
