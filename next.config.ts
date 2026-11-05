import type { NextConfig } from "next";

// What the page may load, and from where: only the app itself, whatever a reply contains. Images, fonts,
// styles, fetches, frames, workers… from anywhere else are refused by the browser, so a reply can't phone
// home even through a library that loads something while it works (a Mermaid diagram names images by URL
// and fetches them while drawing). Scripts may be inline because Next hydrates the page with inline scripts,
// and so does the theme; the dev server also evaluates code for hot reloading. No page may frame the app.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'", // also covers the dev server's WebSocket, on the same host
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    // Pages only: the API answers JSON, which a browser never renders.
    return [{ source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] }];
  },
  // Only one `next dev` may use a build directory at a time. The end-to-end tests start their own
  // dev server in a separate one (OLLAMA_WRAP_DIST_DIR), so they can run while the app is open.
  ...(process.env.OLLAMA_WRAP_DIST_DIR ? { distDir: process.env.OLLAMA_WRAP_DIST_DIR } : {}),
};

export default nextConfig;
