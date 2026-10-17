// End-to-end tests of the app's API, run against the app started the way `npm run dev` does
// (scripts/dev.mjs) and a fake Ollama (helpers/fake-ollama.mjs), so they need no model and no memory.
// One app and one fake serve every suite: starting Next takes a few seconds.
import { after, before } from "node:test";
import { startApp } from "./helpers/app.mjs";
import { openDb } from "./helpers/db.mjs";
import { startFakeOllama } from "./helpers/fake-ollama.mjs";
import { apiClient } from "./helpers/http.mjs";
import { chatSuite } from "./suites/chat.mjs";
import { chatsSuite } from "./suites/chats.mjs";
import { ollamaSuite } from "./suites/ollama.mjs";
import { securitySuite } from "./suites/security.mjs";
import { settingsSuite } from "./suites/settings.mjs";

const env = {}; // { ollama, app, api, db }, filled in before the first test

before(async () => {
  env.ollama = await startFakeOllama();
  env.app = await startApp({ ollamaUrl: env.ollama.url });
  await env.app.ready(120_000);
  env.api = apiClient(env.app.url);
  await env.api.get("/api/chats"); // the first query creates the database
  env.db = openDb(env.app.dbPath);
}, { timeout: 150_000 });

after(async () => {
  env.db?.close();
  await env.app?.stop();
  await env.ollama?.close();
});

securitySuite(env);
chatSuite(env);
chatsSuite(env);
settingsSuite(env);
ollamaSuite(env);
