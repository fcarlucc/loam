// "Regenerate with…": a new version of the latest reply, written once by another model.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { lastReply, modelPicker, openApp, requestsFor, say, sendButton, startChat, unique } from "./helpers";

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
});
