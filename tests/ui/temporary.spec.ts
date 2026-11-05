// A temporary chat: never saved, never listed or searchable, gone once the user leaves it.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  ask,
  chatTitle,
  chooseModel,
  composer,
  lastReply,
  openApp,
  replies,
  requestsFor,
  say,
  send,
  sendButton,
  sidebar,
  stopButton,
  unique,
  userMessages,
} from "./helpers";

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
  // Once it has messages it stays temporary, says so, and never shows up in the sidebar.
  await expect(temporaryToggle(page)).toHaveCount(0);
  await expect(page.getByTestId("temporary-badge")).toHaveText("Temporary chat");
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

async function attach(page: Page, name: string, text: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
}

test("switching to temporary keeps the files and settings already set", async ({ page }) => {
  await openApp(page);
  await attach(page, "keep.txt", "Still here.\n");
  await page.getByRole("button", { name: /^Chat settings/ }).click();
  await page.getByRole("textbox", { name: "System prompt" }).fill("Answer in French.");
  await temporaryToggle(page).click();
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove keep.txt" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "System prompt" })).toHaveValue("Answer in French.");
});

test("a temporary chat's files go with every message and open from the page", async ({ page, ollama }) => {
  await openApp(page);
  await temporaryToggle(page).click();
  await attach(page, "notes.txt", "Remember the milk.\n");
  const first = unique("file");
  await ask(page, first);

  // The file opens from the page itself: the server never had it.
  const link = userMessages(page).last().getByRole("link", { name: /notes\.txt/ });
  await expect(link).toHaveAttribute("href", /^blob:/);
  const opened = await link.evaluate(async (a) => (await fetch((a as HTMLAnchorElement).href)).text());
  expect(opened).toBe("Remember the milk.\n");

  // A later message sends it again, inside the first one.
  const second = unique("later");
  await ask(page, second);
  const [request] = requestsFor(ollama, say(second));
  expect(request.body.messages?.[0].content).toContain("--- Attached file: notes.txt ---\nRemember the milk.");

  // Editing the message keeps its file.
  const edited = unique("edited");
  await userMessages(page).first().hover();
  await userMessages(page).first().getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Edit message" }).fill(say(edited));
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(lastReply(page)).toHaveText(new RegExp(edited));
  await expect(userMessages(page)).toHaveCount(1);
  await expect(userMessages(page).first().getByRole("link", { name: /notes\.txt/ })).toBeVisible();
  const [resent] = ollama.chats().filter((r) => r.body.messages?.at(-1)?.content.startsWith(say(edited)));
  expect(resent.body.messages?.at(-1)?.content).toContain("Remember the milk.");
});

test("stopping a temporary reply keeps what was written, and stops the engine", async ({ page, ollama }) => {
  await openApp(page);
  await temporaryToggle(page).click();
  await chooseModel(page, "slow:latest");
  const text = unique("stopped");
  await send(page, text);
  await expect(lastReply(page)).toContainText("tick 3");
  await stopButton(page).click();
  await expect(sendButton(page)).toBeVisible();
  await expect(lastReply(page)).toContainText("tick 3");
  await expect(lastReply(page)).not.toContainText("tick 80");
  const [request] = requestsFor(ollama, text);
  await expect.poll(() => request.aborted).toBe(true);
  await expect(composer(page)).toBeEnabled();
});
