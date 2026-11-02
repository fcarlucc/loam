// What a reasoning model thought, in a fold-out block under its reply.
import { expect, test } from "./fixtures";
import { chooseModel, lastReply, openApp, requestsFor, say, send, sendButton, unique } from "./helpers";

test("a reasoning model's thoughts fold out under the reply", async ({ page, ollama }) => {
  await openApp(page);
  await chooseModel(page, "thinker:latest");
  const text = unique("deep");
  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();

  // Folded once the reply is in, with the time spent; a click shows what was thought.
  const fold = lastReply(page).getByRole("button", { name: /^Thought for [\d.]+ s$/ });
  await expect(fold).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(lastReply(page)).not.toContainText("Thinking about:");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(lastReply(page)).toContainText(`Thinking about: ${say(text)}`);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(lastReply(page)).not.toContainText("Thinking about:");
  expect(requestsFor(ollama, say(text))[0]?.body.think).toBeUndefined();
});

test("reasoning can be turned off for a chat", async ({ page, ollama }) => {
  await openApp(page);
  await chooseModel(page, "thinker:latest");
  const picker = page.getByRole("combobox", { name: "Reasoning" });
  await expect(picker).toBeVisible();
  await picker.selectOption({ label: "Reasoning off" });
  const text = unique("plain");
  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();
  await expect(lastReply(page).getByRole("button", { name: /^Thought for/ })).toHaveCount(0);
  expect(requestsFor(ollama, say(text))[0]?.body.think).toBe(false);
});
