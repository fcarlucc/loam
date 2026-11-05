// End-to-end tests of the app's API, run against the app started the way `npm run dev` does
// (scripts/dev.mjs), a fake Ollama (helpers/fake-ollama.mjs) and a fake OpenAI-compatible server
// (helpers/fake-openai.mjs), so they need no model and no memory. One app and the two fakes serve every
// suite: starting Next takes a few seconds.
import { after, before } from "node:test";
import { startApp } from "./helpers/app.mjs";
import { openDb } from "./helpers/db.mjs";
import { startFakeOllama } from "./helpers/fake-ollama.mjs";
import { startFakeOpenAI } from "./helpers/fake-openai.mjs";
import { apiClient } from "./helpers/http.mjs";
import { attachmentsSuite } from "./suites/attachments.mjs";
import { chatSuite } from "./suites/chat.mjs";
import { chatsSuite } from "./suites/chats.mjs";
import { compactSuite } from "./suites/compact.mjs";
import { engineChatSuite, OLLAMA_TARGET, OPENAI_TARGET } from "./suites/engine-chat.mjs";
import { enginesSuite } from "./suites/engines.mjs";
import { ollamaSuite } from "./suites/ollama.mjs";
import { securitySuite } from "./suites/security.mjs";
import { settingsSuite } from "./suites/settings.mjs";

const env = {}; // { ollama, openai, openaiEngine, app, api, db }, filled in before the first test

before(async () => {
  env.ollama = await startFakeOllama();
  env.openai = await startFakeOpenAI();
  env.app = await startApp({ ollamaUrl: env.ollama.url });
  await env.app.ready(120_000);
  env.api = apiClient(env.app.url);
  await env.api.get("/api/chats"); // the first query creates the database
  env.db = openDb(env.app.dbPath);
  // The fake OpenAI-compatible server, added the way a user adds LM Studio.
  const added = await env.api.json("/api/engines", { method: "POST", body: { name: "LM Studio", kind: "openai", baseUrl: `${env.openai.url}/v1` } });
  if (added.status !== 201) throw new Error(`could not add the OpenAI-compatible engine: ${JSON.stringify(added.data)}`);
  env.openaiEngine = added.data.engine.id;
}, { timeout: 150_000 });

after(async () => {
  env.db?.close();
  await env.app?.stop();
  await env.ollama?.close();
  await env.openai?.close();
});

securitySuite(env);
chatSuite(env);
attachmentsSuite(env);
chatsSuite(env);
compactSuite(env);
settingsSuite(env);
ollamaSuite(env);
enginesSuite(env);
engineChatSuite(env, OLLAMA_TARGET);
engineChatSuite(env, OPENAI_TARGET);
