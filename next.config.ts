import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Only one `next dev` may use a build directory at a time. The end-to-end tests start their own
  // dev server in a separate one (OLLAMA_WRAP_DIST_DIR), so they can run while the app is open.
  ...(process.env.OLLAMA_WRAP_DIST_DIR ? { distDir: process.env.OLLAMA_WRAP_DIST_DIR } : {}),
};

export default nextConfig;
