// Compacting a chat: the model summarizes the older messages, and from then on reads the summary instead.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitFor } from "../helpers/app.mjs";
import { chat, readEvents } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const HEADING = "Summary of the earlier part of this conversation.";

export function compactSuite(env) {
  const branch = async (id) => (await env.api.json(`/api/chats/${id}`)).data.messages;
  const compact = (id, body = {}) => env.api.json(`/api/chats/${id}/compact`, { method: "POST", body: { engine: "ollama", model: MODEL, ...body } });
  const undo = (id, messageId) => env.api.json(`/api/chats/${id}/compact`, { method: "DELETE", body: { messageId } });
  // The summarizing requests made since `from` (the only non-streamed chat requests besides titles, which these chats never ask for).
  const summarizing = (from) => env.ollama.since(from).filter((r) => r.path === "/api/chat" && r.body.stream === false);
  async function newChat(contents) {
    let id = null;
    for (const content of contents) id = (await chat(env.api, { chatId: id, content, model: MODEL })).id;
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

    it("a piece summarized to nothing fails the compaction, and nothing is kept", async () => {
      const id = await newChat(["a", "b", "c"]);
      const before = await branch(id);
      const r = await compact(id, { model: "terse:latest" });
      assert.deepEqual([r.status, r.data.error], [502, "The model wrote an empty summary: nothing was changed"]);
      assert.deepEqual(await branch(id), before);
    });

    it("cancelling a compaction stops the model and keeps nothing", async () => {
      const id = await newChat(["a", "b", "c"]);
      const from = env.ollama.requests.length;
      const controller = new AbortController();
      // The "loading" model takes 2.5 s before it answers: time enough to leave.
      const pending = env.api.post(`/api/chats/${id}/compact`, { engine: "ollama", model: "loading:latest" }, { signal: controller.signal });
      await waitFor(() => summarizing(from).length === 1, { what: "the summarizing request" });
      controller.abort();
      await assert.rejects(pending);
      const [request] = summarizing(from);
      await waitFor(() => request.aborted, { what: "the model to be stopped" });
      await new Promise((r) => setTimeout(r, 2800)); // past the moment the model would have answered
      assert.ok(env.db.raw.prepare("SELECT summary FROM messages WHERE chat_id = ?").all(id).every((m) => m.summary === null));
    });

    it("waits for a reply that is still streaming", async () => {
      const id = await newChat(["a"]);
      const res = await env.api.post("/api/chat", { chatId: id, content: "long", model: "slow:latest" });
      assert.equal(res.status, 200);
      const r = await compact(id);
      assert.deepEqual([r.status, r.data.error], [409, "Wait for the reply to finish"]);
      await env.api.post("/api/chat/stop", { chatId: id });
      await readEvents(res);
      assert.equal((await compact(id)).status, 200, "once it is over");
    });

    it("works with an OpenAI-compatible engine, whose context the page doesn't know", async () => {
      let id = null;
      for (const content of ["one", "two", "three"]) id = (await chat(env.api, { chatId: id, content, engine: env.openaiEngine, model: "fake-7b" })).id;
      const from = env.openai.requests.length;
      const r = await env.api.json(`/api/chats/${id}/compact`, { method: "POST", body: { engine: env.openaiEngine, model: "fake-7b" } });
      assert.equal(r.status, 200);
      const [request] = env.openai.requests.slice(from).filter((q) => q.path === "/v1/chat/completions");
      assert.ok(!request.body.stream, "a whole answer, not a stream");
      assert.match(request.body.messages[0].content, /^Summarize the conversation below/);
      assert.deepEqual(r.data.messages.map((m) => !!m.summary), [false, false, false, true, false, false]);
      await chat(env.api, { chatId: id, content: "four", engine: env.openaiEngine, model: "fake-7b" });
      assert.match(env.openai.lastChat().body.messages[0].content, /Summary of the earlier part of this conversation/);
    });

    it("asks for the context it cut the pieces for, and reasoning off", async () => {
      const id = await newChat(["a", "b"]);
      const from = env.ollama.requests.length;
      assert.equal((await compact(id, { model: "thinker:latest", contextSize: 2048 })).status, 200);
      const [{ body }] = summarizing(from);
      assert.equal(body.options.num_ctx, 2048);
      assert.equal(body.think, false);
    });

    it("refuses what it can't do", async () => {
      const id = await newChat(["a", "b"]);
      const cases = [
        [`/api/chats/999999999/compact`, { model: MODEL }, 404],
        [`/api/chats/${id}/compact`, { model: "" }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, contextSize: 100 }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, contextSize: "big" }, 400],
        [`/api/chats/${id}/compact`, { model: MODEL, contextSize: 2_000_000 }, 400],
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
