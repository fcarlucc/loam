// Compacting a chat whose context is nearly full: by hand from the warning, or automatically before sending.
import type { Page } from "@playwright/test";
import { expect, test, type ApiClient } from "./fixtures";
import { ask, composer, lastReply, openApp, requestsFor, say, sendButton, sidebar, unique } from "./helpers";

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
