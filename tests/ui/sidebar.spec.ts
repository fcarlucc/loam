// The chat list: renaming, deleting, and full-text search across every message.
import { expect, test } from "./fixtures";
import { chatInSidebar, chatTitle, clickHidden, openApp, seedChat, sidebar, startChat, unique } from "./helpers";

test("a chat can be renamed from the sidebar", async ({ page }) => {
  await openApp(page);
  const title = unique("name me");
  const renamed = unique("renamed");
  await startChat(page, title);

  await clickHidden(chatInSidebar(page, title), page.getByRole("button", { name: `Rename chat "${title}"` }));
  const input = page.getByRole("textbox", { name: "Chat title" });
  await expect(input).toHaveValue(title);
  await input.fill(renamed);
  await input.press("Enter");

  await expect(chatInSidebar(page, renamed)).toHaveAttribute("aria-current", "page");
  await expect(chatInSidebar(page, title)).toHaveCount(0);
  await expect(chatTitle(page)).toHaveText(renamed);

  await page.reload();
  await expect(chatInSidebar(page, renamed)).toBeVisible();
});

test("deleting a chat asks first, then removes it for good", async ({ page }) => {
  await openApp(page);
  const title = unique("delete me");
  await startChat(page, title);
  const deleteButton = page.getByRole("button", { name: `Delete chat "${title}"` });
  const confirm = page.getByRole("group", { name: `Delete chat "${title}"?` });

  await clickHidden(chatInSidebar(page, title), deleteButton);
  await expect(confirm).toContainText("Delete this chat?");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(chatInSidebar(page, title)).toBeVisible();

  await clickHidden(chatInSidebar(page, title), deleteButton);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(chatInSidebar(page, title)).toHaveCount(0);
  // The deleted chat was open: the app is back on a new chat.
  await expect(chatTitle(page)).toHaveText("New chat");
  await expect(page.getByRole("heading", { name: "How can I help?" })).toBeVisible();

  await page.reload();
  await expect(sidebar(page)).toBeVisible();
  await expect(chatInSidebar(page, title)).toHaveCount(0);
});

test("full-text search opens the right chat at the right message", async ({ page, api }) => {
  // A long chat, so the message searched for is out of view once the chat opens at its end.
  const needle = unique("needle").replace(/\s/g, "");
  const filler = (n: number) => Array.from({ length: 90 }, (_, i) => `w${n}x${i}`).join(" ");
  const { id, messages } = await seedChat(api, [`${needle} ${filler(0)}`, ...Array.from({ length: 7 }, (_, i) => filler(i + 1))]);
  const { chats } = (await (await api.get("/api/chats")).json()) as { chats: { id: number; title: string }[] };
  const title = chats.find((c) => c.id === id)!.title;

  await openApp(page);
  await page.getByRole("searchbox", { name: "Search chats" }).fill(needle);
  const results = page.getByRole("list", { name: "Search results" });
  // The word is in the first message and in its reply: two hits, each quoting it.
  await expect(results.getByRole("listitem")).toHaveCount(2);
  const hit = results.getByRole("button").filter({ hasText: "· you" });
  await expect(hit).toContainText(title);
  await expect(hit.locator("mark")).toHaveText(needle);

  await hit.click();
  await expect(chatTitle(page)).toHaveText(title);
  await expect(page.locator(`[data-message-id="${messages[0].id}"]`)).toBeInViewport();
  await expect(page.locator(`[data-message-id="${messages.at(-1)!.id}"]`)).not.toBeInViewport();

  // Back to the list.
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(results).toHaveCount(0);
  await expect(chatInSidebar(page, title)).toHaveAttribute("aria-current", "page");
});
