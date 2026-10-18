// App-wide settings, usage dashboard, benchmark and the side-by-side comparison.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chat, readEvents } from "../helpers/http.mjs";

const MODEL = "fake:latest";

export function settingsSuite(env) {
  describe("settings, usage, benchmark and compare", () => {
    it("defaults for new chats and keep-alive are validated and saved", async () => {
      let res = await env.api.json("/api/settings");
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, { defaults: {}, keepAlive: 300 });

      res = await env.api.json("/api/settings", { method: "PUT", body: { defaults: { system: "  Hi  ", temperature: 0.555 } } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, { defaults: { system: "Hi", temperature: 0.56 }, keepAlive: 300 });

      res = await env.api.json("/api/settings", { method: "PUT", body: { defaults: { think: "low" } } });
      assert.deepEqual(res.data.defaults, { think: "low" }, "reasoning can be a default for new chats");

      for (const [name, body] of [
        ["bad reasoning", { defaults: { think: "sometimes" } }],
        ["bad temperature", { defaults: { temperature: 3 } }],
        ["bad context", { defaults: { contextLength: 100 } }],
        ["unknown keep-alive", { keepAlive: 123 }],
        ["keep-alive as string", { keepAlive: "60" }],
        ["nothing", {}],
      ]) {
        res = await env.api.json("/api/settings", { method: "PUT", body });
        assert.equal(res.status, 400, `${name}: got ${res.status}`);
      }

      // "Until Ollama stops" reaches Ollama as keep_alive -1 and shows as a far-away unload time.
      res = await env.api.json("/api/settings", { method: "PUT", body: { keepAlive: -1 } });
      assert.equal(res.data.keepAlive, -1);
      const r = await chat(env.api, { chatId: null, content: "stay", model: MODEL });
      assert.equal(env.ollama.lastChat().body.keep_alive, -1);
      const loaded = (await env.api.json("/api/ollama/ps")).data.models.find((m) => m.name === MODEL);
      assert.ok(new Date(loaded.expiresAt).getTime() - Date.now() > 365 * 24 * 3600 * 1000);
      await env.api.delete(`/api/chats/${r.id}`);

      res = await env.api.json("/api/settings", { method: "PUT", body: { defaults: {}, keepAlive: 300 } });
      assert.deepEqual(res.data, { defaults: {}, keepAlive: 300 });
    });

    it("compare streams an answer with the default settings and saves nothing", async () => {
      await env.api.put("/api/settings", { defaults: { system: "Compare mode", temperature: 0.1 } });
      const before = env.db.counts();
      const res = await env.api.post("/api/compare", { model: MODEL, content: "  Which is better?  " });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-chat-id"), null);
      const out = await readEvents(res);
      assert.equal(out.types.at(-1), "done");
      assert.equal(out.text, "Echo: Which is better? :: users=Which is better? :: system=Compare mode");
      assert.ok(out.stats.tokens > 0);
      assert.deepEqual(env.ollama.lastChat().body.options, { temperature: 0.1 });
      assert.deepEqual(env.db.counts(), before, "compare must not save anything");

      for (const [name, body, status] of [
        ["bad model", { model: "bad name!", content: "x" }, 400],
        ["no model", { content: "x" }, 400],
        ["empty prompt", { model: MODEL, content: "  " }, 400],
        ["prompt too long", { model: MODEL, content: "x".repeat(20001) }, 400],
        ["unknown model", { model: "missing:1b", content: "x" }, 502],
      ]) {
        const r = await env.api.json("/api/compare", { method: "POST", body });
        assert.equal(r.status, status, `${name}: got ${r.status}`);
      }
      await env.api.put("/api/settings", { defaults: {} });
    });

    it("reports this Mac's chip and memory", async () => {
      const { status, data } = await env.api.json("/api/system");
      assert.equal(status, 200);
      assert.ok(data.memoryBytes > 1024 ** 3);
      assert.ok(data.chip === null || typeof data.chip === "string");
    });

    it("usage totals match the database", async () => {
      const a = await chat(env.api, { chatId: null, content: "usage one", model: MODEL });
      await chat(env.api, { chatId: a.id, content: "usage two", model: MODEL });
      const { status, data } = await env.api.json("/api/usage");
      assert.equal(status, 200);
      const db = env.db.raw;
      const expected = db
        .prepare(
          `SELECT (SELECT count(*) FROM chats) AS chats,
                  count(*) FILTER (WHERE role = 'user') AS sent,
                  count(*) FILTER (WHERE role = 'assistant') AS replies,
                  coalesce(sum(json_extract(stats, '$.tokens')), 0) AS tokens
             FROM messages`,
        )
        .get();
      assert.equal(data.totals.chats, expected.chats);
      assert.equal(data.totals.sent, expected.sent);
      assert.equal(data.totals.replies, expected.replies);
      assert.equal(data.totals.tokens, expected.tokens);
      assert.ok(data.totals.generatingMs > 0);

      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const todayRow = data.daily.find((d) => d.day === day);
      assert.ok(todayRow && todayRow.replies >= 2, `today's replies: ${JSON.stringify(data.daily)}`);

      const perModel = data.models.find((m) => m.model === MODEL);
      assert.ok(perModel.replies >= 2);
      assert.equal(perModel.avgTokensPerSecond, 50);
      assert.equal(data.models.reduce((n, m) => n + m.replies, 0), expected.replies);
      await env.api.delete(`/api/chats/${a.id}`);
    });

    it("benchmarks a model with fixed settings, warm or cold", async () => {
      let res = await env.api.json("/api/benchmark");
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.results, []);
      assert.ok(typeof res.data.prompt === "string" && res.data.prompt.length > 10);

      const seen = env.ollama.requests.length;
      res = await env.api.json("/api/benchmark", { method: "POST", body: { model: MODEL } });
      assert.equal(res.status, 200);
      const { result } = res.data;
      assert.equal(result.model, MODEL);
      assert.equal(result.cold, false);
      assert.ok(result.tokens > 0 && result.tokensPerSecond > 0 && result.promptPerSecond > 0 && result.totalMs > 0);
      const sent = env.ollama.since(seen);
      assert.deepEqual(
        sent.map((r) => `${r.method} ${r.path}`),
        ["POST /api/chat"],
      );
      assert.equal(sent[0].body.stream, false);
      assert.deepEqual(sent[0].body.options, { temperature: 0, seed: 42, num_predict: 300 });

      const seen2 = env.ollama.requests.length;
      res = await env.api.json("/api/benchmark", { method: "POST", body: { model: MODEL, cold: true } });
      assert.equal(res.status, 200);
      assert.equal(res.data.result.cold, true);
      const cold = env.ollama.since(seen2);
      assert.deepEqual(
        cold.map((r) => `${r.method} ${r.path}`),
        ["POST /api/generate", "POST /api/chat"],
        "a cold run unloads the model first",
      );
      assert.equal(cold[0].body.keep_alive, 0);

      res = await env.api.json("/api/benchmark");
      assert.equal(res.data.results.length, 2);
      assert.equal(res.data.results[0].cold, true, "newest first");
      assert.equal((await env.api.json("/api/benchmark", { method: "POST", body: { model: "missing:1b" } })).status, 502);
      assert.equal((await env.api.json("/api/benchmark", { method: "POST", body: { model: "bad name!" } })).status, 400);

      res = await env.api.json("/api/benchmark", { method: "DELETE" });
      assert.deepEqual(res.data, { ok: true });
      assert.deepEqual((await env.api.json("/api/benchmark")).data.results, []);
    });
  });
}
