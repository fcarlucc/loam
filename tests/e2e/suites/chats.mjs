// The sidebar's view of chats: listing, renaming, deleting for good, searching.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, it } from "node:test";
import { chat } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const THINKER = "thinker:latest";
const MARK_START = "\u0002";
const MARK_END = "\u0003";

export function chatsSuite(env) {
  const search = async (q) => env.api.json(`/api/search?q=${encodeURIComponent(q)}`);

  describe("chat history", () => {
    it("lists chats newest first, with their settings", async () => {
      const first = await chat(env.api, { chatId: null, content: "First chat", model: MODEL });
      const second = await chat(env.api, { chatId: null, content: "Second chat", model: MODEL, settings: { temperature: 1 } });
      const { status, data } = await env.api.json("/api/chats");
      assert.equal(status, 200);
      const ids = data.chats.map((c) => c.id);
      assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "the newest chat comes first");
      const row = data.chats.find((c) => c.id === second.id);
      assert.equal(row.title, "Second chat");
      assert.equal(row.model, MODEL);
      assert.deepEqual(row.settings, { temperature: 1 });
      assert.ok(row.created_at <= row.updated_at);

      // Activity moves a chat back to the top.
      await chat(env.api, { chatId: first.id, content: "again", model: MODEL });
      const after = (await env.api.json("/api/chats")).data.chats.map((c) => c.id);
      assert.ok(after.indexOf(first.id) < after.indexOf(second.id));
      for (const id of [first.id, second.id]) await env.api.delete(`/api/chats/${id}`);
    });

    it("renames a chat and changes its settings, validating both", async () => {
      const { id } = await chat(env.api, { chatId: null, content: "Rename me", model: MODEL });
      const url = `/api/chats/${id}`;
      let res = await env.api.json(url, { method: "PATCH", body: { title: "  Budget plan  " } });
      assert.equal(res.status, 200);
      assert.equal(res.data.chat.title, "Budget plan");

      res = await env.api.json(url, { method: "PATCH", body: { title: "x".repeat(200) } });
      assert.equal(Array.from(res.data.chat.title).length, 120, "titles are cut to 120 characters");

      for (const [name, body, status] of [
        ["empty title", { title: "   " }, 400],
        ["title not a string", { title: 5 }, 400],
        ["nothing to update", {}, 400],
        ["bad settings", { settings: { contextLength: 100 } }, 400],
        ["settings not an object", { settings: "x" }, 400],
      ]) {
        res = await env.api.json(url, { method: "PATCH", body });
        assert.equal(res.status, status, `${name}: got ${res.status}`);
      }

      res = await env.api.json(url, { method: "PATCH", body: { title: "Both", settings: { system: " Keep it short ", temperature: 0.123 } } });
      assert.equal(res.status, 200);
      assert.equal(res.data.chat.title, "Both");
      assert.deepEqual(res.data.chat.settings, { system: "Keep it short", temperature: 0.12 });
      assert.deepEqual((await env.api.json(url)).data.chat.settings, { system: "Keep it short", temperature: 0.12 });

      assert.equal((await env.api.json("/api/chats/999999999", { method: "PATCH", body: { title: "x" } })).status, 404);
      assert.equal((await env.api.json("/api/chats/abc", { method: "PATCH", body: { title: "x" } })).status, 404);
      assert.equal((await env.api.json("/api/chats/abc")).status, 404);
      await env.api.delete(url);
    });

    it("deletes a chat for good: rows, search index and database files", async () => {
      const token = "zebrafish7f3a9c"; // a word that appears nowhere else
      const { id, text } = await chat(env.api, { chatId: null, content: `Remember the word ${token}.`, model: MODEL });
      assert.ok(text.includes(token));
      assert.ok((await search(token)).data.hits.length >= 1, "the word is searchable before deleting");

      const del = await env.api.json(`/api/chats/${id}`, { method: "DELETE" });
      assert.equal(del.status, 200);
      assert.deepEqual(del.data, { ok: true });
      assert.equal((await env.api.json(`/api/chats/${id}`)).status, 404);
      assert.equal((await env.api.json(`/api/chats/${id}`, { method: "DELETE" })).status, 404);
      assert.equal(env.db.raw.prepare("SELECT count(*) AS n FROM messages WHERE chat_id = ?").get(id).n, 0);
      assert.deepEqual((await search(token)).data.hits, []);
      for (const file of [env.app.dbPath, `${env.app.dbPath}-wal`]) {
        if (!existsSync(file)) continue;
        assert.ok(!readFileSync(file).includes(token), `${basename(file)} still contains the deleted text`);
      }
    });

    it("finds words in any chat, ignoring accents, and titles when no message matches", async () => {
      const a = await chat(env.api, { chatId: null, content: "Il caffè è pronto", model: MODEL });
      const b = await chat(env.api, { chatId: null, content: "Nothing to see here", model: MODEL });
      await env.api.patch(`/api/chats/${b.id}`, { title: "Quarterly budget review" });

      let hits = (await search("caffe")).data.hits; // no accent in the query
      assert.ok(hits.some((h) => h.chatId === a.id && h.role === "user"), "cafe finds caffè");
      const hit = hits.find((h) => h.chatId === a.id && h.role === "user");
      assert.equal(hit.title, "Il caffè è pronto");
      assert.ok(hit.snippet.includes(`${MARK_START}caffè${MARK_END}`), `snippet marks the match: ${JSON.stringify(hit.snippet)}`);

      hits = (await search("pron")).data.hits;
      assert.ok(hits.some((h) => h.chatId === a.id), "the last word may be partial");

      hits = (await search("Quarterly budget")).data.hits;
      assert.deepEqual(
        hits.filter((h) => h.chatId === b.id),
        [{ chatId: b.id, title: "Quarterly budget review", messageId: null, role: null, snippet: null }],
        "a title match with no matching message",
      );

      assert.deepEqual((await search("zzzzqqqq")).data.hits, []);
      assert.deepEqual((await search("")).data.hits, []);
      assert.equal((await search("x".repeat(201))).status, 400);
      for (const q of ['"caffè" OR (x)', "NEAR(a b)", "a*b", "col:x", "\\"]) {
        const res = await search(q);
        assert.equal(res.status, 200, `query ${JSON.stringify(q)} broke the search`);
        assert.ok(Array.isArray(res.data.hits));
      }
      for (const id of [a.id, b.id]) await env.api.delete(`/api/chats/${id}`);
    });
  });
  describe("chat titles", () => {
    const name = (id) => env.api.json(`/api/chats/${id}/title`, { method: "POST" });
    const chatRequests = (from) => env.ollama.since(from).filter((r) => r.path === "/api/chat");

    it("the model names the chat after its first reply, with no reasoning and no system prompt", async () => {
      const content = 'Budget? <<say: **"Title: Budget plan."**>>';
      const r = await chat(env.api, { chatId: null, content, model: THINKER, settings: { system: "You are a pirate.", think: "low" } });
      assert.equal(env.db.chat(r.id).title, content, "the first message is the title until the model names the chat");

      const seen = env.ollama.requests.length;
      const res = await name(r.id);
      assert.equal(res.status, 200);
      assert.equal(res.data.named, true);
      assert.equal(res.data.chat.title, "Budget plan", "markdown, a 'Title:' prefix, quotes and the final period are dropped");
      assert.equal(env.db.chat(r.id).title, "Budget plan");

      const [req, ...more] = chatRequests(seen);
      assert.equal(more.length, 0, "one request to Ollama");
      assert.equal(req.body.model, THINKER);
      assert.equal(req.body.stream, false);
      assert.equal(req.body.think, false, "no reasoning for a title");
      assert.deepEqual(req.body.options, { num_predict: 32, temperature: 0 });
      assert.equal(req.body.messages.length, 1, "the exchange is quoted in one user message");
      assert.equal(req.body.messages[0].role, "user");
      assert.match(req.body.messages[0].content, /User: Budget\?/);
      assert.match(req.body.messages[0].content, /Assistant: \*\*"Title: Budget plan\."\*\*/);
      assert.ok(!req.body.messages[0].content.includes("pirate"), "the chat's system prompt stays out of it");

      // Asked again, the chat keeps the title it has.
      assert.equal((await name(r.id)).data.named, false);
      assert.equal(chatRequests(seen).length, 1);
      assert.equal((await name(999999999)).status, 404);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("a chat the user renamed is left alone", async () => {
      const r = await chat(env.api, { chatId: null, content: "Hello <<say: Greetings>>", model: MODEL });
      await env.api.patch(`/api/chats/${r.id}`, { title: "Mine" });
      const seen = env.ollama.requests.length;
      const res = await name(r.id);
      assert.deepEqual([res.status, res.data.named, res.data.chat.title], [200, false, "Mine"]);
      assert.equal(env.ollama.since(seen).length, 0, "Ollama isn't asked");
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("no naming when models unload right after each reply; otherwise the keep-alive goes along", async () => {
      const content = "Hi <<say: Small talk>>";
      const r = await chat(env.api, { chatId: null, content, model: MODEL });
      await env.api.put("/api/settings", { keepAlive: 0 });
      let seen = env.ollama.requests.length;
      let res = await name(r.id);
      assert.deepEqual([res.data.named, res.data.chat.title], [false, content]);
      assert.equal(env.ollama.since(seen).length, 0, "the model would have to be loaded again");

      await env.api.put("/api/settings", { keepAlive: 60 });
      seen = env.ollama.requests.length;
      res = await name(r.id);
      assert.deepEqual([res.data.named, res.data.chat.title], [true, "Small talk"]);
      const [req] = chatRequests(seen);
      assert.equal(req.body.keep_alive, 60);
      assert.equal("think" in req.body, false, "a model that can't reason isn't told about it");
      await env.api.put("/api/settings", { keepAlive: 300 });
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("a long-winded title is cut short", async () => {
      const r = await chat(env.api, { chatId: null, content: `Long <<say: ${"word ".repeat(20)}>>`, model: MODEL });
      const { title } = (await name(r.id)).data.chat;
      assert.equal(Array.from(title).length, 60);
      assert.ok(title.startsWith("word word ") && title.endsWith("…"));
      await env.api.delete(`/api/chats/${r.id}`);
    });
  });
}
