# Contributing

Thanks for helping. Issues and pull requests are welcome: bugs, features from the roadmap, docs.

## Setup

Requirements: macOS, Node.js `^22.13.0 || >=23.4.0`, and Ollama (the official app, or Homebrew's `brew install ollama`).

```bash
npm install
npm run dev       # with Homebrew's Ollama: starts it, and stops it when the app exits
npm run dev:raw   # with the Ollama app, or any Ollama already running
```

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run test:api   # API tests against a fake Ollama, no model needed
npm run test:unit  # small pure functions (lib/math.ts)
npm run test:ui    # browser tests of the UI, same fake Ollama (Chromium: npx playwright install chromium, once)
```

`npm run test:e2e` also runs the lifecycle tests, which restart Homebrew's real Ollama service; they skip themselves
when Ollama is already running.

The browser tests (`tests/ui`, [Playwright](https://playwright.dev)) start the app with a throwaway database and a
fake Ollama, like the API tests, and click through the main flows: sending and stopping a reply, versions, branching,
the chat list and search, chat settings, attachments, reasoning, math and diagrams, Ollama going offline, themes. The
page is kept off the internet while they run. When a test fails, `playwright-report/` holds a trace of what the
browser saw (`npx playwright show-report`). To watch them run: `npx playwright test --headed`, or `--ui`.

## Ground rules

- **Privacy first.** No telemetry, no remote assets, no new outbound connections. A change that touches the network or
  the API must keep the guards in `proxy.ts` and extend the tests in `tests/e2e/suites/security.mjs`.
- **Every API change comes with tests** in `tests/e2e`, against the fake Ollama (`tests/e2e/helpers/fake-ollama.mjs`)
  and the fake OpenAI-compatible server (`tests/e2e/helpers/fake-openai.mjs`). The app only ever talks to engines
  through `lib/engines` (see [`docs/ENGINES.md`](docs/ENGINES.md)); a new kind of engine gets its own fake and runs
  the shared chat suite.
- **A change to the UI keeps `npm run test:ui` green**, and a new flow gets a test in `tests/ui`. Target elements by
  their role and accessible name; add a `data-testid` only where there is no such name.
- **Never use real chats** in tests, screenshots or bug reports. Tests use a throwaway database
  (`OLLAMA_WRAP_DATA_DIR`).
- Keep pull requests small and focused, with a short description of what changes for the user.

## Reporting a security issue

See [SECURITY.md](SECURITY.md): please report it privately, not in a public issue.
