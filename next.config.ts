import type { NextConfig } from "next";

// The page loads nothing from the internet: the browser itself refuses images, media, fonts and stylesheets
// from anywhere but the app, whatever a reply contains. A Mermaid diagram, for one, can name an image by URL
// and fetches it while drawing.
const contentSecurityPolicy = [
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] }];
  },
  // Only one `next dev` may use a build directory at a time. The end-to-end tests start their own
  // dev server in a separate one (OLLAMA_WRAP_DIST_DIR), so they can run while the app is open.
  ...(process.env.OLLAMA_WRAP_DIST_DIR ? { distDir: process.env.OLLAMA_WRAP_DIST_DIR } : {}),
};

export default nextConfig;
