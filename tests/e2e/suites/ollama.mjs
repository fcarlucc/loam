// The models & memory panel and the Ollama status: everything the app asks Ollama to do.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitFor } from "../helpers/app.mjs";
import { PULL_ERROR } from "../helpers/fake-ollama.mjs";
import { chat, readLines } from "../helpers/http.mjs";

const MODEL = "fake:latest";
const OLLAMA_DOWN = "Cannot reach Ollama. Is it running?";

export function ollamaSuite(env) {
  describe("Ollama management", () => {
    it("reports the status of the Ollama it talks to", async () => {
      const { status, data } = await env.api.json("/api/ollama/status");
      assert.equal(status, 200);
      assert.deepEqual(data, { running: true, version: "0.0.0-fake", host: new URL(env.ollama.url).host });
    });

    it("lists installed models with their details", async () => {
      const { status, data } = await env.api.json("/api/ollama/models");
      assert.equal(status, 200);
      for (const name of ["fake:latest", "slow:latest", "loading:latest"]) assert.ok(data.models.includes(name), name);
      const fake = data.installed.find((m) => m.name === MODEL);
      assert.deepEqual(fake, { name: MODEL, bytes: 1_000_000_000, modifiedAt: "2026-01-01T00:00:00Z", parameterSize: "1B", quantization: "Q4_0" });
    });

    it("shows a model's details", async () => {
      const { status, data } = await env.api.json(`/api/ollama/show?model=${MODEL}`);
      assert.equal(status, 200);
      assert.deepEqual(data, {
        contextMax: 8192,
        temperature: 0.7,
        capabilities: ["completion"],
        thinking: null,
        family: "fake",
        parameterSize: "1B",
        quantization: "Q4_0",
        license: "FAKE LICENSE line 2 line 3",
      });
      const thinker = (await env.api.json("/api/ollama/show?model=thinker:latest")).data;
      assert.ok(thinker.capabilities.includes("thinking"));
      assert.deepEqual(thinker.thinking, { values: [false, "low", "medium"], default: "medium" }, "what `think` accepts, and the default");
      const unknown = await env.api.json("/api/ollama/show?model=nope:latest");
      assert.equal(unknown.status, 502);
      assert.equal(unknown.data.error, "model 'nope:latest' not found");
      assert.equal((await env.api.json("/api/ollama/show?model=bad%20name!")).status, 400);
      assert.equal((await env.api.json("/api/ollama/show")).status, 400);
    });

    it("shows what is loaded in memory and frees it", async () => {
      const r = await chat(env.api, { chatId: null, content: "load me", model: MODEL });
      let { data } = await env.api.json("/api/ollama/ps");
      const loaded = data.models.find((m) => m.name === MODEL);
      assert.ok(loaded, `fake:latest should be loaded: ${JSON.stringify(data)}`);
      assert.equal(loaded.bytes, 1_000_000_000);
      assert.equal(loaded.gpuBytes, 1_000_000_000);
      assert.equal(loaded.contextLength, 8192);
      const inMs = new Date(loaded.expiresAt).getTime() - Date.now();
      assert.ok(inMs > 4 * 60_000 && inMs <= 5 * 60_000, `unloads in ${Math.round(inMs / 1000)} s (Ollama's default is 5 min)`);

      const seen = env.ollama.requests.length;
      const unload = await env.api.json("/api/ollama/unload", { method: "POST", body: { model: MODEL } });
      assert.deepEqual(unload.data, { ok: true });
      assert.deepEqual(env.ollama.since(seen)[0].body, { model: MODEL, keep_alive: 0 });
      ({ data } = await env.api.json("/api/ollama/ps"));
      assert.ok(!data.models.some((m) => m.name === MODEL), "the model is no longer loaded");

      assert.equal((await env.api.json("/api/ollama/unload", { method: "POST", body: { model: "nope:latest" } })).status, 502);
      assert.equal((await env.api.json("/api/ollama/unload", { method: "POST", body: { model: "bad name!" } })).status, 400);
      await env.api.delete(`/api/chats/${r.id}`);
    });

    it("downloads a model and relays the progress", async () => {
      const res = await env.api.post("/api/ollama/pull", { name: "newmodel" });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /ndjson/);
      const lines = await readLines(res);
      assert.equal(lines[0].status, "pulling manifest");
      assert.ok(lines.some((l) => l.total === 1_000_000 && l.completed === 500_000), "progress lines pass through");
      assert.equal(lines.at(-1).status, "success");
      assert.ok((await env.api.json("/api/ollama/models")).data.models.includes("newmodel:latest"));

      const missing = await env.api.json("/api/ollama/pull", { method: "POST", body: { name: "missing-model" } });
      assert.equal(missing.status, 502);
      assert.equal(missing.data.error, PULL_ERROR);
      assert.equal((await env.api.json("/api/ollama/pull", { method: "POST", body: { name: "bad name!" } })).status, 400);
      assert.equal((await env.api.json("/api/ollama/pull", { method: "POST", body: {} })).status, 400);

      // Closing the request cancels the download.
      const controller = new AbortController();
      const aborted = await env.api.post("/api/ollama/pull", { name: "aborted-model" }, { signal: controller.signal });
      const reader = aborted.body.getReader();
      await reader.read();
      controller.abort();
      const sent = env.ollama.requests.filter((r) => r.path === "/api/pull").at(-1);
      await waitFor(() => sent.aborted, { what: "the download to be cancelled at Ollama" });
      assert.ok(!(await env.api.json("/api/ollama/models")).data.models.includes("aborted-model:latest"));
    });

    it("deletes a model from disk", async () => {
      const del = await env.api.json("/api/ollama/models", { method: "DELETE", body: { model: "newmodel:latest" } });
      assert.equal(del.status, 200);
      assert.deepEqual(del.data, { ok: true });
      assert.ok(!(await env.api.json("/api/ollama/models")).data.models.includes("newmodel:latest"));
      const again = await env.api.json("/api/ollama/models", { method: "DELETE", body: { model: "newmodel:latest" } });
      assert.equal(again.status, 404);
      assert.equal((await env.api.json("/api/ollama/models", { method: "DELETE", body: { model: "bad name!" } })).status, 400);
    });

    it("when Ollama is off, every panel degrades gracefully", async () => {
      await env.ollama.pause();
      try {
        const status = await env.api.json("/api/ollama/status");
        assert.deepEqual(status.data, { running: false, host: new URL(env.ollama.url).host });
        assert.deepEqual((await env.api.json("/api/ollama/models")).data, { models: [], installed: [] });
        assert.deepEqual((await env.api.json("/api/ollama/ps")).data, { models: [] });
        for (const [path, init] of [
          [`/api/ollama/show?model=${MODEL}`, undefined],
          ["/api/ollama/unload", { method: "POST", body: { model: MODEL } }],
          ["/api/ollama/pull", { method: "POST", body: { name: MODEL } }],
          ["/api/ollama/models", { method: "DELETE", body: { model: MODEL } }],
          ["/api/compare", { method: "POST", body: { model: MODEL, content: "x" } }],
          ["/api/benchmark", { method: "POST", body: { model: MODEL } }],
        ]) {
          const res = await env.api.json(path, init);
          assert.equal(res.status, 502, `${init?.method ?? "GET"} ${path}: got ${res.status}`);
          assert.equal(res.data.error, OLLAMA_DOWN);
        }
      } finally {
        await env.ollama.resume();
      }
      assert.equal((await env.api.json("/api/ollama/status")).data.running, true);
    });

    it("the power switch accepts only start and stop", async () => {
      // Starting and stopping the real service is covered by lifecycle.test.mjs.
      assert.equal((await env.api.json("/api/ollama/power", { method: "POST", body: { action: "restart" } })).status, 400);
      assert.equal((await env.api.json("/api/ollama/power", { method: "POST", body: {} })).status, 400);
    });
  });
}
