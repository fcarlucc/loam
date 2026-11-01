// The chat flow as every engine must support it, run once per engine against its fake: streaming, stop,
// regenerate and versions, edit, branch, attachments, reasoning, an engine that is off, a malformed stream.
// What the engine received is checked through the target's view of its fake, so the same assertions hold
// for Ollama's API and the OpenAI one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sleep, waitFor } from "../helpers/app.mjs";
import { echo } from "../helpers/fake-ollama.mjs";
import * as fakeOpenAI from "../helpers/fake-openai.mjs";
import { chat, readEvents } from "../helpers/http.mjs";

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const notes = { name: "notes.txt", type: "text/plain", kind: "text", data: "Milk\nEggs" };
const picture = { name: "dot.png", type: "image/png", kind: "image", data: PNG };
const NOTES_INLINE = "--- Attached file: notes.txt ---\nMilk\nEggs\n--- End of notes.txt ---";

// How each engine's fake is reached, and what its requests look like once normalized:
// sent() gives { model, stream, messages: [{ role, content, images: [base64] }] } for the last chat request.
export const OLLAMA_TARGET = {
  label: "Ollama",
  engine: () => "ollama",
  fake: (env) => env.ollama,
  models: { plain: "fake:latest", slow: "slow:latest", flaky: "flaky:latest", thinker: "thinker:latest", seer: "seer:latest", garbled: "garbled:latest" },
  thinkingPrefix: "Thinking about: ",
  flakyError: "the fake model fell over",
  sent: (env) => {
    const { body } = env.ollama.lastChat();
    return { model: body.model, stream: body.stream, messages: body.messages.map((m) => ({ role: m.role, content: m.content, images: m.images ?? [] })) };
  },
};

export const OPENAI_TARGET = {
  label: "OpenAI-compatible",
  engine: (env) => env.openaiEngine,
  fake: (env) => env.openai,
  models: { plain: "fake-7b", slow: "slow-7b", flaky: "flaky-7b", thinker: "thinker-7b", seer: "seer-7b", garbled: "garbled-7b" },
  thinkingPrefix: fakeOpenAI.THINKING_PREFIX,
  flakyError: fakeOpenAI.FLAKY_ERROR,
  sent: (env) => {
    const { body } = env.openai.lastChat();
    return {
      model: body.model,
      stream: body.stream,
      messages: body.messages.map((m) => ({
        role: m.role,
        content: fakeOpenAI.textOf(m),
        images: fakeOpenAI.imagesOf(m).map((url) => {
          assert.match(url, /^data:image\/png;base64,/, "images go as data URLs with their MIME type");
          return url.slice("data:image/png;base64,".length);
        }),
      })),
    };
  },
};

export function engineChatSuite(env, target) {
  const { models } = target;
  const branch = async (id) => (await env.api.json(`/api/chats/${id}`)).data.messages;
  const select = (id, messageId) => env.api.json(`/api/chats/${id}/select`, { method: "POST", body: { messageId } });
  const send = (body, init) => chat(env.api, { engine: target.engine(env), ...body }, init);
  const engineOf = (id) => env.db.chat(id).engine;

  describe(`chatting through ${target.label}`, () => {
    it("streams a reply and saves it with the engine that wrote it", async () => {
      const content = "Reply with exactly: one";
      const r = await send({ chatId: null, content, model: models.plain });
      assert.equal(r.status, 200);
      assert.ok(r.id > 0, "X-Chat-Id header");
      assert.equal(r.text, echo([{ role: "user", content }]));
      assert.ok(r.types.includes("delta"));
      assert.equal(r.types.at(-1), "done");
      assert.ok(r.stats.tokens > 0, "token counts come from the engine");
      assert.ok(r.stats.promptTokens > 0);
      assert.equal(r.stats.contextUsed, r.stats.promptTokens + r.stats.tokens);
      assert.ok(r.stats.tokensPerSecond >= 0 && r.stats.totalMs >= 0);

      const msgs = env.db.messages(r.id);
      assert.deepEqual(
        msgs.map((m) => [m.role, m.content, m.engine, m.model]),
        [
          ["user", content, null, null],
          ["assistant", r.text, target.engine(env), models.plain],
        ],
      );
      assert.equal(engineOf(r.id), target.engine(env), "the chat remembers its engine");
      const listed = (await env.api.json("/api/chats")).data.chats.find((c) => c.id === r.id);
      assert.equal(listed.engine, target.engine(env));
      assert.equal(listed.model, models.plain);

      const sent = target.sent(env);
      assert.equal(sent.model, models.plain);
      assert.equal(sent.stream, true);
      assert.deepEqual(sent.messages, [{ role: "user", content, images: [] }]);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("the system prompt and temperature reach the engine", async () => {
      const r = await send({ chatId: null, content: "hi", model: models.plain, settings: { system: "Be brief.", temperature: 0.3 } });
      assert.equal(r.status, 200);
      const sent = target.sent(env);
      assert.deepEqual(
        sent.messages.map((m) => [m.role, m.content]),
        [
          ["system", "Be brief."],
          ["user", "hi"],
        ],
      );
      assert.ok(r.text.endsWith(":: system=Be brief."));
      const { body } = target.fake(env).lastChat();
      assert.equal(body.options?.temperature ?? body.temperature, 0.3);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("refuses a model the engine doesn't have, writing nothing", async () => {
      const before = env.db.counts();
      const r = await send({ chatId: null, content: "hello", model: "missing-1b" });
      assert.equal(r.status, 502);
      assert.match(r.error, /missing-1b/);
      assert.deepEqual(env.db.counts(), before);
    });

    let c; // the chat used by the version tests
    let u1;

    it("editing a message starts a new version on its own branch", async () => {
      const a = await send({ chatId: null, content: "My name is Alice.", model: models.plain });
      c = a.id;
      [u1] = await branch(c);
      const edit = await send({ chatId: c, content: "My name is Bob.", editOf: u1.id, model: models.plain });
      assert.equal(edit.status, 200);
      assert.equal(edit.text, echo([{ role: "user", content: "My name is Bob." }]), "only the edited message reached the model");
      const path = await branch(c);
      assert.equal(path.length, 2);
      assert.deepEqual(path[0].versions, { ids: [u1.id, path[0].id], index: 1 });

      const ask = await send({ chatId: c, content: "What is my name?", model: models.plain });
      assert.equal(ask.text, "Echo: What is my name? :: users=My name is Bob. | What is my name?", "Alice's branch never reaches the model");
      const sel = await select(c, u1.id);
      assert.equal(sel.data.messages[0].content, "My name is Alice.");
      await select(c, path[0].id);
    });

    it("regenerating keeps the previous reply as a version, each with its own stats", async () => {
      const before = await branch(c);
      const last = before.at(-1);
      const r = await send({ chatId: c, regenerate: last.id, model: models.plain });
      assert.equal(r.status, 200);
      const sent = target.sent(env);
      assert.equal(sent.messages.length, before.length - 1, "the branch up to the user message, nothing after");
      assert.equal(sent.messages.at(-1).role, "user");
      const tail = (await branch(c)).at(-1);
      assert.notEqual(tail.id, last.id);
      assert.deepEqual(tail.versions, { ids: [last.id, tail.id], index: 1 });
      assert.deepEqual(tail.stats, r.stats);
      assert.ok(last.stats, "the old reply keeps its stats");
    });

    it("stop ends the reply gracefully and keeps what was written", async () => {
      const res = await env.api.post("/api/chat", { engine: target.engine(env), chatId: c, content: "Write a long essay.", model: models.slow });
      assert.equal(res.status, 200);
      const reading = readEvents(res);
      await sleep(800);
      const stop = await env.api.json("/api/chat/stop", { method: "POST", body: { chatId: c } });
      assert.deepEqual(stop.data, { stopped: true });
      const out = await reading;
      assert.equal(out.types.at(-1), "done", "the stream ends normally, not with an error");
      assert.ok(out.text.length > 0 && out.text.length < 300, `partial text: ${out.text.length} chars`);
      assert.equal(out.stats, undefined, "a stopped reply has no stats");
      const tail = (await branch(c)).at(-1);
      assert.equal(tail.content, out.text, "the partial reply is saved as it was shown");
      const sent = target.fake(env).lastChat();
      await waitFor(() => sent.aborted, { what: "the app to cut the connection to the engine" });
      const chunks = sent.chunks;
      await sleep(300);
      assert.equal(sent.chunks, chunks, "the engine stopped generating");
    });

    it("branches the chat into a new one that keeps the engine", async () => {
      const path = await branch(c);
      const res = await env.api.json(`/api/chats/${c}/branch`, { method: "POST", body: { messageId: path[1].id } });
      assert.equal(res.status, 200);
      assert.equal(res.data.chat.engine, target.engine(env));
      assert.equal(res.data.chat.model, models.slow, "the model the chat was last continued with");
      const copies = await branch(res.data.chat.id);
      assert.deepEqual(
        copies.map((m) => [m.role, m.content]),
        path.slice(0, 2).map((m) => [m.role, m.content]),
      );
      const more = await send({ chatId: res.data.chat.id, content: "Go on", model: models.plain });
      assert.equal(more.status, 200);
      assert.deepEqual(
        target.sent(env).messages.map((m) => m.content),
        [...path.slice(0, 2).map((m) => m.content), "Go on"],
      );
      await env.api.delete(`/api/chats/${res.data.chat.id}`);
      await env.api.delete(`/api/chats/${c}`);
    });

    it("text files go inside the message, images to models that can see", async () => {
      const r = await send({ chatId: null, content: "What is this?", model: models.seer, attachments: [picture, notes] });
      assert.equal(r.status, 200);
      const [first] = target.sent(env).messages;
      assert.equal(first.content, `What is this?\n\n${NOTES_INLINE}`);
      assert.deepEqual(first.images, [PNG]);
      const [user] = await branch(r.id);
      assert.deepEqual(
        user.attachments.map((a) => [a.name, a.kind]),
        [
          ["dot.png", "image"],
          ["notes.txt", "text"],
        ],
      );
      // The files travel with the message on later turns.
      await send({ chatId: r.id, content: "And now?", model: models.seer });
      const again = target.sent(env).messages;
      assert.equal(again.length, 3);
      assert.deepEqual(again[0].images, [PNG]);
      assert.ok(again[0].content.includes(NOTES_INLINE));
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("a reasoning model's thoughts stream apart from the reply, are kept apart and never go back", async () => {
      const content = "Why is the sky blue?";
      const r = await send({ chatId: null, content, model: models.thinker });
      assert.equal(r.status, 200);
      assert.equal(r.thinking, `${target.thinkingPrefix}${content}`);
      assert.equal(r.text, echo([{ role: "user", content }]), "the reply holds none of the reasoning");
      assert.ok(r.types.indexOf("thinking") < r.types.indexOf("delta"), "the thoughts come first");
      assert.ok(Number.isInteger(r.stats.thinkingMs) && r.stats.thinkingMs >= 0, "time spent reasoning");
      const [, reply] = env.db.messages(r.id);
      assert.equal(reply.thinking, r.thinking);
      assert.equal((await branch(r.id))[1].thinking, r.thinking, "the page gets the reasoning back to show it");

      const r2 = await send({ chatId: r.id, content: "And at sunset?", model: models.thinker });
      assert.equal(r2.status, 200);
      assert.deepEqual(
        target.sent(env).messages.map((m) => [m.role, m.content]),
        [
          ["user", content],
          ["assistant", r.text],
          ["user", "And at sunset?"],
        ],
      );
      assert.ok(!JSON.stringify(target.fake(env).lastChat().body).includes(target.thinkingPrefix));
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("an error from the engine mid-reply ends the stream with an error and keeps the question", async () => {
      const r = await send({ chatId: null, content: "Reply with exactly: retried", model: models.flaky });
      assert.equal(r.status, 200);
      assert.equal(r.types.at(-1), "error");
      assert.equal(r.error, target.flakyError);
      assert.deepEqual(
        env.db.messages(r.id).map((m) => m.role),
        ["user"],
        "the question is kept, no empty reply is saved",
      );
      const again = await send({ chatId: r.id, retry: true, model: models.plain });
      assert.equal(again.status, 200);
      assert.equal(env.db.messages(r.id).length, 2);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("a malformed stream ends with an error, keeping the words that arrived", async () => {
      const r = await send({ chatId: null, content: "Count", model: models.garbled });
      assert.equal(r.status, 200);
      assert.equal(r.types.at(-1), "error");
      assert.ok(r.types.includes("delta"), "some text had been streamed");
      assert.ok(r.error, "the error names what went wrong");
      const [, reply] = env.db.messages(r.id);
      assert.equal(reply?.content, r.text, "the partial reply is saved");
      assert.equal(reply.stats, null, "without stats");
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("when the engine is off, the app says so, writes nothing, and the picker shows it offline", async () => {
      const fake = target.fake(env);
      await fake.pause();
      try {
        const before = env.db.counts();
        const r = await send({ chatId: null, content: "hello", model: models.plain });
        assert.equal(r.status, 502);
        assert.match(r.error, /^Cannot reach .+\. Is it running\?$/);
        assert.deepEqual(env.db.counts(), before);
        const { engines } = (await env.api.json("/api/models")).data;
        const mine = engines.find((e) => e.id === target.engine(env));
        assert.deepEqual([mine.online, mine.models], [false, []]);
        const test = await env.api.json(`/api/engines/${target.engine(env)}/test`, { method: "POST" });
        assert.equal(test.data.ok, false);
        assert.match(test.data.error, /Cannot reach/);
      } finally {
        await fake.resume();
      }
      const { engines } = (await env.api.json("/api/models")).data;
      const mine = engines.find((e) => e.id === target.engine(env));
      assert.equal(mine.online, true);
      assert.ok(mine.models.includes(models.plain));
    });
  });
}
