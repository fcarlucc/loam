// Branching a chat from a reply into a new chat, and the way back.
import { expect, test } from "./fixtures";
import { ask, chatInSidebar, chatTitle, clickHidden, lastReply, openApp, replies, startChat, unique, userMessages } from "./helpers";

test("a chat can be branched from a reply, and the branch links back to it", async ({ page }) => {
  await openApp(page);
  const root = unique("root");
  const more = unique("more");
  const extra = unique("extra");
  await startChat(page, root);
  await ask(page, more);
  await expect(replies(page)).toHaveCount(2);

  // Branch from the first reply: the new chat opens with the exchange up to that reply.
  const first = replies(page).first();
  await clickHidden(first, first.getByRole("button", { name: "Branch" }));
  await expect(chatTitle(page)).toHaveText(`Branch · ${root}`);
  await expect(chatInSidebar(page, `Branch · ${root}`)).toHaveAttribute("aria-current", "page");
  await expect(replies(page)).toHaveCount(1);
  await expect(lastReply(page)).toContainText(root);
  await expect(page.getByText(more)).toHaveCount(0);
  await expect(page.getByText("Branched from")).toBeVisible();

  // The branch goes on by itself.
  await ask(page, extra);
  await expect(replies(page)).toHaveCount(2);

  // "Branched from" leads back to the chat it came from, which is as it was.
  await page.getByRole("main").getByRole("button", { name: root, exact: true }).click();
  await expect(chatTitle(page)).toHaveText(root);
  await expect(chatInSidebar(page, root)).toHaveAttribute("aria-current", "page");
  await expect(replies(page)).toHaveCount(2);
  await expect(userMessages(page).last()).toContainText(more);
  await expect(page.getByText(extra)).toHaveCount(0);
  await expect(page.getByText("Branched from")).toHaveCount(0);
});
