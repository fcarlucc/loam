// A database created before engines existed must open in the current app with nothing lost: every chat,
// message, version, attachment and search hit as it was, and everything attributed to Ollama.
// The fixture is built from the schema of that version (tests/e2e/fixtures/schema-before-engines.sql).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { ROOT, startApp } from "./helpers/app.mjs";
import { startFakeOllama } from "./helpers/fake-ollama.mjs";
import { apiClient } from "./helpers/http.mjs";

const plain = (row) => ({ ...row });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const T = 1_700_000_000_000;

// Columns of each table before the migration, read from the fixture itself.
const OLD_COLUMNS = {};

// A small but complete history: two chats, one branched off the other; an edited message and a
// regenerated reply (versions); text and image attachments; a benchmark; settings.
function fill(db) {
  const stats = (tokens) => JSON.stringify({ tokens, tokensPerSecond: 50, promptTokens: 20, loadMs: 50, totalMs: 500, contextUsed: 20 + tokens, contextSize: 8192 });
  db.exec(`INSERT INTO chats (id, title, model, created_at, updated_at, settings, leaf_id) VALUES (1, 'Trip to Rome', 'llama3.2:3b', ${T}, ${T + 5}, '{"system":"Be brief.","think":"low"}', NULL)`);
  const msg = db.prepare("INSERT INTO messages (id, chat_id, parent_id, role, content, created_at, stats, thinking, model, copied) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  msg.run(1, 1, null, "user", "Plan a trip to Rome", T + 1, null, null, null, 0);
  msg.run(2, 1, 1, "assistant", "Three days: Colosseum, Vatican, Trastevere.", T + 2, stats(9), "The user wants a short plan.", "llama3.2:3b", 0);
  msg.run(3, 1, 1, "assistant", "Two days are enough for the zebrafish highlights.", T + 3, stats(8), null, "llama3.2:3b", 0); // regenerated reply
  msg.run(4, 1, null, "user", "Plan a trip to Rome in May", T + 4, null, null, null, 0); // edited first message
  msg.run(5, 1, 4, "assistant", "May is warm: mornings for ruins, evenings for food.", T + 5, stats(11), null, "llama3.2:3b", 0);
  db.exec("UPDATE chats SET leaf_id = 5 WHERE id = 1");
  const att = db.prepare("INSERT INTO attachments (id, message_id, name, type, kind, size, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  att.run(1, 1, "notes.txt", "text/plain", "text", 9, "Milk\nEggs", null, T + 1);
  att.run(2, 1, "dot.png", "image/png", "image", PNG.length, null, PNG, T + 1);
  // A branch of the first version of the reply.
  db.exec(`INSERT INTO chats (id, title, model, created_at, updated_at, settings, leaf_id, branch_of) VALUES (2, 'Branch · Trip to Rome', 'qwen2.5:7b', ${T + 10}, ${T + 12}, '{}', NULL, 1)`);
  msg.run(6, 2, null, "user", "Plan a trip to Rome", T + 1, null, null, null, 1);
  msg.run(7, 2, 6, "assistant", "Three days: Colosseum, Vatican, Trastevere.", T + 2, stats(9), "The user wants a short plan.", "llama3.2:3b", 1);
  msg.run(8, 2, 7, "user", "Make it four", T + 11, null, null, null, 0);
  msg.run(9, 2, 8, "assistant", "Four days: add Ostia Antica.", T + 12, stats(6), null, "qwen2.5:7b", 0);
  db.exec("UPDATE chats SET leaf_id = 9 WHERE id = 2");
  att.run(3, 6, "notes.txt", "text/plain", "text", 9, "Milk\nEggs", null, T + 10);
  att.run(4, 6, "dot.png", "image/png", "image", PNG.length, null, PNG, T + 10);
  db.exec(`INSERT INTO benchmarks (id, model, created_at, cold, tokens, tokens_per_second, prompt_per_second, load_ms, total_ms) VALUES (1, 'llama3.2:3b', ${T}, 1, 300, 42.5, 310.2, 1800, 9000)`);
  db.exec(`INSERT INTO app_settings (key, value) VALUES ('chat_defaults', '{"temperature":0.4}'), ('keep_alive', '60')`);
}

const TABLES = ["chats", "messages", "attachments", "benchmarks", "app_settings"];
const dump = (db, table) => db.prepare(`SELECT ${OLD_COLUMNS[table].join(", ")} FROM ${table} ORDER BY rowid`).all().map(plain);

describe("a database from before engines", () => {
  const env = {};
  const snapshot = {};

  before(async () => {
    env.dataDir = await mkdtemp(join(tmpdir(), "ollama-wrap-migration-"));
    const db = new DatabaseSync(join(env.dataDir, "ollama-wrap.db"));
    db.exec(await readFile(join(ROOT, "tests/e2e/fixtures/schema-before-engines.sql"), "utf8"));
    for (const table of TABLES) OLD_COLUMNS[table] = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    fill(db);
    for (const table of TABLES) snapshot[table] = dump(db, table);
    db.close();

    env.ollama = await startFakeOllama();
    env.app = await startApp({ ollamaUrl: env.ollama.url, dataDir: env.dataDir });
    await env.app.ready(120_000);
    env.api = apiClient(env.app.url);
    await env.api.get("/api/chats"); // the first query migrates
    env.db = new DatabaseSync(env.app.dbPath, { readOnly: true });
  }, { timeout: 150_000 });

  after(async () => {
    env.db?.close();
    await env.app?.stop();
    await env.ollama?.close();
    await rm(env.dataDir, { recursive: true, force: true });
  });

  it("keeps every row as it was, and attributes everything to Ollama", () => {
    for (const table of TABLES) assert.deepEqual(dump(env.db, table), snapshot[table], `${table} changed`);
    assert.deepEqual(
      env.db.prepare("SELECT id, engine FROM chats ORDER BY id").all().map(plain),
      [
        { id: 1, engine: "ollama" },
        { id: 2, engine: "ollama" },
      ],
    );
    assert.deepEqual(
      env.db.prepare("SELECT role, engine, count(*) AS n FROM messages GROUP BY role, engine ORDER BY role").all().map(plain),
      [
        { role: "assistant", engine: "ollama", n: 5 },
        { role: "user", engine: null, n: 4 },
      ],
      "replies came from Ollama, user messages have no engine",
    );
    assert.deepEqual(env.db.prepare("SELECT engine FROM benchmarks").all().map(plain), [{ engine: "ollama" }]);
    assert.deepEqual(env.db.prepare("SELECT count(*) AS n FROM engines").get().n, 0, "the built-in Ollama needs no row");
  });

  it("lists the chats with their engine, settings and branch", async () => {
    const { chats } = (await env.api.json("/api/chats")).data;
    assert.deepEqual(
      chats.map((c) => [c.id, c.title, c.engine, c.model, c.settings, c.branch_of]),
      [
        [2, "Branch · Trip to Rome", "ollama", "qwen2.5:7b", {}, 1],
        [1, "Trip to Rome", "ollama", "llama3.2:3b", { system: "Be brief.", think: "low" }, null],
      ],
    );
    const { engines } = (await env.api.json("/api/engines")).data;
    assert.equal(engines.length, 1);
    assert.equal(engines[0].id, "ollama");
  });

  it("shows the branch on screen with its versions, reasoning, stats and files", async () => {
    const { chat, messages } = (await env.api.json("/api/chats/1")).data;
    assert.equal(chat.engine, "ollama");
    assert.deepEqual(
      messages.map((m) => [m.id, m.role, m.content, m.versions]),
      [
        [4, "user", "Plan a trip to Rome in May", { ids: [1, 4], index: 1 }],
        [5, "assistant", "May is warm: mornings for ruins, evenings for food.", undefined],
      ],
    );
    assert.equal(messages[1].stats.tokens, 11);

    // The other version of the first message, with its two replies and the files.
    const other = await env.api.json("/api/chats/1/select", { method: "POST", body: { messageId: 1 } });
    assert.deepEqual(
      other.data.messages.map((m) => [m.id, m.role, m.versions]),
      [
        [1, "user", { ids: [1, 4], index: 0 }],
        [3, "assistant", { ids: [2, 3], index: 1 }],
      ],
    );
    assert.deepEqual(
      other.data.messages[0].attachments,
      [
        { id: 1, name: "notes.txt", type: "text/plain", kind: "text", size: 9 },
        { id: 2, name: "dot.png", type: "image/png", kind: "image", size: PNG.length },
      ],
    );
    const first = await env.api.json("/api/chats/1/select", { method: "POST", body: { messageId: 2 } });
    assert.equal(first.data.messages[1].thinking, "The user wants a short plan.");
    assert.equal(first.data.messages[1].stats.tokens, 9);

    const copied = (await env.api.json("/api/chats/2")).data.messages;
    assert.deepEqual(
      copied.map((m) => [m.id, m.copied ?? false]),
      [
        [6, true],
        [7, true],
        [8, false],
        [9, false],
      ],
    );
  });

  it("returns the attachments as they were", async () => {
    const text = await env.api.get("/api/attachments/1");
    assert.equal(await text.text(), "Milk\nEggs");
    const image = await env.api.get("/api/attachments/4");
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.ok(Buffer.from(await image.arrayBuffer()).equals(PNG));
  });

  it("finds the old messages, settings, usage and benchmarks", async () => {
    const { hits } = (await env.api.json("/api/search?q=zebrafish")).data;
    assert.deepEqual(
      hits.map((h) => [h.chatId, h.messageId, h.role]),
      [[1, 3, "assistant"]],
      "a version that isn't on screen is still found",
    );
    assert.equal((await env.api.json("/api/search?q=ostia")).data.hits[0].chatId, 2);
    assert.deepEqual((await env.api.json("/api/settings")).data, { defaults: { temperature: 0.4 }, keepAlive: 60 });
    const usage = (await env.api.json("/api/usage")).data;
    assert.deepEqual([usage.totals.chats, usage.totals.sent, usage.totals.replies], [2, 3, 4]);
    assert.deepEqual(
      usage.models.map((m) => [m.engine, m.model, m.replies]),
      [
        ["ollama", "llama3.2:3b", 3],
        ["ollama", "qwen2.5:7b", 1],
      ],
    );
    const { results } = (await env.api.json("/api/benchmark")).data;
    assert.deepEqual(results.map((r) => [r.id, r.engine, r.model, r.cold, r.tokensPerSecond]), [[1, "ollama", "llama3.2:3b", true, 42.5]]);
  });

  it("continues an old chat with the built-in Ollama, as before", async () => {
    await env.api.json("/api/chats/1/select", { method: "POST", body: { messageId: 5 } }); // back to the branch on screen
    const res = await env.api.post("/api/chat", { chatId: 1, content: "And in June?", model: "fake:latest" });
    assert.equal(res.status, 200);
    await res.text();
    const sent = env.ollama.lastChat().body.messages.map((m) => m.content);
    assert.deepEqual(sent, ["Be brief.", "Plan a trip to Rome in May", "May is warm: mornings for ruins, evenings for food.", "And in June?"]);
    const tail = env.db.prepare("SELECT role, engine, model FROM messages ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual(plain(tail), { role: "assistant", engine: "ollama", model: "fake:latest" });
  });
});
