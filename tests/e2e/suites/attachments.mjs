// Files on messages: text goes to the model inside the message, images through `images`; both stay with the chat.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chat } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const SEER = "seer:latest";
// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG, "base64").length;
const notes = { name: "notes.txt", type: "text/plain", kind: "text", data: "Milk\nEggs" };
const picture = { name: "dot.png", type: "image/png", kind: "image", data: PNG };
const NOTES_INLINE = "--- Attached file: notes.txt ---\nMilk\nEggs\n--- End of notes.txt ---";

export function attachmentsSuite(env) {
  const branch = async (id) => (await env.api.json(`/api/chats/${id}`)).data.messages;

  describe("attachments", () => {
    it("a text file goes to the model inside the message and is kept apart from it", async () => {
      const r = await chat(env.api, { chatId: null, content: "Summarize", model: MODEL, attachments: [notes] });
      assert.equal(r.status, 200);
      const marked = `Summarize\n\n${NOTES_INLINE}`;
      assert.deepEqual(env.ollama.lastChat().body.messages, [{ role: "user", content: marked }]);

      const [user] = env.db.messages(r.id);
      assert.equal(user.content, "Summarize", "the file isn't written into the message");
      const rows = env.db.attachments(user.id);
      assert.equal(rows.length, 1);
      const { id, message_id, ...row } = rows[0];
      assert.equal(message_id, user.id);
      assert.deepEqual(row, { name: "notes.txt", type: "text/plain", kind: "text", size: 9, text: "Milk\nEggs", bytes: null });

      const shown = await branch(r.id);
      assert.deepEqual(shown[0].attachments, [{ id, name: "notes.txt", type: "text/plain", kind: "text", size: 9 }]);
      assert.equal(shown[1].attachments, undefined);

      const res = await env.api.get(`/api/attachments/${id}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /^text\/plain/);
      assert.equal(res.headers.get("content-disposition"), "inline; filename*=UTF-8''notes.txt");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await res.text(), "Milk\nEggs");

      // The file travels with its message on later turns, and nowhere else.
      await chat(env.api, { chatId: r.id, content: "And then?", model: MODEL });
      assert.deepEqual(
        env.ollama.lastChat().body.messages.map((m) => m.content),
        [marked, r.text, "And then?"],
      );

      // A new version of the message keeps its file.
      const edited = await chat(env.api, { chatId: r.id, content: "Shorter", model: MODEL, editOf: user.id });
      assert.equal(edited.status, 200);
      assert.equal(env.ollama.lastChat().body.messages[0].content, `Shorter\n\n${NOTES_INLINE}`);
      const copy = env.db.attachments(env.db.messages(r.id).find((m) => m.content === "Shorter").id);
      assert.equal(copy.length, 1);
      assert.notEqual(copy[0].id, id);
      assert.equal(copy[0].text, "Milk\nEggs");

      await env.api.delete(`/api/chats/${r.id}`);
      assert.equal(env.db.attachmentCount(), 0, "deleting the chat deletes its files");
      assert.equal((await env.api.get(`/api/attachments/${id}`)).status, 404);
    });

    it("images reach the model through `images`, and only a model that can see", async () => {
      const r = await chat(env.api, { chatId: null, content: "What is this?", model: SEER, attachments: [picture, notes] });
      assert.equal(r.status, 200);
      const sent = env.ollama.lastChat().body.messages[0];
      assert.deepEqual(sent.images, [PNG]);
      assert.equal(sent.content, `What is this?\n\n${NOTES_INLINE}`);
      const [user] = env.db.messages(r.id);
      const rows = env.db.attachments(user.id);
      assert.deepEqual(
        rows.map((a) => [a.kind, a.size, a.bytes, a.text]),
        [
          ["image", PNG_BYTES, PNG_BYTES, null],
          ["text", 9, null, "Milk\nEggs"],
        ],
      );
      const res = await env.api.get(`/api/attachments/${rows[0].id}`);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG, "base64")), "the bytes come back as they were");

      // A model that can't see refuses new images before anything is written…
      const before = env.db.counts();
      const refused = await chat(env.api, { chatId: null, content: "Look", model: MODEL, attachments: [picture] });
      assert.deepEqual([refused.status, refused.error], [400, `${MODEL} can't see images`]);
      assert.deepEqual(env.db.counts(), before);
      // …and old ones are left out of what it gets, so the chat can go on with it.
      const later = await chat(env.api, { chatId: r.id, content: "Go on", model: MODEL });
      assert.equal(later.status, 200);
      const history = env.ollama.lastChat().body.messages;
      assert.equal(history.length, 3);
      assert.ok(history.every((m) => !("images" in m)), "no images for a model that can't see");
      assert.ok(history[0].content.includes(NOTES_INLINE), "text files still go");
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("refuses what it can't take, naming the file, and writes nothing", async () => {
      const before = env.db.counts();
      const cases = [
        ["too many files", Array.from({ length: 9 }, () => notes), "At most 8 files per message"],
        ["binary passed off as text", [{ ...notes, data: "a\0b" }], "notes.txt isn't a text file"],
        ["text too long", [{ ...notes, data: "x".repeat(200_001) }], "notes.txt is too large: text files may have 200K characters"],
        ["an SVG", [{ ...picture, name: "a.svg", type: "image/svg+xml" }], "a.svg: only PNG, JPEG, WebP and GIF images"],
        ["bad base64", [{ ...picture, data: "not base64!" }], "Invalid attachments"],
        ["unknown kind", [{ ...notes, kind: "pdf" }], "Invalid attachments"],
        ["no name", [{ ...notes, name: "  " }], "Invalid attachments"],
        ["not a list", notes, "Invalid attachments"],
      ];
      for (const [label, attachments, error] of cases) {
        const r = await chat(env.api, { chatId: null, content: "Hi", model: SEER, attachments });
        assert.deepEqual([r.status, r.error], [400, error], label);
      }
      assert.deepEqual(env.db.counts(), before);
    });

    it("a message may be nothing but a file; files only come with a message; names lose their path", async () => {
      const r = await chat(env.api, { chatId: null, content: "", model: MODEL, attachments: [notes] });
      assert.equal(r.status, 200);
      assert.equal(env.db.chat(r.id).title, "notes.txt", "the chat is named after the file until the model names it");
      assert.equal(env.ollama.lastChat().body.messages[0].content, NOTES_INLINE);
      assert.equal(env.db.messages(r.id)[0].content, "");

      const reply = env.db.messages(r.id)[1];
      const again = await chat(env.api, { chatId: r.id, regenerate: reply.id, model: MODEL, attachments: [notes] });
      assert.deepEqual([again.status, again.error], [400, "Invalid request"]);

      const named = await chat(env.api, { chatId: r.id, content: "More", model: MODEL, attachments: [{ ...notes, name: "../../etc/passwd.txt" }] });
      assert.equal(named.status, 200);
      const user = env.db.messages(r.id).find((m) => m.content === "More");
      assert.equal(env.db.attachments(user.id)[0].name, "passwd.txt");
      await env.api.delete(`/api/chats/${r.id}`);
    });
  });
}
