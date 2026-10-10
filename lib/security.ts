const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The Host header must name this machine. Blocks other devices on the network and
// DNS-rebinding pages (a foreign domain resolving to 127.0.0.1), which control both Origin and Host.
export function isLoopbackHost(host: string | null) {
  if (!host) return false;
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

// Requests that change something must come from the app's own page (CSRF).
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
