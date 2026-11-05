// Keyboard shortcuts and the command palette: ⌘K on a Mac, Ctrl+K elsewhere.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  ask,
  chatTitle,
  chooseModel,
  composer,
  lastReply,
  modelPicker,
  openApp,
  replies,
  send,
  sendButton,
  startChat,
  stopButton,
  unique,
  userMessages,
} from "./helpers";

// The page picks ⌘ or Ctrl from the platform it reports, and the test browser reports Windows (Playwright's
// "Desktop Chrome") whatever it runs on. So each test says which platform the page sees, and presses its keys.
async function as(page: Page, platform: "mac" | "pc") {
  await page.addInitScript((mac) => {
    Object.defineProperty(navigator, "platform", { get: () => (mac ? "MacIntel" : "Win32") });
    Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: mac ? "macOS" : "Windows" }) });
  }, platform === "mac");
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: Page) => page.getByRole("combobox", { name: "Command", exact: true });
const modelInput = (page: Page) => page.getByRole("dialog").getByRole("combobox", { name: "Model", exact: true });
const option = (page: Page, name: string | RegExp) => page.getByRole("option", { name });

test("the palette finds commands and chats, and runs them from the keyboard", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  const title = unique("palette");
  await startChat(page, title);
  await composer(page).focus();

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  // Escape closes it, and the focus goes back where it was.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(composer(page)).toBeFocused();

  await page.keyboard.press("Meta+k");
  await paletteInput(page).fill("usage");
  await expect(option(page, /Usage & benchmark/)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Usage & benchmark" })).toBeVisible();

  // A chat, found by its title: the arrows move through the results, Enter opens one.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.keyboard.press("Meta+k");
  await paletteInput(page).fill(title.split(" ")[1]);
  await expect(option(page, title)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(option(page, title)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(chatTitle(page)).toHaveText(title);
  await expect(userMessages(page)).toHaveCount(1);

  // A click works too; nothing matching says so.
  await page.keyboard.press("Meta+k");
  await paletteInput(page).fill("zzzz no such thing");
  await expect(palette(page).getByText("Nothing matches.")).toBeVisible();
  await paletteInput(page).fill("dark theme");
  await option(page, /Dark theme/).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Meta+k");
  await paletteInput(page).fill("match system");
  await page.keyboard.press("Enter");
});

test("models are chosen from the palette, or straight away with their shortcut", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  await page.keyboard.press("Meta+Shift+KeyL");
  const models = page.getByRole("dialog", { name: "Choose a model" });
  await expect(models).toBeVisible();
  await expect(option(page, /fake:latest/)).toHaveAttribute("aria-current", "true");
  await modelInput(page).fill("seer");
  await page.keyboard.press("Enter");
  await expect(modelPicker(page)).toContainText("seer:latest");

  // From the palette: "Change model…" opens the same list; Backspace goes back.
  await page.keyboard.press("Meta+k");
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
  await as(page, "mac");
  await openApp(page);
  const text = unique("keys");
  await startChat(page, text);

  // Regenerate the latest reply.
  await page.keyboard.press("Meta+Alt+KeyR");
  await expect(lastReply(page).getByText("2/2")).toBeVisible();
  await expect(sendButton(page)).toBeVisible();

  // Focus the message box from anywhere, and search.
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeFocused();
  await page.keyboard.press("Shift+Escape");
  await expect(composer(page)).toBeFocused();

  // A new chat.
  await page.keyboard.press("Meta+Shift+KeyO");
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
  await page.keyboard.press("Meta+Slash");
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list).toBeVisible();
  await expect(list.getByText("Command palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
});

test("off a Mac, the shortcuts use Ctrl, not ⌘", async ({ page }) => {
  await as(page, "pc");
  await openApp(page);
  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(option(page, /New chat/)).toContainText("Ctrl+Shift+O");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+KeyO");
  await expect(chatTitle(page)).toHaveText("New chat");
});

test("on a Mac, Ctrl+K does nothing", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  await composer(page).focus();
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(option(page, /New chat/)).toContainText("⇧⌘O");
});

test("Escape that closes or clears something else doesn't stop the reply", async ({ page, ollama }) => {
  await as(page, "mac");
  await openApp(page);
  await chooseModel(page, "slow:latest");
  const text = unique("keeps going");
  await send(page, text);
  await expect(lastReply(page)).toContainText("tick 2");

  // Clearing the sidebar's search with Escape leaves the reply streaming.
  const search = page.getByRole("searchbox", { name: "Search chats" });
  await search.fill("something");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(lastReply(page)).toContainText("tick 30");
  await expect(stopButton(page)).toBeVisible();
  const [request] = ollama.chats().filter((r) => r.body.messages?.at(-1)?.content === text);
  expect(request.aborted).toBe(false);

  // From the message box, Escape stops it.
  await composer(page).press("Escape");
  await expect(sendButton(page)).toBeVisible();
  await expect.poll(() => request.aborted).toBe(true);
});

test("the shortcuts list opens with ⌘/ wherever / is on the keyboard", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const press = (init: { key: string; code: string; shiftKey?: boolean; metaKey?: boolean }) =>
    page.evaluate((init) => document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })), init);

  // An Italian keyboard: the US "/" key types "-" (that's ⌘- to zoom out, left to the browser)…
  await press({ key: "-", code: "Slash", metaKey: true });
  await expect(list).toHaveCount(0);
  // …and "/" is ⇧7.
  await press({ key: "/", code: "Digit7", shiftKey: true, metaKey: true });
  await expect(list).toBeVisible();
});

test("the palette opens the chat settings and the other screens and dialogs", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  const run = async (query: string) => {
    await page.keyboard.press("Meta+k");
    await paletteInput(page).fill(query);
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
  };

  await run("chat settings");
  await expect(page.getByRole("button", { name: /^Chat settings/ })).toHaveAttribute("aria-expanded", "true");
  await run("chat settings");
  await expect(page.getByRole("button", { name: /^Chat settings/ })).toHaveAttribute("aria-expanded", "false");

  await run("compare");
  await expect(page.getByRole("heading", { name: "Compare models" })).toBeVisible();
  await run("engines");
  await expect(page.getByRole("dialog", { name: /Engines/ })).toBeVisible();
});

test("the palette starts a temporary chat, from a chat or from another screen", async ({ page, api }) => {
  await as(page, "mac");
  await openApp(page);
  const chatsBefore = (await (await api.get("/api/chats")).json()).chats.length;
  const run = async (query: string) => {
    await page.keyboard.press("Meta+k");
    await paletteInput(page).fill(query);
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
  };

  await startChat(page, unique("saved"));
  await run("new temporary");
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Temporary chat" })).toHaveAttribute("aria-pressed", "true");
  await expect(userMessages(page)).toHaveCount(0);

  // From another screen it opens the chat first; and the conversation stays unsaved.
  await run("compare");
  await run("new temporary");
  await expect(page.getByRole("heading", { name: "Temporary chat" })).toBeVisible();
  await page.keyboard.press("Shift+Escape");
  await ask(page, unique("unsaved"));
  await expect(page.getByTestId("temporary-badge")).toBeVisible();
  expect((await (await api.get("/api/chats")).json()).chats.length).toBe(chatsBefore + 1);
});

test("in a temporary chat, Escape stops the reply and the shortcuts reach the chat", async ({ page }) => {
  await as(page, "mac");
  await openApp(page);
  await page.getByRole("button", { name: "Temporary chat" }).click();
  await ask(page, unique("first"));
  await page.keyboard.press("Meta+Alt+KeyR");
  await expect(sendButton(page)).toBeVisible();
  await expect(replies(page)).toHaveCount(1);

  await chooseModel(page, "slow:latest");
  await send(page, unique("long"));
  await expect(lastReply(page)).toContainText("tick 2");
  await composer(page).press("Escape");
  await expect(sendButton(page)).toBeVisible();
  await expect(lastReply(page)).not.toContainText("tick 80");
});
