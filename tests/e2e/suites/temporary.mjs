// Temporary chats: the page sends the whole conversation, the reply streams back, and nothing is written.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { echo, FLAKY_ERROR, THINKING_PREFIX } from "../helpers/fake-ollama.mjs";
import { textOf } from "../helpers/fake-openai.mjs";
import { readEvents } from "../helpers/http.mjs";

const MODEL = "fake:latest";
// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const notes = { name: "notes.txt", type: "text/plain", kind: "text", data: "Milk\nEggs" };
const picture = { name: "dot.png", type: "image/png", kind: "image", data: PNG };

export function temporarySuite(env) {
  async function temporary(body) {
    const res = await env.api.post("/api/chat/temporary", { model: MODEL, settings: {}, ...body });
    if (!res.ok) return { status: res.status, error: (await res.json()).error };
    return { status: res.status, chatId: res.headers.get("X-Chat-Id"), ...(await readEvents(res)) };
  }
  // Everything the app keeps: rows of every table that holds conversations, and the search index.
  const footprint = () =>
    ({
      ...env.db.counts(),
      attachments: env.db.attachmentCount(),
      indexed: env.db.raw.prepare("SELECT count(*) AS n FROM messages_fts").get().n,
    });

  describe("temporary chat", () => {
    it("streams a reply to the whole conversation and writes nothing", async () => {
      const before = footprint();
      const token = `ephemeral${Date.now().toString(36)}`;
      const messages = [
        { role: "user", content: `First ${token}` },
        { role: "assistant", content: "First answer\n" },
        { role: "user", content: "Second  ", attachments: [notes] },
      ];
      const r = await temporary({ messages, settings: { system: "Be brief", temperature: 0.3 } });
      assert.equal(r.status, 200);
      assert.equal(r.chatId, null, "no chat id: there is no chat");
      assert.equal(r.types.at(-1), "done");
      assert.ok(r.stats.tokens > 0);
      const sent = env.ollama.lastChat().body;
      assert.deepEqual(sent.messages, [
        { role: "system", content: "Be brief" },
        { role: "user", content: `First ${token}` },
        { role: "assistant", content: "First answer\n" },
        { role: "user", content: "Second\n\n--- Attached file: notes.txt ---\nMilk\nEggs\n--- End of notes.txt ---" },
      ]);
      // Messages reach the model as the page shows them; only the one to answer is trimmed.
      assert.equal(sent.options.temperature, 0.3);
      assert.equal(r.text, echo(sent.messages));

      assert.deepEqual(footprint(), before, "no chat, message, file or index entry");
      assert.deepEqual((await env.api.json(`/api/search?q=${token}`)).data.hits, []);
    });

    it("works with an OpenAI-compatible engine too", async () => {
      const before = footprint();
      const r = await temporary({
        engine: env.openaiEngine,
        model: "fake-7b",
        messages: [
          { role: "user", content: "One" },
          { role: "assistant", content: "Uno" },
          { role: "user", content: "Two" },
        ],
      });
      assert.equal(r.status, 200);
      assert.equal(r.types.at(-1), "done");
      assert.deepEqual(
        env.openai.lastChat().body.messages.map((m) => [m.role, textOf(m)]),
        [
          ["user", "One"],
          ["assistant", "Uno"],
          ["user", "Two"],
        ],
      );
      assert.deepEqual(footprint(), before);
    });

    it("shows reasoning like a saved chat", async () => {
      const r = await temporary({ model: "thinker:latest", messages: [{ role: "user", content: "Why?" }] });
      assert.equal(r.thinking, `${THINKING_PREFIX}Why?`);
      assert.ok(r.stats.thinkingMs >= 0);
    });

    it("images go to models that can see, and are refused for the others", async () => {
      const ok = await temporary({ model: "seer:latest", messages: [{ role: "user", content: "Look", attachments: [picture] }] });
      assert.equal(ok.status, 200);
      assert.deepEqual(env.ollama.lastChat().body.messages[0].images, [PNG]);

      const refused = await temporary({ messages: [{ role: "user", content: "Look", attachments: [picture] }] });
      assert.deepEqual(refused, { status: 400, error: `${MODEL} can't see images` });

      // An earlier image is left out for a model that can't see: the chat may have moved to another model.
      const later = await temporary({
        messages: [
          { role: "user", content: "Look", attachments: [picture] },
          { role: "assistant", content: "A dot" },
          { role: "user", content: "Thanks" },
        ],
      });
      assert.equal(later.status, 200);
      assert.ok(env.ollama.lastChat().body.messages.every((m) => !m.images));
    });

    it("refuses what it can't answer", async () => {
      const cases = [
        [{ messages: [] }, "Invalid request"],
        [{ messages: "hi" }, "Invalid request"],
        [{ messages: [{ role: "system", content: "x" }] }, "Invalid request"],
        [{ messages: [{ role: "user", content: 1 }] }, "Invalid request"],
        [{ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }, "Nothing to reply to"],
        [{ messages: [{ role: "user", content: "  " }] }, "Nothing to reply to"],
        [{ messages: [{ role: "assistant", content: "x", attachments: [notes] }, { role: "user", content: "y" }] }, "Invalid request"],
        [{ messages: Array.from({ length: 401 }, () => ({ role: "user", content: "x" })) }, "This temporary chat is too long: start a new one to go on."],
        [
          { messages: Array.from({ length: 4 }, () => ({ role: "user", content: "x", attachments: [{ ...notes, data: "a".repeat(199_000) }].concat(Array(7).fill({ ...notes, data: "b".repeat(199_000) })) })) },
          "This temporary chat's files take more than 6 MB together: start a new one to send more.",
        ],
        [{ messages: [{ role: "user", content: "hi" }], model: "" }, "Invalid request"],
        [{ messages: [{ role: "user", content: "hi" }], settings: { temperature: 9 } }, "Invalid settings"],
        [{ messages: [{ role: "user", content: "hi" }], engine: "nope" }, "Engine not found"],
      ];
      const before = env.ollama.chats().length;
      for (const [body, error] of cases) {
        const r = await temporary(body);
        assert.equal(r.error, error, JSON.stringify(body).slice(0, 80));
      }
      assert.equal(env.ollama.chats().length, before, "nothing reached the model");
    });

    it("an error from the model ends the stream with an error event", async () => {
      const before = footprint();
      const r = await temporary({ model: "flaky:latest", messages: [{ role: "user", content: "hi" }] });
      assert.equal(r.status, 200);
      assert.equal(r.error, FLAKY_ERROR);
      assert.deepEqual(footprint(), before);
    });

    it("needs the app's own page, like every change", async () => {
      const res = await env.api.post("/api/chat/temporary", { model: MODEL, messages: [{ role: "user", content: "hi" }] }, { origin: "http://evil.example" });
      assert.equal(res.status, 403);
    });
  });
}
