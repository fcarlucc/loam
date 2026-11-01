// What every UI test gets: the app (started like `npm run dev`, with its own build directory and a
// throwaway database) and the fake Ollama it talks to. Both start once per worker and stop at the end,
// and the browser is kept off the internet: a request to anything but the app fails the test.
import { expect, test as base } from "@playwright/test";
import type { App } from "../e2e/helpers/app.mjs";
import type { FakeOllama } from "../e2e/helpers/fake-ollama.mjs";
import type { ApiClient } from "../e2e/helpers/http.mjs";

export type { ApiClient, App, FakeOllama };
export type { OllamaRequest } from "../e2e/helpers/fake-ollama.mjs";

// The helpers are ES modules shared with the API tests; this file is loaded as CommonJS, so they are imported at run time.
const helpers = {
  app: () => import("../e2e/helpers/app.mjs"),
  ollama: () => import("../e2e/helpers/fake-ollama.mjs"),
  http: () => import("../e2e/helpers/http.mjs"),
};

type WorkerFixtures = { ollama: FakeOllama; app: App };
type TestFixtures = { api: ApiClient; noInternet: void };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  ollama: [
    async ({}, provide) => {
      const ollama = await (await helpers.ollama()).startFakeOllama();
      await provide(ollama);
      await ollama.close();
    },
    { scope: "worker" },
  ],

  app: [
    async ({ ollama }, provide) => {
      const app = await (await helpers.app()).startApp({ ollamaUrl: ollama.url, env: { OLLAMA_WRAP_DIST_DIR: ".next-ui" } });
      // Should the runner die before the teardown, the app must not outlive it.
      const stop = () => app.child.kill("SIGINT");
      process.once("exit", stop);
      await app.ready(120_000);
      await provide(app);
      await app.stop();
      process.off("exit", stop);
    },
    { scope: "worker", timeout: 180_000 },
  ],

  baseURL: async ({ app }, provide) => {
    await provide(app.url);
  },

  // The app's API, to set up what a test needs faster than clicking through it.
  api: async ({ app }, provide) => {
    await provide((await helpers.http()).apiClient(app.url));
  },

  // Privacy: the page may only talk to the app. Anything else is blocked and fails the test.
  noInternet: [
    async ({ context, app }, provide) => {
      const outside: string[] = [];
      await context.route(
        (url) => url.origin !== app.url,
        (route) => {
          outside.push(route.request().url());
          void route.abort();
        },
      );
      await provide();
      expect(outside, "requests outside the app").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
