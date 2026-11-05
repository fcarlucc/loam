// "Regenerate with…": a new version of the latest reply, written once by another model.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ask, chooseModel, lastReply, modelPicker, openApp, replies, requestsFor, say, sendButton, sidebar, startChat, unique } from "./helpers";

const menuButton = (page: Page) => lastReply(page).getByRole("button", { name: "Try another model" });
const menu = (page: Page) => page.getByRole("group", { name: "Regenerate with" });
const replyModel = (page: Page) => lastReply(page).getByTestId("reply-model");

test("regenerating with another model adds a version named after it, and the chat keeps its model", async ({ page, ollama }) => {
  await openApp(page);
  await expect(modelPicker(page)).toContainText("fake:latest");
  const text = unique("versions");
  await startChat(page, text);
  // A chat written by one model doesn't name it under every reply.
  await expect(replyModel(page)).toHaveCount(0);

  await menuButton(page).click();
  await expect(menu(page).getByRole("button", { name: /fake:latest/ })).toHaveAttribute("aria-current", "true");
  await menu(page).getByRole("button", { name: "seer:latest", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(sendButton(page)).toBeVisible();

  await expect(lastReply(page).getByText("2/2")).toBeVisible();
  await expect(replyModel(page)).toHaveText("seer:latest");
  const requests = requestsFor(ollama, say(text));
  expect(requests.map((r) => r.body.model)).toEqual(["fake:latest", "seer:latest"]);
  // The picker, and so the next message, stay with the chat's model.
  await expect(modelPicker(page)).toContainText("fake:latest");

  await lastReply(page).getByRole("button", { name: "Previous version" }).click();
  await expect(lastReply(page).getByText("1/2")).toBeVisible();
  await expect(replyModel(page)).toHaveText("fake:latest");
});

test("the menu works from the keyboard", async ({ page }) => {
  await openApp(page);
  await expect(modelPicker(page)).toContainText("fake:latest");
  await startChat(page, unique("keys"));

  await menuButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("button", { name: /fake:latest/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("button", { name: /fake:latest/ })).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeFocused();

  // Tab closes it and goes on to the next control, instead of leaving the focus nowhere.
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu(page)).toHaveCount(0);
  await expect(lastReply(page).getByRole("button", { name: "Branch", exact: true })).toBeFocused();
});

test("the menu closes on a click elsewhere and when the chat scrolls", async ({ page }) => {
  await openApp(page);
  await startChat(page, unique("close"));
  await menuButton(page).click();
  await expect(menu(page)).toBeVisible();
  await page.getByTestId("chat-title").click();
  await expect(menu(page)).toHaveCount(0);

  await menuButton(page).click();
  await expect(menu(page)).toBeVisible();
  await lastReply(page).evaluate((el) => el.closest(".overflow-y-auto")?.dispatchEvent(new Event("scroll")));
  await expect(menu(page)).toHaveCount(0);
});

test("in a chat written by several models, every reply names its model without hovering", async ({ page }) => {
  await openApp(page);
  await expect(modelPicker(page)).toContainText("fake:latest");
  await startChat(page, unique("mixed"));
  await chooseModel(page, "seer:latest");
  await ask(page, unique("second"));
  await page.mouse.move(0, 0);
  const first = replies(page).first().getByTestId("reply-model");
  await expect(first).toHaveText("fake:latest");
  await expect.poll(() => first.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe("1");
  await expect(lastReply(page).getByTestId("reply-model")).toHaveText("seer:latest");
});

test("another model gets the settings as it can take them", async ({ page, api, ollama }) => {
  // A chat whose settings suit its model only: a long context and a reasoning level others may not offer.
  const tag = unique("fit");
  const res = await api.post("/api/chat", { chatId: null, model: "fake:latest", settings: { contextLength: 32768, think: "high" }, content: say(tag) });
  expect(res.ok).toBe(true);
  await res.text();
  await openApp(page);
  await sidebar(page).getByRole("button", { name: say(tag), exact: true }).click(); // titled after the message: never renamed
  await expect(lastReply(page)).toContainText(tag);

  // The thinker reasons at false, "low" or "medium" and reads at most 8K: "high" is left out, the context capped.
  await menuButton(page).click();
  await menu(page).getByRole("button", { name: "thinker:latest", exact: true }).click();
  await expect(lastReply(page).getByText("2/2")).toBeVisible();
  const request = requestsFor(ollama, say(tag)).at(-1)!;
  expect(request.body.model).toBe("thinker:latest");
  expect(request.body.think).toBeUndefined();
  expect(request.body.options?.num_ctx).toBe(8192);
});
