// Only this Mac can use the app, and only the app's own page can change anything.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { canConnect, ROOT } from "../helpers/app.mjs";
import { rawRequest } from "../helpers/http.mjs";

// Every route file under app/api, with the HTTP methods it exports and a URL that reaches it.
export function apiRoutes(dir = join(ROOT, "app/api"), base = "/api") {
  const routes = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes.push(...apiRoutes(full, `${base}/${/^\[.*\]$/.test(name) ? "1" : name}`));
    else if (name === "route.ts") {
      const methods = [...readFileSync(full, "utf8").matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
      routes.push({ path: base, methods, file: relative(ROOT, full) });
    }
  }
  return routes;
}

export function securitySuite(env) {
  describe("only this Mac can use the app", () => {
    it("listens on 127.0.0.1 only: no other device on the network can connect", async () => {
      const { port } = env.app;
      assert.equal(await canConnect("127.0.0.1", port), true, "the app should answer on the loopback");
      const network = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a.family === "IPv4" && !a.internal)
        .map((a) => a.address);
      for (const address of network) {
        assert.equal(await canConnect(address, port), false, `${address}:${port} accepted a connection from the network side`);
      }
    });

    it("rejects API requests whose Host header isn't this machine (DNS rebinding)", async () => {
      const { port } = env.app;
      for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1.nip.io:${port}`, `172.16.0.5:${port}`, `0.0.0.0:${port}`, `localhost.evil.example:${port}`]) {
        const res = await rawRequest({ port, path: "/api/chats", headers: { Host: host } });
        assert.equal(res.status, 403, `Host "${host}" was accepted`);
        assert.deepEqual(JSON.parse(res.body), { error: "Host not allowed" });
      }
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`, "localhost"]) {
        const res = await rawRequest({ port, path: "/api/chats", headers: { Host: host } });
        assert.equal(res.status, 200, `Host "${host}" was rejected`);
      }
    });

    it("rejects changes that don't come from the app's own page (CSRF)", async () => {
      const { port } = env.app;
      const path = "/api/chat/stop";
      const body = { chatId: 1 };
      const noOrigin = await env.api.json(path, { method: "POST", body, origin: null });
      assert.equal(noOrigin.status, 403);
      assert.deepEqual(noOrigin.data, { error: "Origin not allowed" });
      for (const origin of ["http://evil.example", `http://localhost:${port + 1}`, "null", `http://127.0.0.1.nip.io:${port}`, `http://172.16.0.5:${port}`]) {
        const res = await env.api.json(path, { method: "POST", body, origin });
        assert.equal(res.status, 403, `Origin "${origin}" was accepted`);
      }
      // The app's own page passes the guard and gets the route's answer.
      const own = await env.api.json(path, { method: "POST", body });
      assert.equal(own.status, 200);
      assert.deepEqual(own.data, { stopped: false });
    });

    it("every API route is behind the guard, new ones included", async () => {
      const routes = apiRoutes();
      assert.ok(routes.length >= 17, `found only ${routes.length} routes`);
      for (const route of routes) {
        assert.ok(route.methods.length > 0, `${route.file} exports no handler`);
        for (const method of route.methods) {
          const body = method === "GET" ? undefined : "{}";
          const badHost = await rawRequest({ port: env.app.port, method, path: route.path, headers: { Host: "evil.example" }, body });
          assert.equal(badHost.status, 403, `${method} ${route.path}: a foreign Host was accepted (${route.file})`);
          if (method !== "GET") {
            const noOrigin = await env.api.request(route.path, { method, body: {}, origin: null });
            assert.equal(noOrigin.status, 403, `${method} ${route.path}: a change without Origin was accepted (${route.file})`);
          }
        }
      }
    });

    it("GET routes read and never change anything", async () => {
      const before = env.db.counts();
      const seen = env.ollama.requests.length;
      const reads = apiRoutes()
        .filter((r) => r.methods.includes("GET"))
        .map((r) => (r.path === "/api/ollama/show" ? `${r.path}?model=fake:latest` : r.path === "/api/search" ? `${r.path}?q=hello` : r.path));
      for (const path of reads) {
        const res = await env.api.get(path);
        assert.ok([200, 404].includes(res.status), `GET ${path} answered ${res.status}`);
        assert.match(res.headers.get("content-type") ?? "", /application\/json/, `GET ${path} isn't JSON`);
      }
      assert.deepEqual(env.db.counts(), before, "a GET changed the database");
      const toOllama = env.ollama.since(seen).map((r) => `${r.method} ${r.path}`);
      const readOnly = new Set(["GET /api/version", "GET /api/tags", "GET /api/ps", "POST /api/show"]);
      assert.ok(toOllama.every((r) => readOnly.has(r)), `a GET made Ollama do something: ${toOllama.join(", ")}`);
    });

    it("sends no CORS headers, so other sites can't read the answers", async () => {
      const res = await env.api.get("/api/chats", { headers: { Origin: "http://evil.example" } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      assert.equal(res.headers.get("access-control-allow-credentials"), null);
    });

    it("the page loads nothing from the internet", async () => {
      const res = await fetch(`${env.app.url}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<title>Loam<\/title>/);
      const remote = [...html.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(remote, [], "the page references remote resources");
    });

    it("the database stays in the data directory the app was given", async () => {
      assert.ok(statSync(env.app.dbPath).isFile());
      assert.ok(env.app.dataDir.startsWith(os.tmpdir()) || env.app.dataDir.startsWith("/private" + os.tmpdir()), "tests must not touch data/");
    });
  });
}
