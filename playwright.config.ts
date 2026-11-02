import { defineConfig, devices } from "@playwright/test";

// Browser tests of the UI (tests/ui), against the app started as `npm run dev` does and a fake Ollama,
// with a throwaway database: see tests/ui/fixtures.ts. Chromium only: the app is a local tool.
export default defineConfig({
  testDir: "tests/ui",
  // One app and one fake Ollama serve the whole run, so the tests take turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: process.env.CI ? "never" : "on-failure" }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 60_000, // the first page load compiles the page
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
});
