// Token counts the way context sizes are named: 8192 -> "8K", 4300 -> "4.2K".
export const formatTokens = (n: number) => (n < 1024 ? String(n) : `${+(n / 1024).toFixed(1)}K`);

// 16350602852 -> "15.2 GB"
export function formatBytes(bytes: number) {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// 800 -> "0.8 s", 12400 -> "12 s", 95000 -> "1 min 35 s"
export function formatDuration(ms: number) {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

// When Ollama will unload a model, as shown to the user.
export function formatUnload(expiresAt: string | null, now = Date.now()) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms > 365 * 24 * 3600 * 1000) return "stays loaded";
  if (ms <= 60 * 1000) return "unloads in less than a minute";
  return `unloads in ${Math.round(ms / 60000)} min if unused`;
}

// Search snippets wrap matched words in these control characters (never typed by users).
export const MARK_START = "\u0002";
export const MARK_END = "\u0003";
