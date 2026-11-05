// Keyboard shortcuts and the command palette (⌘K, or Ctrl+K off a Mac: ControlOrMeta picks the right one).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  chatTitle,
  chooseModel,
  composer,
  lastReply,
  modelPicker,
  openApp,
  send,
  sendButton,
  startChat,
  stopButton,
  unique,
  userMessages,
} from "./helpers";

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: Page) => page.getByRole("combobox", { name: "Command", exact: true });
const modelInput = (page: Page) => page.getByRole("dialog").getByRole("combobox", { name: "Model", exact: true });
const option = (page: Page, name: string | RegExp) => page.getByRole("option", { name });

test("the palette finds commands and chats, and runs them from the keyboard", async ({ page }) => {
  await openApp(page);
  const title = unique("palette");
  await startChat(page, title);
  await composer(page).focus();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  // Escape closes it, and the focus goes back where it was.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(composer(page)).toBeFocused();

  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill("usage");
  await expect(option(page, /Usage & benchmark/)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Usage & benchmark" })).toBeVisible();

  // A chat, found by its title: the arrows move through the results, Enter opens one.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill(title.split(" ")[1]);
  await expect(option(page, title)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(option(page, title)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(chatTitle(page)).toHaveText(title);
  await expect(userMessages(page)).toHaveCount(1);

  // A click works too; nothing matching says so.
  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill("zzzz no such thing");
  await expect(palette(page).getByText("Nothing matches.")).toBeVisible();
  await paletteInput(page).fill("dark theme");
  await option(page, /Dark theme/).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill("match system");
  await page.keyboard.press("Enter");
});

test("models are chosen from the palette, or straight away with their shortcut", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Shift+KeyL");
  const models = page.getByRole("dialog", { name: "Choose a model" });
  await expect(models).toBeVisible();
  await expect(option(page, /fake:latest/)).toHaveAttribute("aria-current", "true");
  await modelInput(page).fill("seer");
  await page.keyboard.press("Enter");
  await expect(modelPicker(page)).toContainText("seer:latest");

  // From the palette: "Change model…" opens the same list; Backspace goes back.
  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill("change model");
  await page.keyboard.press("Enter");
  await expect(modelInput(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(paletteInput(page)).toBeVisible();
  await paletteInput(page).fill("fake:lat");
  await page.keyboard.press("Enter");
  await expect(modelPicker(page)).toContainText("fake:latest");
});

test("shortcuts: new chat, regenerate, stop, focus, search and the list of shortcuts", async ({ page }) => {
  await openApp(page);
  const text = unique("keys");
  await startChat(page, text);

  // Regenerate the latest reply.
  await page.keyboard.press("ControlOrMeta+Alt+KeyR");
  await expect(lastReply(page).getByText("2/2")).toBeVisible();
  await expect(sendButton(page)).toBeVisible();

  // Focus the message box from anywhere, and search.
  await page.keyboard.press("ControlOrMeta+Shift+KeyF");
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeFocused();
  await page.keyboard.press("Shift+Escape");
  await expect(composer(page)).toBeFocused();

  // A new chat.
  await page.keyboard.press("ControlOrMeta+Shift+KeyO");
  await expect(userMessages(page)).toHaveCount(0);
  await expect(chatTitle(page)).toHaveText("New chat");

  // Escape stops a reply.
  await chooseModel(page, "slow:latest");
  await send(page, unique("long")); // the slow model takes 4 s over it
  await expect(stopButton(page)).toBeVisible();
  await expect(lastReply(page)).not.toBeEmpty();
  await page.keyboard.press("Escape");
  await expect(sendButton(page)).toBeVisible();

  // The list of shortcuts.
  await page.keyboard.press("ControlOrMeta+Slash");
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list).toBeVisible();
  await expect(list.getByText("Command palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
});
