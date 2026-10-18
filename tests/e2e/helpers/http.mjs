// Talks to the app's API the way its own page does (JSON, and an Origin header on every change).
import http from "node:http";

export function apiClient(base) {
  // `origin: null` sends no Origin header, like a request that doesn't come from a browser page.
  async function request(path, { method = "GET", body, headers = {}, origin = base, signal } = {}) {
    const h = { ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD" && origin) h.Origin = origin;
    return fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal });
  }
  // Same, with the JSON answer parsed: { status, headers, data }.
  async function json(path, init) {
    const res = await request(path, init);
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  }
  return {
    base,
    request,
    json,
    get: (path, init) => request(path, init),
    post: (path, body, init) => request(path, { ...init, method: "POST", body }),
    put: (path, body, init) => request(path, { ...init, method: "PUT", body }),
    patch: (path, body, init) => request(path, { ...init, method: "PATCH", body }),
    delete: (path, body, init) => request(path, { ...init, method: "DELETE", body }),
  };
}

// A request with full control over the headers (fetch won't let us set Host).
export function rawRequest({ port, method = "GET", path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// Reads a streamed /api/chat or /api/compare reply: { text, thinking, types, stats, error }.
export async function readEvents(res) {
  const out = { text: "", thinking: "", types: [], stats: undefined, error: undefined };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      out.types.push(event.type);
      if (event.type === "delta") out.text += event.text;
      if (event.type === "thinking") out.thinking += event.text;
      if (event.type === "done") out.stats = event.stats;
      if (event.type === "error") out.error = event.message;
    }
  }
  return out;
}

// Reads every line of an NDJSON response (model downloads).
export async function readLines(res) {
  return (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// Sends a message (or edit / regenerate / retry) and reads the whole reply.
// Returns { status, id, text, types, stats, error } or, when the request was refused, { status, error }.
export async function chat(api, body, init) {
  const res = await api.post("/api/chat", body, init);
  if (!res.ok) return { status: res.status, error: (await res.json()).error };
  return { status: res.status, id: Number(res.headers.get("X-Chat-Id")), ...(await readEvents(res)) };
}
