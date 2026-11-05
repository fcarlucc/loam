// A temporary chat: never saved, never listed or searchable, gone once the user leaves it.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ask, chatTitle, lastReply, openApp, replies, requestsFor, say, sendButton, sidebar, unique, userMessages } from "./helpers";

const temporaryToggle = (page: Page) => page.getByRole("button", { name: "Temporary chat" });

test("a temporary chat answers like any other and leaves nothing behind", async ({ page, api, ollama }) => {
  await openApp(page);
  const chatsBefore = (await (await api.get("/api/chats")).json()).chats.length;

  await temporaryToggle(page).click();
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await expect(chatTitle(page)).toHaveText("Temporary chat");

  const first = unique("ephemeral");
  const second = unique("ephemeral");
  await ask(page, first);
  // Once it has messages it stays temporary, and it never shows up in the sidebar.
  await expect(temporaryToggle(page)).toBeDisabled();
  await expect(chatTitle(page)).toHaveText("Temporary chat");
  await ask(page, second);
  await expect(sidebar(page).getByText(first)).toHaveCount(0);

  // The page sent the whole conversation, since the server keeps none of it.
  const [request] = requestsFor(ollama, say(second));
  expect(request.body.messages?.map((m) => m.content)).toEqual([say(first), first, say(second)]);

  // Regenerating replaces the reply (there are no versions to keep), and a temporary chat can't be branched.
  await lastReply(page).getByRole("button", { name: "Regenerate" }).click();
  await expect(sendButton(page)).toBeVisible();
  await expect(lastReply(page)).toHaveText(new RegExp(second));
  await expect(replies(page)).toHaveCount(2);
  await expect(replies(page).getByRole("button", { name: "Previous version" })).toHaveCount(0);
  await expect(replies(page).getByRole("button", { name: "Branch", exact: true })).toHaveCount(0);

  // Leaving it is the end of it.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(userMessages(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "false");
  expect((await (await api.get("/api/chats")).json()).chats.length).toBe(chatsBefore);
  const word = first.split(" ")[1];
  expect((await (await api.get(`/api/search?q=${word}`)).json()).hits).toEqual([]);
});

test("a temporary chat can be edited, and turned off again before it starts", async ({ page }) => {
  await openApp(page);
  await temporaryToggle(page).click();
  await temporaryToggle(page).click();
  await expect(temporaryToggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();

  await temporaryToggle(page).click();
  const before = unique("draft");
  const after = unique("edited");
  await ask(page, before);
  await userMessages(page).last().hover();
  await userMessages(page).last().getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Replaces this message and what follows.")).toBeVisible();
  await page.getByRole("textbox", { name: "Edit message" }).fill(say(after));
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(lastReply(page)).toHaveText(new RegExp(after));
  await expect(userMessages(page)).toHaveCount(1);
  await expect(replies(page)).toHaveCount(1);
});
