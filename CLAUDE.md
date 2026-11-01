@AGENTS.md

## Private data

`data/` holds the owner's real chats. Never read, copy, query or print it, in any way (Read, shell, node scripts,
SQLite, the running app's API). For tests and checks use a throwaway database: set `OLLAMA_WRAP_DATA_DIR` to a temp
folder, as `npm run test:e2e` does.
