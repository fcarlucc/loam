// Engines: the built-in Ollama, adding and editing engines (loopback only), testing a connection, what the
// model picker gets, and how chats and the Ollama-only routes relate to engines.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTEXT_LENGTH, OPENAI_MODELS } from "../helpers/fake-openai.mjs";
import { chat } from "../helpers/http.mjs";

export function enginesSuite(env) {
  const list = async () => (await env.api.json("/api/engines")).data;
  const add = (body) => env.api.json("/api/engines", { method: "POST", body });
  const picker = async () => (await env.api.json("/api/models")).data.engines;

  describe("engines", () => {
    it("the built-in Ollama is there without any setup, first, and can't be removed", async () => {
      const { engines, remoteAllowed } = await list();
      assert.equal(remoteAllowed, false, "remote engines are off unless asked for");
      assert.equal(engines[0].id, "ollama");
      assert.deepEqual(engines[0], { id: "ollama", name: "Ollama", kind: "ollama", baseUrl: env.ollama.url, builtin: true, remote: false });
      const del = await env.api.json("/api/engines/ollama", { method: "DELETE" });
      assert.equal(del.status, 400);
      assert.ok((await list()).engines.some((e) => e.id === "ollama"));
    });

    it("the model picker gets every engine with its models and whether it answers", async () => {
      const engines = await picker();
      const ollama = engines.find((e) => e.id === "ollama");
      assert.equal(ollama.online, true);
      assert.ok(ollama.models.includes("fake:latest"));
      const openai = engines.find((e) => e.id === env.openaiEngine);
      assert.equal(openai.name, "LM Studio");
      assert.equal(openai.kind, "openai");
      assert.equal(openai.online, true);
      assert.deepEqual(openai.models, Object.keys(OPENAI_MODELS));
      assert.equal(openai.remote, false);
    });

    it("only engines on this machine are accepted", async () => {
      const before = (await list()).engines.length;
      for (const baseUrl of [
        "http://192.168.1.10:1234/v1",
        "http://example.com/v1",
        "https://api.openai.com/v1",
        "http://127.0.0.1.nip.io:1234/v1",
        "http://10.0.0.5:11434",
        "http://0.0.0.0:1234/v1",
      ]) {
        const res = await add({ name: "Elsewhere", kind: "openai", baseUrl });
        assert.equal(res.status, 400, `${baseUrl} was accepted`);
        assert.match(res.data.error, /Only engines on this machine|ALLOW_REMOTE_ENGINES/);
      }
      for (const [name, body] of [
        ["ftp scheme", { name: "x", kind: "openai", baseUrl: "ftp://localhost:1234/v1" }],
        ["credentials in the URL", { name: "x", kind: "openai", baseUrl: "http://user:pw@localhost:1234/v1" }],
        ["a query string", { name: "x", kind: "openai", baseUrl: "http://localhost:1234/v1?key=1" }],
        ["not a URL", { name: "x", kind: "openai", baseUrl: "localhost:1234" }],
        ["no URL", { name: "x", kind: "openai" }],
        ["unknown kind", { name: "x", kind: "anthropic", baseUrl: "http://localhost:1234/v1" }],
        ["empty name", { name: "  ", kind: "openai", baseUrl: "http://localhost:1234/v1" }],
        ["name too long", { name: "x".repeat(41), kind: "openai", baseUrl: "http://localhost:1234/v1" }],
      ]) {
        const res = await add(body);
        assert.equal(res.status, 400, `${name}: got ${res.status}`);
      }
      assert.equal((await list()).engines.length, before, "nothing was added");

      for (const [baseUrl, stored] of [
        ["http://localhost:1234/v1", "http://localhost:1234/v1"],
        ["http://127.0.0.1:1234/v1/", "http://127.0.0.1:1234/v1"],
        ["http://[::1]:8080/v1", "http://[::1]:8080/v1"],
        ["HTTP://LOCALHOST:11435", "http://localhost:11435"],
      ]) {
        const res = await add({ name: "Local", kind: "openai", baseUrl });
        assert.equal(res.status, 201, `${baseUrl} was refused: ${JSON.stringify(res.data)}`);
        assert.equal(res.data.engine.baseUrl, stored);
        assert.equal(res.data.engine.remote, false);
        await env.api.delete(`/api/engines/${res.data.engine.id}`);
      }
    });

    it("adds, renames, re-points, tests and removes an engine", async () => {
      const res = await add({ name: "  llama.cpp ", kind: "openai", baseUrl: "http://127.0.0.1:65000/v1" });
      assert.equal(res.status, 201);
      const { engine } = res.data;
      assert.equal(engine.name, "llama.cpp");
      assert.equal(engine.builtin, false);
      assert.ok((await list()).engines.some((e) => e.id === engine.id));

      // Nothing listens there: offline in the picker, and the test says why.
      let mine = (await picker()).find((e) => e.id === engine.id);
      assert.deepEqual([mine.online, mine.models], [false, []]);
      let test = await env.api.json(`/api/engines/${engine.id}/test`, { method: "POST" });
      assert.equal(test.status, 200);
      assert.equal(test.data.ok, false);
      assert.equal(test.data.error, "Cannot reach llama.cpp. Is it running?");

      // Pointed at the fake, it answers.
      let patch = await env.api.json(`/api/engines/${engine.id}`, { method: "PATCH", body: { name: "My server", baseUrl: `${env.openai.url}/v1` } });
      assert.equal(patch.status, 200);
      assert.deepEqual([patch.data.engine.name, patch.data.engine.baseUrl, patch.data.engine.kind], ["My server", `${env.openai.url}/v1`, "openai"]);
      test = await env.api.json(`/api/engines/${engine.id}/test`, { method: "POST" });
      assert.deepEqual(test.data, { ok: true, models: Object.keys(OPENAI_MODELS).length });
      mine = (await picker()).find((e) => e.id === engine.id);
      assert.equal(mine.online, true);
      const ollamaTest = await env.api.json("/api/engines/ollama/test", { method: "POST" });
      assert.equal(ollamaTest.data.ok, true);
      assert.equal(ollamaTest.data.version, "0.0.0-fake");

      for (const [name, body, status] of [
        ["remote URL", { baseUrl: "http://192.168.1.10:1234/v1" }, 400],
        ["empty name", { name: "" }, 400],
        ["nothing", {}, 400],
      ]) {
        patch = await env.api.json(`/api/engines/${engine.id}`, { method: "PATCH", body });
        assert.equal(patch.status, status, `${name}: got ${patch.status}`);
      }
      assert.equal((await env.api.json("/api/engines/nope", { method: "PATCH", body: { name: "x" } })).status, 404);
      assert.equal((await env.api.json("/api/engines/nope/test", { method: "POST" })).status, 404);
      assert.equal((await env.api.json("/api/engines/nope")).status, 404);

      const del = await env.api.json(`/api/engines/${engine.id}`, { method: "DELETE" });
      assert.deepEqual([del.status, del.data], [200, { ok: true }]);
      assert.equal((await env.api.json(`/api/engines/${engine.id}`, { method: "DELETE" })).status, 404);
      assert.ok(!(await list()).engines.some((e) => e.id === engine.id));
    });

    it("the built-in Ollama can be renamed and re-pointed, and goes back to its default URL rule", async () => {
      const patch = await env.api.json("/api/engines/ollama", { method: "PATCH", body: { name: "Ollama (brew)" } });
      assert.equal(patch.status, 200);
      assert.deepEqual([patch.data.engine.name, patch.data.engine.baseUrl, patch.data.engine.builtin], ["Ollama (brew)", env.ollama.url, true]);
      assert.equal((await list()).engines[0].name, "Ollama (brew)", "still first");
      assert.equal((await env.api.json("/api/engines/ollama", { method: "PATCH", body: { baseUrl: "http://10.0.0.1:11434" } })).status, 400);
      await env.api.json("/api/engines/ollama", { method: "PATCH", body: { name: "Ollama" } });
      assert.equal((await list()).engines[0].name, "Ollama");
    });

    it("describes a model of an OpenAI-compatible engine with what the server tells", async () => {
      const res = await env.api.json(`/api/engines/${env.openaiEngine}/show?model=fake-7b`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, {
        contextMax: CONTEXT_LENGTH,
        temperature: null,
        capabilities: null,
        thinking: null,
        family: null,
        parameterSize: null,
        quantization: null,
        license: null,
      });
      assert.equal((await env.api.json(`/api/engines/${env.openaiEngine}/show`)).status, 400);
      assert.equal((await env.api.json("/api/engines/nope/show?model=x")).status, 404);
      // The Ollama route answers the same for the built-in engine, named or not.
      const named = await env.api.json("/api/ollama/show?engine=ollama&model=fake:latest");
      assert.deepEqual(named.data, (await env.api.json("/api/ollama/show?model=fake:latest")).data);
    });

    it("the Ollama-only routes refuse other kinds of engine", async () => {
      for (const [path, init] of [
        [`/api/ollama/models?engine=${env.openaiEngine}`, undefined],
        [`/api/ollama/ps?engine=${env.openaiEngine}`, undefined],
        [`/api/ollama/status?engine=${env.openaiEngine}`, undefined],
        ["/api/ollama/pull", { method: "POST", body: { engine: env.openaiEngine, name: "x" } }],
        ["/api/ollama/unload", { method: "POST", body: { engine: env.openaiEngine, model: "fake-7b" } }],
        ["/api/ollama/models", { method: "DELETE", body: { engine: env.openaiEngine, model: "fake-7b" } }],
        ["/api/ollama/power", { method: "POST", body: { engine: env.openaiEngine, action: "start" } }],
      ]) {
        const res = await env.api.json(path, init);
        assert.equal(res.status, 400, `${init?.method ?? "GET"} ${path}: got ${res.status}`);
        assert.equal(res.data.error, "LM Studio is not an Ollama engine");
      }
      assert.equal((await env.api.json("/api/ollama/models?engine=nope")).status, 404);
      assert.equal((await env.api.json("/api/ollama/models?engine=bad%20id!")).status, 400);
    });

    it("a chat needs an engine that exists; its title comes from the chat's own engine", async () => {
      assert.equal((await env.api.json("/api/chat", { method: "POST", body: { engine: "nope", chatId: null, content: "x", model: "fake-7b" } })).status, 404);
      assert.equal((await env.api.json("/api/chat", { method: "POST", body: { engine: 5, chatId: null, content: "x", model: "fake-7b" } })).status, 400);
      assert.equal((await env.api.json("/api/compare", { method: "POST", body: { engine: "nope", content: "x", model: "fake-7b" } })).status, 404);
      assert.equal((await env.api.json("/api/benchmark", { method: "POST", body: { engine: "nope", model: "fake-7b" } })).status, 404);

      const content = "Budget? <<say: Budget plan>>";
      const r = await chat(env.api, { engine: env.openaiEngine, chatId: null, content, model: "thinker-7b", settings: { system: "You are a pirate." } });
      assert.equal(r.status, 200);
      const seen = env.openai.requests.length;
      const named = await env.api.json(`/api/chats/${r.id}/title`, { method: "POST" });
      assert.deepEqual([named.status, named.data.named, named.data.chat.title], [200, true, "Budget plan"]);
      const [req] = env.openai.since(seen);
      assert.equal(req.path, "/v1/chat/completions");
      assert.equal(req.body.stream, false);
      assert.equal(req.body.max_tokens, 32);
      assert.equal(req.body.temperature, 0);
      assert.equal(req.body.messages.length, 1);
      assert.ok(!JSON.stringify(req.body).includes("pirate"));
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("compare and benchmark work with an OpenAI-compatible engine", async () => {
      const res = await env.api.post("/api/compare", { engine: env.openaiEngine, model: "fake-7b", content: "Which?" });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('"delta"') && text.includes('"done"'));
      const bench = await env.api.json("/api/benchmark", { method: "POST", body: { engine: env.openaiEngine, model: "fake-7b", cold: true } });
      assert.equal(bench.status, 200, JSON.stringify(bench.data));
      assert.equal(bench.data.result.engine, env.openaiEngine);
      assert.ok(bench.data.result.tokens > 0);
      assert.equal(env.openai.lastChat().body.stream, false);
      assert.deepEqual([env.openai.lastChat().body.temperature, env.openai.lastChat().body.seed, env.openai.lastChat().body.max_tokens], [0, 42, 300]);
      const listed = (await env.api.json("/api/benchmark")).data.results.find((r) => r.engine === env.openaiEngine);
      assert.equal(listed.model, "fake-7b");
      await env.api.json("/api/benchmark", { method: "DELETE" });
    });

    it("usage is counted per engine and model", async () => {
      const a = await chat(env.api, { engine: env.openaiEngine, chatId: null, content: "usage", model: "fake-7b" });
      const b = await chat(env.api, { chatId: null, content: "usage", model: "fake:latest" });
      const { models } = (await env.api.json("/api/usage")).data;
      assert.ok(models.some((m) => m.engine === env.openaiEngine && m.model === "fake-7b"));
      assert.ok(models.some((m) => m.engine === "ollama" && m.model === "fake:latest"));
      for (const id of [a.id, b.id]) await env.api.delete(`/api/chats/${id}`);
    });
  });
}
