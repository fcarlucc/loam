// Compacting a chat: the model summarizes the older messages, and from then on reads the summary instead.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitFor } from "../helpers/app.mjs";
import { CONTEXT_LENGTH } from "../helpers/fake-openai.mjs";
import { chat } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const HEADING = "Summary of the earlier part of this conversation.";

export function compactSuite(env) {
  const branch = async (id) => (await env.api.json(`/api/chats/${id}`)).data.messages;
  const compact = (id, body = {}, init = {}) =>
    env.api.json(`/api/chats/${id}/compact`, { method: "POST", body: { engine: "ollama", model: MODEL, ...body }, ...init });
  const undo = (id, messageId) => env.api.json(`/api/chats/${id}/compact`, { method: "DELETE", body: { messageId } });
  // The summarizing requests made since `from` (the only non-streamed chat requests besides titles, which these chats never ask for).
  const summarizing = (from) => env.ollama.since(from).filter((r) => r.path === "/api/chat" && r.body.stream === false);
  async function newChat(contents, { model = MODEL, engine } = {}) {
    let id = null;
    for (const content of contents) id = (await chat(env.api, { chatId: id, content, model, ...(engine ? { engine } : {}) })).id;
    return id;
  }

  describe("compact", () => {
    let c; // a chat compacted twice
    let first; // the message carrying the first summary

    it("summarizes everything before the latest exchange and keeps it on the last message it covers", async () => {
      c = await newChat(["one", "two", "three"]);
      const before = await branch(c);
      const from = env.ollama.requests.length;
      const r = await compact(c);
      assert.equal(r.status, 200);

      const requests = summarizing(from);
      assert.equal(requests.length, 1);
      const { body } = requests[0];
      assert.equal(body.model, MODEL);
      assert.equal(body.messages.length, 1);
      const prompt = body.messages[0].content;
      assert.match(prompt, /^Summarize the conversation below/);
      assert.ok(prompt.includes(`User: one\n\nAssistant: ${before[1].content}\n\nUser: two\n\nAssistant: ${before[3].content}`));
      assert.ok(!prompt.includes("User: three"), "the latest exchange stays as it is");
      assert.equal(body.options.temperature, 0.2);
      assert.equal(body.options.num_predict, 1024);
      assert.equal(body.options.num_ctx, undefined, "no context known: Ollama keeps its own");

      const path = r.data.messages;
      assert.deepEqual(path.map((m) => !!m.summary), [false, false, false, true, false, false]);
      first = path[3];
      assert.ok(first.summary.length > 0);
      assert.deepEqual(await branch(c), path, "kept");
    });

    it("the next reply reads the summary instead of the messages it covers", async () => {
      const before = await branch(c);
      await chat(env.api, { chatId: c, content: "four", model: MODEL, settings: { system: "Be brief" } });
      const sent = env.ollama.lastChat().body.messages;
      assert.equal(sent[0].role, "system");
      assert.ok(sent[0].content.startsWith("Be brief\n\n" + HEADING), "the chat's own instructions first, then the summary");
      assert.ok(sent[0].content.endsWith(first.summary));
      assert.deepEqual(
        sent.slice(1).map((m) => m.content),
        ["three", before[5].content, "four"],
      );
    });

    it("compacting again folds the previous summary into the new one", async () => {
      const from = env.ollama.requests.length;
      const r = await compact(c);
      assert.equal(r.status, 200);
      const [{ body }] = summarizing(from);
      const prompt = body.messages[0].content;
      assert.ok(prompt.includes(`Summary of what came before:\n${first.summary}`));
      // The fake's "summary" repeats the prompt it got, so only the conversation part is looked at.
      const piece = prompt.slice(prompt.lastIndexOf("Conversation:\n"));
      assert.ok(piece.includes("User: three") && !piece.includes("User: one") && !piece.includes("User: four"));
      const path = r.data.messages;
      assert.deepEqual(path.map((m) => !!m.summary), [false, false, false, true, false, true, false, false]);

      await chat(env.api, { chatId: c, content: "five", model: MODEL });
      const sent = env.ollama.lastChat().body.messages;
      assert.ok(sent[0].content.endsWith(path[5].summary), "the latest summary");
      assert.deepEqual(sent.slice(1).map((m) => m.content).filter((t) => !t.startsWith("Echo")), ["four", "five"]);
    });

    it("undo brings the messages back to the model", async () => {
      const path = await branch(c);
      const r = await undo(c, path[5].id);
      assert.equal(r.status, 200);
      assert.equal(r.data.messages[5].summary, undefined);
      await chat(env.api, { chatId: c, content: "six", model: MODEL });
      const sent = env.ollama.lastChat().body.messages;
      assert.ok(sent[0].content.endsWith(first.summary), "the earlier summary applies again");
      assert.deepEqual(sent.slice(1).filter((m) => m.role === "user").map((m) => m.content), ["three", "four", "five", "six"]);
    });

    it("only the branches through the summarized message use it, and a branched chat keeps it", async () => {
      const path = await branch(c);
      // An edit before the summary starts a branch that never went through it.
      await chat(env.api, { chatId: c, content: "two, edited", editOf: path[2].id, model: MODEL, settings: {} });
      const sent = env.ollama.lastChat().body.messages;
      assert.ok(sent.every((m) => m.role !== "system"));
      assert.deepEqual(sent.map((m) => m.content), ["one", path[1].content, "two, edited"]);

      await env.api.json(`/api/chats/${c}/select`, { method: "POST", body: { messageId: path.at(-1).id } });
      const copy = (await env.api.json(`/api/chats/${c}/branch`, { method: "POST", body: { messageId: path.at(-1).id } })).data.chat;
      const copied = await branch(copy.id);
      assert.equal(copied[3].summary, first.summary);
      await chat(env.api, { chatId: copy.id, content: "seven", model: MODEL });
      assert.ok(env.ollama.lastChat().body.messages[0].content.endsWith(first.summary));
    });

    it("a long conversation is summarized a piece at a time, each with the summary so far", async () => {
      const long = (tag) => `${tag} ${"lorem ipsum ".repeat(200)}`; // about 2,400 characters
      const id = await newChat([long("alpha"), long("beta"), long("gamma"), "last"]);
      const from = env.ollama.requests.length;
      const r = await compact(id, { contextSize: 1024 });
      assert.equal(r.status, 200);
      const prompts = summarizing(from).map((q) => q.body.messages[0].content);
      assert.ok(prompts.length >= 3, `${prompts.length} requests`);
      assert.ok(!prompts[0].includes("Summary of what came before"));
      assert.ok(prompts.slice(1).every((p) => p.includes("Summary of what came before")));
      // The fake model ignores the length limit, so only the pieces of conversation are measured.
      assert.ok(prompts.every((p) => p.slice(p.lastIndexOf("Conversation:\n")).length <= 2100), "every piece fits the small context");
      assert.ok(prompts.some((p) => p.includes("[… cut …]")), "a message longer than a piece keeps its start and end");
      assert.equal(summarizing(from)[0].body.options.num_predict, 256, "a quarter of the context at most");
      assert.ok(summarizing(from).every((q) => q.body.options.num_ctx === 1024), "the model reads the context the pieces were cut for");
    });

    it("a chat of one exchange is summarized whole, and then there is nothing left to compact", async () => {
      const id = await newChat(["only"]);
      const r = await compact(id);
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.messages.map((m) => !!m.summary), [false, true]);
      const again = await compact(id);
      assert.deepEqual([again.status, again.data.error], [400, "Nothing to compact yet"]);
      // A message that got no reply is never folded away.
      const failed = await chat(env.api, { chatId: id, content: "x", model: "flaky:latest" });
      assert.equal(failed.status, 200);
      assert.equal((await compact(id)).status, 400);
    });

    it("a failed summary changes nothing", async () => {
      const id = await newChat(["a", "b"]);
      const before = await branch(id);
      const r = await compact(id, { model: "missing:1b" });
      assert.equal(r.status, 502);
      assert.deepEqual(await branch(id), before);
    });

    it("a piece summarized into nothing fails the whole compaction", async () => {
      const id = await newChat(["a", "b"]);
      assert.equal((await compact(id)).status, 200);
      await chat(env.api, { chatId: id, content: "c", model: MODEL });
      const before = await branch(id);
      // Keeping the earlier summary would silently leave "b" out of the model's view.
      const r = await compact(id, { model: "mute:latest" });
      assert.deepEqual([r.status, r.data.error], [502, "The model wrote no summary"]);
      assert.deepEqual(await branch(id), before);
    });

    it("asks for the least reasoning the model offers", async () => {
      const id = await newChat(["a", "b"]);
      let from = env.ollama.requests.length;
      assert.equal((await compact(id, { model: "thinker:latest" })).status, 200);
      assert.equal(summarizing(from)[0].body.think, false);
      await chat(env.api, { chatId: id, content: "c", model: MODEL });
      // A model that only reasons at a level (gpt-oss) refuses think: false, so it gets its lowest level.
      from = env.ollama.requests.length;
      const r = await compact(id, { model: "leveled:latest" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(summarizing(from)[0].body.think, "low");
    });

    it("cancelling stops the model and keeps nothing; one compaction at a time", async () => {
      const id = await newChat(["a", "b"]);
      const before = await branch(id);
      const from = env.ollama.requests.length;
      const controller = new AbortController();
      // The fake "loads" this model for 2.5 s before answering.
      const pending = compact(id, { model: "loading:latest" }, { signal: controller.signal }).catch((e) => e);
      await waitFor(() => summarizing(from).length === 1, { what: "the summarizing request" });
      const second = await compact(id);
      assert.deepEqual([second.status, second.data.error], [409, "This chat is already being compacted"]);
      controller.abort();
      assert.equal((await pending).name, "AbortError");
      await waitFor(() => summarizing(from)[0].aborted, { what: "the engine to see the cancel" });
      assert.deepEqual(await branch(id), before, "no summary written");
      await waitFor(async () => (await compact(id)).status === 200, { what: "a compaction once the cancelled one is over" });
    });

    it("waits for a reply that is still streaming", async () => {
      const id = await newChat(["a"]);
      const controller = new AbortController();
      const res = await env.api.post("/api/chat", { chatId: id, content: "count", model: "slow:latest" }, { signal: controller.signal });
      assert.equal(res.status, 200);
      const r = await compact(id);
      assert.deepEqual([r.status, r.data.error], [409, "Wait for the reply to finish"]);
      controller.abort();
      await waitFor(async () => (await compact(id)).status !== 409, { what: "the reply to stop" });
    });

    it("works through an OpenAI-compatible server, in pieces cut for its default context", async () => {
      const long = (tag) => `${tag} ${"lorem ipsum ".repeat(200)}`;
      const engine = env.openaiEngine;
      const id = await newChat([long("alpha"), long("beta"), "last"], { model: "fake-7b", engine });
      // The server decides its context: a context length set for Ollama in this chat doesn't apply.
      await env.api.json(`/api/chats/${id}`, { method: "PATCH", body: { settings: { contextLength: 131072 } } });
      const from = env.openai.requests.length;
      const r = await env.api.json(`/api/chats/${id}/compact`, { method: "POST", body: { engine, model: "fake-7b" } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const requests = env.openai.since(from).filter((q) => q.path === "/v1/chat/completions");
      assert.ok(requests.length >= 2, `${requests.length} requests: the pieces fit ${CONTEXT_LENGTH} tokens, not 131072`);
      assert.ok(requests.every((q) => q.body.stream !== true && q.body.max_tokens === 1024));
      assert.ok(requests.every((q) => q.body.messages[0].content.slice(q.body.messages[0].content.lastIndexOf("Conversation:\n")).length <= 5000));
      assert.deepEqual(r.data.messages.map((m) => !!m.summary), [false, false, false, true, false, false]);

      await chat(env.api, { chatId: id, content: "next", model: "fake-7b", engine });
      const sent = env.openai.lastChat().body.messages;
      assert.equal(sent[0].role, "system");
      assert.ok(sent[0].content.startsWith(HEADING));
      assert.deepEqual(sent.slice(1).filter((m) => m.role === "user").map((m) => m.content), ["last", "next"]);
    });

    it("refuses what it can't do", async () => {
      const id = await newChat(["a", "b"]);
      const cases = [
        [`/api/chats/999999999/compact`, { model: MODEL }, 404],
        [`/api/chats/${id}/compact`, { model: "" }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, contextSize: 100 }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, contextSize: "big" }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, engine: "nope" }, 404],
      ];
      for (const [path, body, status] of cases) {
        const r = await env.api.json(path, { method: "POST", body });
        assert.equal(r.status, status, `${path} ${JSON.stringify(body)}`);
      }
      assert.equal((await undo(id, 999999999)).status, 404);
      assert.equal((await undo(id, "x")).status, 404);
      const other = await newChat(["elsewhere"]);
      const [, reply] = await branch(other);
      assert.equal((await undo(id, reply.id)).status, 404, "a message of another chat");
      const denied = await env.api.json(`/api/chats/${id}/compact`, { method: "POST", body: { model: MODEL }, origin: "http://evil.example" });
      assert.equal(denied.status, 403);
    });

    it("automatic compacting is a chat setting", async () => {
      const id = await newChat(["a"]);
      const on = await env.api.json(`/api/chats/${id}`, { method: "PATCH", body: { settings: { autoCompact: true } } });
      assert.deepEqual(on.data.chat.settings, { autoCompact: true });
      const off = await env.api.json(`/api/chats/${id}`, { method: "PATCH", body: { settings: { autoCompact: false } } });
      assert.deepEqual(off.data.chat.settings, {});
      const bad = await env.api.json(`/api/chats/${id}`, { method: "PATCH", body: { settings: { autoCompact: "yes" } } });
      assert.equal(bad.status, 400);
    });
  });
}
