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
```

`npm run test:e2e` also runs the lifecycle tests, which restart Homebrew's real Ollama service; they skip themselves
when Ollama is already running.

## Ground rules

- **Privacy first.** No telemetry, no remote assets, no new outbound connections. A change that touches the network or
  the API must keep the guards in `proxy.ts` and extend the tests in `tests/e2e/suites/security.mjs`.
- **Every API change comes with tests** in `tests/e2e`, against the fake Ollama (`tests/e2e/helpers/fake-ollama.mjs`).
- **Never use real chats** in tests, screenshots or bug reports. Tests use a throwaway database
  (`OLLAMA_WRAP_DATA_DIR`).
- Keep pull requests small and focused, with a short description of what changes for the user.

## Reporting a security issue

See [SECURITY.md](SECURITY.md): please report it privately, not in a public issue.
