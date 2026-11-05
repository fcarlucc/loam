// Compacting a chat whose context is nearly full: by hand from the warning, or automatically before sending.
import type { Page } from "@playwright/test";
import { expect, test, type ApiClient } from "./fixtures";
import { ask, chooseModel, composer, lastReply, openApp, requestsFor, say, sendButton, sidebar, unique, userMessages } from "./helpers";

const HEADING = "Summary of the earlier part of this conversation.";

// A chat that fills most of the fake model's 8K context: a long message, and its even longer echo.
async function fullChat(api: ApiClient, tag: string) {
  const res = await api.post("/api/chat", { chatId: null, model: "fake:latest", settings: {}, content: `${tag} ${"word ".repeat(6000)}` });
  expect(res.ok).toBe(true);
  await res.text();
}

async function openChat(page: Page, tag: string) {
  await openApp(page);
  await sidebar(page).getByRole("button", { name: new RegExp(`^${tag}`) }).click();
  await expect(lastReply(page)).toBeVisible();
}

test("a nearly full chat can be compacted, and the next reply reads the summary", async ({ page, api, ollama }) => {
  const tag = unique("full");
  await fullChat(api, tag);
  await openChat(page, tag);

  const warning = page.getByText("close to the model's context limit");
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "Compact the chat" }).click();
  await expect(page.getByTestId("summary-note")).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect(page.getByText("Compacted: the next reply reads the summary")).toBeVisible();

  await page.getByRole("button", { name: "Show summary" }).click();
  await expect(page.getByLabel("Summary")).toContainText("Summarize the conversation below");
  await page.getByRole("button", { name: "Hide summary" }).click();

  const next = unique("after");
  await ask(page, next);
  const [request] = requestsFor(ollama, say(next));
  expect(request.body.messages?.[0].role).toBe("system");
  expect(request.body.messages?.[0].content).toContain(HEADING);
  expect(request.body.messages?.map((m) => m.role)).toEqual(["system", "user"]);

  // Undo: the model reads the whole conversation again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("summary-note")).toHaveCount(0);
});

test("with automatic compacting on, the chat is compacted before the next message goes", async ({ page, api, ollama }) => {
  const tag = unique("auto");
  await fullChat(api, tag);
  await openChat(page, tag);

  await page.getByRole("button", { name: /^Chat settings/ }).click();
  await page.getByRole("checkbox", { name: /Compact automatically/ }).check();
  await page.getByRole("button", { name: "Close chat settings" }).click();

  const next = unique("held");
  const before = ollama.requests.length;
  await composer(page).fill(say(next));
  await composer(page).press("Enter");
  await expect(lastReply(page)).toContainText(next);
  await expect(sendButton(page)).toBeVisible();
  await expect(page.getByTestId("summary-note")).toBeVisible();

  // First the summary (in pieces: the conversation is long), then the message, which reads it.
  const chats = ollama.since(before).filter((r) => r.path === "/api/chat");
  expect(chats.length).toBeGreaterThan(1);
  expect(chats.map((r) => r.body.stream)).toEqual([...chats.slice(1).map(() => false), true]);
  expect(chats.at(-1)?.body.messages?.[0].content).toContain(HEADING);
});

test("cancelling an automatic compaction keeps the message in the box, unsent", async ({ page, api, ollama }) => {
  const tag = unique("cancel");
  await fullChat(api, tag);
  await openChat(page, tag);
  await page.getByRole("button", { name: /^Chat settings/ }).click();
  await page.getByRole("checkbox", { name: /Compact automatically/ }).check();
  await page.getByRole("button", { name: "Close chat settings" }).click();
  await expect(page.getByText("just send your next message: the chat is compacted before it goes")).toBeVisible();
  // The "loading" model takes 2.5 s to answer, time enough to cancel.
  await chooseModel(page, "loading:latest");

  const draft = say(unique("held"));
  const before = ollama.requests.length;
  await composer(page).fill(draft);
  await composer(page).press("Enter");
  const status = page.getByRole("status").filter({ hasText: "Summarizing the older messages" });
  await expect(status).toContainText("Your message goes as soon as the summary is in.");
  await status.getByRole("button", { name: "Cancel" }).click();
  await expect(status).toHaveCount(0);

  // Nothing was sent, and the message is still there to send or change.
  await expect(composer(page)).toHaveValue(draft);
  await expect(userMessages(page)).toHaveCount(1);
  await page.waitForTimeout(3000); // past the moment the summary would have come back
  expect(ollama.since(before).filter((r) => r.path === "/api/chat" && r.body.stream !== false)).toEqual([]);
  await expect(page.getByTestId("summary-note")).toHaveCount(0);
});

test("with an engine that doesn't report its context, the latest reply still offers to compact", async ({ page, api }) => {
  const { startFakeOpenAI } = await import("../e2e/helpers/fake-openai.mjs");
  const openai = await startFakeOpenAI();
  const added = await (await api.post("/api/engines", { name: "Fake LM Studio", kind: "openai", baseUrl: `${openai.url}/v1` })).json();
  try {
    // A long conversation: a few thousand tokens, of a context size the server never tells.
    const tag = unique("openai");
    let chatId: number | null = null;
    for (const content of [`${tag} ${"word ".repeat(2500)}`, "And then?"]) {
      const res = await api.post("/api/chat", { chatId, engine: added.engine.id, model: "fake-7b", settings: {}, content });
      expect(res.ok).toBe(true);
      chatId = Number(res.headers.get("X-Chat-Id"));
      await res.text();
    }
    // Not openApp: with a second engine, the sidebar lists engines instead of Ollama's status line.
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: new RegExp(`^${tag}`) }).click();
    await expect(lastReply(page)).toBeVisible();
    await expect(page.getByText("close to the model's context limit")).toHaveCount(0);
    await lastReply(page).getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.getByTestId("summary-note")).toBeVisible();
  } finally {
    await api.delete(`/api/engines/${added.engine.id}`);
    await openai.close();
  }
});
