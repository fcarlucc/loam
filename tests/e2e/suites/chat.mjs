// Sending, editing, regenerating, stopping: what is streamed, what is saved, what reaches the model.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sleep, waitFor } from "../helpers/app.mjs";
import { echo, FLAKY_ERROR } from "../helpers/fake-ollama.mjs";
import { chat, readEvents } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const OLLAMA_DOWN = "Cannot reach Ollama. Is it running?";

export function chatSuite(env) {
  // The branch shown for a chat, as the page gets it.
  const branch = async (id) => (await env.api.json(`/api/chats/${id}`)).data.messages;
  const select = (id, messageId) => env.api.json(`/api/chats/${id}/select`, { method: "POST", body: { messageId } });

  // Structural invariants of a chat's message tree.
  function checkTree(id, label) {
    const rows = env.db.messages(id);
    const ids = new Set(rows.map((m) => m.id));
    const leaf = env.db.chat(id).leaf_id;
    assert.ok(rows.every((m) => m.parent_id === null || ids.has(m.parent_id)), `${label}: a parent belongs to another chat`);
    assert.ok(leaf === null || ids.has(leaf), `${label}: the leaf belongs to another chat`);
  }

  describe("chat", () => {
    it("a new chat streams the reply and is saved once Ollama accepts", async () => {
      const before = env.db.counts();
      const content = "Reply with exactly: one";
      const r = await chat(env.api, { chatId: null, content, model: MODEL });
      assert.equal(r.status, 200);
      assert.ok(Number.isSafeInteger(r.id) && r.id > 0, "X-Chat-Id header");
      assert.equal(r.text, echo([{ role: "user", content }]));
      assert.ok(r.types.includes("delta"));
      assert.equal(r.types.at(-1), "done");
      assert.ok(r.stats.tokens > 0);
      assert.equal(r.stats.tokensPerSecond, 50);
      assert.equal(r.stats.loadMs, 50);
      assert.equal(r.stats.contextSize, 8192, "context size comes from what Ollama has loaded");
      assert.equal(r.stats.contextUsed, r.stats.promptTokens + r.stats.tokens);

      const msgs = env.db.messages(r.id);
      assert.deepEqual(
        msgs.map((m) => [m.role, m.content, m.model]),
        [
          ["user", content, null],
          ["assistant", r.text, MODEL],
        ],
      );
      assert.equal(msgs[0].parent_id, null);
      assert.equal(msgs[1].parent_id, msgs[0].id);
      assert.deepEqual(JSON.parse(msgs[1].stats), r.stats);
      const row = env.db.chat(r.id);
      assert.equal(row.title, content, "title taken from the first message");
      assert.equal(row.model, MODEL);
      assert.equal(row.leaf_id, msgs[1].id);
      assert.deepEqual(env.db.counts(), { chats: before.chats + 1, messages: before.messages + 2 });

      // Only what the user wrote reached the model, with no stray options.
      assert.deepEqual(env.ollama.lastChat().body, { model: MODEL, messages: [{ role: "user", content }], stream: true });
    });

    it("a long first message becomes a short title", async () => {
      const content = `${"word ".repeat(20)}\n\n  tail`;
      const r = await chat(env.api, { chatId: null, content, model: MODEL });
      const title = env.db.chat(r.id).title;
      assert.equal(Array.from(title).length, 48);
      assert.ok(title.endsWith("…"));
      assert.ok(!/\s\s/.test(title), "whitespace is collapsed");
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("per-chat settings reach Ollama and are saved with the chat", async () => {
      await env.api.put("/api/settings", { keepAlive: 60 });
      const settings = { system: "Be brief.", temperature: 0.3, contextLength: 4096 };
      const r = await chat(env.api, { chatId: null, content: "hi", model: MODEL, settings });
      assert.equal(r.status, 200);
      assert.deepEqual(env.ollama.lastChat().body, {
        model: MODEL,
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "hi" },
        ],
        stream: true,
        options: { temperature: 0.3, num_ctx: 4096 },
        keep_alive: 60,
      });
      assert.ok(r.text.endsWith(":: system=Be brief."));
      assert.deepEqual((await env.api.json(`/api/chats/${r.id}`)).data.chat.settings, settings);

      // A message without settings falls back to the ones saved with the chat.
      await chat(env.api, { chatId: r.id, content: "again", model: MODEL });
      assert.deepEqual(env.ollama.lastChat().body.options, { temperature: 0.3, num_ctx: 4096 });
      assert.equal(env.ollama.lastChat().body.messages[0].role, "system");

      // Ollama's default keep-alive isn't sent at all.
      await env.api.put("/api/settings", { keepAlive: 300 });
      await chat(env.api, { chatId: r.id, content: "third", model: MODEL });
      assert.equal(env.ollama.lastChat().body.keep_alive, undefined);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("when Ollama rejects the model, nothing is written", async () => {
      const before = env.db.counts();
      const r = await chat(env.api, { chatId: null, content: "hello", model: "missing:1b" });
      assert.equal(r.status, 502);
      assert.equal(r.error, "model 'missing:1b' not found");
      assert.deepEqual(env.db.counts(), before);
    });

    it("when Ollama is off, the app says so and writes nothing", async () => {
      await env.ollama.pause();
      try {
        const before = env.db.counts();
        const r = await chat(env.api, { chatId: null, content: "hello", model: MODEL });
        assert.equal(r.status, 502);
        assert.equal(r.error, OLLAMA_DOWN);
        assert.deepEqual(env.db.counts(), before);
      } finally {
        await env.ollama.resume();
      }
    });

    it("rejects malformed requests", async () => {
      const existing = (await chat(env.api, { chatId: null, content: "base", model: MODEL })).id;
      const cases = {
        "no model": [{ chatId: null, content: "x" }, 400],
        "bad model name": [{ chatId: null, content: "x", model: "bad name!" }, 400],
        "empty content": [{ chatId: null, content: "   ", model: MODEL }, 400],
        "content not a string": [{ chatId: null, content: 5, model: MODEL }, 400],
        "chatId not a number": [{ chatId: "1", content: "x", model: MODEL }, 400],
        "unknown chat": [{ chatId: 999_999_999, content: "x", model: MODEL }, 404],
        "regenerate in a new chat": [{ chatId: null, regenerate: 1, model: MODEL }, 400],
        "retry in a new chat": [{ chatId: null, retry: true, model: MODEL }, 400],
        "edit in a new chat": [{ chatId: null, content: "x", editOf: 1, model: MODEL }, 400],
        "edit without content": [{ chatId: existing, editOf: 1, model: MODEL }, 400],
        "no mode": [{ chatId: existing, model: MODEL }, 400],
        "two modes": [{ chatId: existing, content: "x", retry: true, model: MODEL }, 400],
        "bad settings": [{ chatId: null, content: "x", model: MODEL, settings: { temperature: 5 } }, 400],
        "settings not an object": [{ chatId: null, content: "x", model: MODEL, settings: [1] }, 400],
        "system prompt too long": [{ chatId: null, content: "x", model: MODEL, settings: { system: "a".repeat(8001) } }, 400],
      };
      for (const [name, [body, status]] of Object.entries(cases)) {
        const res = await env.api.post("/api/chat", body);
        assert.equal(res.status, status, `${name}: got ${res.status}`);
      }
      const notJson = await env.api.request("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: undefined });
      assert.equal(notJson.status, 400);
      await env.api.delete(`/api/chats/${existing}`);
    });

    let c; // the chat used by the branching tests
    let u1; // its first user message

    it("editing a message starts a new version and a separate branch", async () => {
      const a = await chat(env.api, { chatId: null, content: "My name is Alice.", model: MODEL });
      c = a.id;
      [u1] = await branch(c);
      const edit = await chat(env.api, { chatId: c, content: "My name is Bob.", editOf: u1.id, model: MODEL });
      assert.equal(edit.status, 200);
      assert.equal(edit.text, echo([{ role: "user", content: "My name is Bob." }]), "only the edited message reached the model");
      const path = await branch(c);
      assert.equal(path.length, 2);
      assert.equal(path[0].content, "My name is Bob.");
      assert.deepEqual(path[0].versions, { ids: [u1.id, path[0].id], index: 1 });
      assert.equal(path[1].versions, undefined);
      assert.equal(env.db.chat(c).title, "My name is Alice.", "an edit doesn't rename the chat");

      const ask = await chat(env.api, { chatId: c, content: "What is my name?", model: MODEL });
      assert.equal(ask.text, "Echo: What is my name? :: users=My name is Bob. | What is my name?", "Alice's branch never reaches the model");
      checkTree(c, "after the edit");
    });

    it("switching versions shows the other branch, without counting as activity", async () => {
      const updatedBefore = env.db.chat(c).updated_at;
      const sel = await select(c, u1.id);
      assert.equal(sel.status, 200);
      const path = sel.data.messages;
      assert.equal(path.length, 2);
      assert.equal(path[0].content, "My name is Alice.");
      assert.equal(path[0].versions.index, 0);
      assert.equal(env.db.chat(c).updated_at, updatedBefore);
      assert.deepEqual(await branch(c), path, "the selection is remembered");

      const ask = await chat(env.api, { chatId: c, content: "What is my name?", model: MODEL });
      assert.equal(ask.text, "Echo: What is my name? :: users=My name is Alice. | What is my name?");
      assert.equal((await branch(c)).length, 4);
    });

    it("regenerating keeps the previous reply as a version, each with its own stats", async () => {
      const before = await branch(c);
      const last = before.at(-1);
      const r = await chat(env.api, { chatId: c, regenerate: last.id, model: MODEL });
      assert.equal(r.status, 200);
      const sent = env.ollama.lastChat().body.messages;
      assert.equal(sent.length, before.length - 1, "the branch up to the user message, nothing after");
      assert.equal(sent.at(-1).role, "user");

      const path = await branch(c);
      const tail = path.at(-1);
      assert.notEqual(tail.id, last.id);
      assert.deepEqual(tail.versions, { ids: [last.id, tail.id], index: 1 });
      assert.equal(tail.content, r.text);
      assert.deepEqual(tail.stats, r.stats);
      assert.ok(last.stats, "the old reply keeps its stats");

      const back = await select(c, last.id);
      assert.equal(back.data.messages.at(-1).id, last.id);
      assert.equal(back.data.messages.at(-1).versions.index, 0);
      await select(c, tail.id);
      checkTree(c, "after regenerating");
    });

    it("a failed regenerate or edit changes nothing", async () => {
      const path = await branch(c);
      const rows = env.db.messages(c).length;
      const leaf = env.db.chat(c).leaf_id;
      const badRegenerate = await chat(env.api, { chatId: c, regenerate: path.at(-1).id, model: "missing:1b" });
      const badEdit = await chat(env.api, { chatId: c, content: "x", editOf: path[0].id, model: "missing:1b" });
      assert.equal(badRegenerate.status, 502);
      assert.equal(badEdit.status, 502);
      assert.equal(env.db.messages(c).length, rows);
      assert.equal(env.db.chat(c).leaf_id, leaf);
      assert.deepEqual(await branch(c), path);
    });

    it("ids must belong to this chat and have the right role", async () => {
      const other = await chat(env.api, { chatId: null, content: "Reply with exactly: two", model: MODEL });
      const otherIds = (await branch(other.id)).map((m) => m.id);
      const path = await branch(c);
      const userId = path.find((m) => m.role === "user").id;
      const replyId = path.find((m) => m.role === "assistant").id;
      const cases = {
        "edit a reply": { chatId: c, content: "x", editOf: replyId },
        "regenerate a user message": { chatId: c, regenerate: userId },
        "edit a message of another chat": { chatId: c, content: "x", editOf: otherIds[0] },
        "regenerate a reply of another chat": { chatId: c, regenerate: otherIds[1] },
        "retry when the branch ends with a reply": { chatId: c, retry: true },
        "regenerate with a string id": { chatId: c, regenerate: "1" },
      };
      for (const [name, body] of Object.entries(cases)) {
        const res = await env.api.post("/api/chat", { model: MODEL, ...body });
        assert.equal(res.status, 400, `${name}: got ${res.status}`);
      }
      assert.equal((await select(c, otherIds[0])).status, 404);
      assert.equal((await select(c, "x")).status, 404);
      assert.equal((await select(999_999_999, userId)).status, 404);
      await env.api.delete(`/api/chats/${other.id}`);
    });

    it("stop ends the reply gracefully and keeps what was written", async () => {
      const res = await env.api.post("/api/chat", { chatId: c, content: "Write a long essay.", model: "slow:latest" });
      assert.equal(res.status, 200);
      const reading = readEvents(res);
      await sleep(800);
      const stop = await env.api.json("/api/chat/stop", { method: "POST", body: { chatId: c } });
      assert.deepEqual(stop.data, { stopped: true });
      const out = await reading;
      assert.equal(out.types.at(-1), "done", "the stream ends normally, not with an error");
      assert.equal(out.error, undefined);
      assert.ok(out.text.length > 0 && out.text.length < 300, `partial text: ${out.text.length} chars`);
      assert.equal(out.stats, undefined, "a stopped reply has no stats");

      const tail = (await branch(c)).at(-1);
      assert.equal(tail.role, "assistant");
      assert.ok(tail.id > 0);
      assert.equal(tail.content, out.text, "the partial reply is saved as it was shown");

      const sent = env.ollama.lastChat();
      await waitFor(() => sent.aborted, { what: "the app to cut the connection to Ollama" });
      const chunks = sent.chunks;
      await sleep(300);
      assert.equal(sent.chunks, chunks, "Ollama stopped generating");
      assert.deepEqual((await env.api.json("/api/chat/stop", { method: "POST", body: { chatId: c } })).data, { stopped: false });
    });

    it("when the page leaves mid-reply, the partial reply is kept and Ollama is stopped", async () => {
      const controller = new AbortController();
      const res = await env.api.post("/api/chat", { chatId: c, content: "Another long one.", model: "slow:latest" }, { signal: controller.signal });
      assert.equal(res.status, 200);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = "";
      const started = Date.now();
      while (Date.now() - started < 700) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
      controller.abort();
      assert.ok(received.includes('"delta"'), "some text had been streamed");
      const sent = env.ollama.lastChat();
      await waitFor(() => sent.aborted, { what: "the app to cut the connection to Ollama" });
      const tail = await waitFor(
        async () => {
          const t = (await branch(c)).at(-1);
          return t.role === "assistant" && t.content.startsWith("tick 1 ") ? t : null;
        },
        { what: "the partial reply to be saved" },
      );
      assert.ok(tail.content.length < 300, "only what was generated before leaving");
    });

    it("leaving while the model is still loading saves nothing", async () => {
      const before = env.db.counts();
      const controller = new AbortController();
      const pending = env.api.post("/api/chat", { chatId: null, content: "Must not be saved", model: "loading:latest" }, { signal: controller.signal }).catch((e) => e);
      await sleep(500);
      controller.abort();
      assert.ok((await pending) instanceof Error, "the request was aborted before Ollama answered");
      const sent = env.ollama.lastChat();
      await waitFor(() => sent.aborted, { what: "the app to cut the connection to Ollama" });
      await sleep(2600); // longer than the fake's load time: a server that kept going would have saved by now
      assert.deepEqual(env.db.counts(), before);
    });

    it("deleting a chat while its reply streams leaves nothing behind", async () => {
      const res = await env.api.post("/api/chat", { chatId: null, content: "Count slowly.", model: "slow:latest" });
      const id = Number(res.headers.get("X-Chat-Id"));
      await sleep(500);
      assert.equal((await env.api.delete(`/api/chats/${id}`)).status, 200);
      const out = await readEvents(res);
      assert.equal(out.types.at(-1), "done");
      assert.equal((await env.api.get(`/api/chats/${id}`)).status, 404);
      assert.equal(env.db.raw.prepare("SELECT count(*) AS n FROM messages WHERE chat_id = ?").get(id).n, 0);
    });

    it("retry answers a message that got no reply", async () => {
      const content = "Reply with exactly: retried";
      const r = await chat(env.api, { chatId: null, content, model: "flaky:latest" });
      assert.equal(r.status, 200);
      assert.equal(r.types.at(-1), "error");
      assert.equal(r.error, FLAKY_ERROR);
      assert.equal(r.text, "");
      let msgs = env.db.messages(r.id);
      assert.deepEqual(
        msgs.map((m) => m.role),
        ["user"],
        "the question is kept, no empty reply is saved",
      );
      assert.equal(env.db.chat(r.id).leaf_id, msgs[0].id);

      const again = await chat(env.api, { chatId: r.id, retry: true, model: MODEL });
      assert.equal(again.status, 200);
      assert.equal(again.text, echo([{ role: "user", content }]));
      msgs = env.db.messages(r.id);
      assert.equal(msgs.length, 2);
      assert.equal(msgs[1].parent_id, msgs[0].id);
      assert.equal(env.db.chat(r.id).model, MODEL, "the chat now uses the model that answered");
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("the branch on screen alternates user and assistant, and every parent belongs to the chat", async () => {
      const path = await branch(c);
      assert.ok(path.length >= 4);
      assert.ok(
        path.every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant")),
        path.map((m) => m.role[0]).join(""),
      );
      checkTree(c, "at the end");
    });
  });
}
