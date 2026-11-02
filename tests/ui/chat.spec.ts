// Sending a message, watching the reply stream, stopping it; regenerating a reply and editing a sent
// message, with the versions this keeps (◀ 2/2 ▶).
import { expect, test } from "./fixtures";
import {
  ask,
  chatInSidebar,
  chatTitle,
  chooseModel,
  clickHidden,
  composer,
  lastReply,
  openApp,
  replies,
  requestsFor,
  say,
  send,
  sendButton,
  startChat,
  stopButton,
  unique,
  userMessages,
} from "./helpers";

test.describe("sending a message", () => {
  test("the message is sent, the reply comes back and the chat is named", async ({ page }) => {
    await openApp(page);
    const text = unique("hello");
    await send(page, say(text));
    await expect(userMessages(page).last()).toContainText(say(text));
    await expect(composer(page)).toHaveValue("");
    await expect(lastReply(page)).toContainText(text);
    await expect(sendButton(page)).toBeVisible();
    await expect(lastReply(page)).toContainText(/tok\/s · \d+ tokens/);
    // Named after the first exchange, in the header and in the list.
    await expect(chatTitle(page)).toHaveText(text);
    await expect(chatInSidebar(page, text)).toHaveAttribute("aria-current", "page");
  });

  test("a long reply streams in word by word", async ({ page }) => {
    await openApp(page);
    await chooseModel(page, "slow:latest");
    await send(page, unique("count"));
    await expect(stopButton(page)).toBeVisible();
    await expect(lastReply(page)).toContainText("tick 3");
    await expect(lastReply(page)).not.toContainText("tick 80");
    await expect(lastReply(page)).toContainText("tick 80");
    await expect(sendButton(page)).toBeVisible();
  });

  test("a reply can be stopped midway, and what was written stays", async ({ page, ollama }) => {
    await openApp(page);
    await chooseModel(page, "slow:latest");
    const text = unique("stop");
    await send(page, text);
    await expect(lastReply(page)).toContainText("tick 5");
    await stopButton(page).click();
    await expect(sendButton(page)).toBeVisible();
    const ticks = (await lastReply(page).innerText()).match(/tick \d+/g) ?? [];
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks.length).toBeLessThan(80);
    // The partial reply is saved like any other: it can be regenerated, and Ollama was told to stop.
    await expect(lastReply(page).getByRole("button", { name: "Regenerate" })).toBeEnabled();
    await expect.poll(() => requestsFor(ollama, text).at(-1)?.aborted).toBe(true);
    await expect(lastReply(page)).toContainText(ticks.at(-1)!);
    await expect(lastReply(page)).not.toContainText("tick 80");
  });
});

test.describe("versions", () => {
  test("regenerating a reply keeps both versions, one click apart", async ({ page, ollama }) => {
    await openApp(page);
    const text = unique("again");
    await startChat(page, text);
    expect(requestsFor(ollama, say(text))).toHaveLength(1);
    await lastReply(page).getByRole("button", { name: "Regenerate" }).click();
    await expect(lastReply(page).getByText("2/2", { exact: true })).toBeVisible();
    await expect(sendButton(page)).toBeVisible();
    await expect(replies(page)).toHaveCount(1);
    expect(requestsFor(ollama, say(text))).toHaveLength(2);

    const previous = lastReply(page).getByRole("button", { name: "Previous version" });
    const next = lastReply(page).getByRole("button", { name: "Next version" });
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(lastReply(page).getByText("1/2", { exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(lastReply(page).getByText("2/2", { exact: true })).toBeVisible();
  });

  test("editing a sent message starts a new version, with the original one click away", async ({ page }) => {
    await openApp(page);
    const first = unique("one");
    const second = unique("two");
    await startChat(page, first);

    const message = userMessages(page).last();
    await clickHidden(message, message.getByRole("button", { name: "Edit" }));
    const editor = page.getByRole("textbox", { name: "Edit message" });
    await expect(editor).toHaveValue(say(first));
    await editor.fill(say(second));
    await editor.press("Enter");

    await expect(userMessages(page).last()).toContainText(say(second));
    await expect(lastReply(page)).toContainText(second);
    await expect(sendButton(page)).toBeVisible();
    await expect(userMessages(page)).toHaveCount(1);
    await expect(replies(page)).toHaveCount(1);
    await expect(userMessages(page).last().getByText("2/2", { exact: true })).toBeVisible();

    await userMessages(page).last().getByRole("button", { name: "Previous version" }).click();
    await expect(userMessages(page).last()).toContainText(say(first));
    await expect(lastReply(page)).toContainText(first);
    await expect(userMessages(page).last().getByText("1/2", { exact: true })).toBeVisible();
  });

  test("editing can be cancelled", async ({ page }) => {
    await openApp(page);
    const text = unique("keep");
    await ask(page, text);
    const message = userMessages(page).last();
    await clickHidden(message, message.getByRole("button", { name: "Edit" }));
    await page.getByRole("textbox", { name: "Edit message" }).press("Escape");
    await expect(page.getByRole("textbox", { name: "Edit message" })).toHaveCount(0);
    await expect(userMessages(page).last()).toContainText(say(text));
  });
});
