// Text files and images attached to a message, shown with it once sent.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseModel, lastReply, openApp, png, say, send, sendButton, unique, userMessages } from "./helpers";

const attachButton = (page: Page) => page.getByRole("button", { name: "Attach files" });

async function attach(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await attachButton(page).click();
  await (await chooser).setFiles(file);
}

test("a text file is attached, shown in the composer and sent with the message", async ({ page, ollama }) => {
  await openApp(page);
  const text = unique("file");
  await attach(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Remember the milk.\n") });
  await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeVisible();
  await expect(page.getByText("notes.txt")).toBeVisible();

  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();
  const link = userMessages(page).last().getByRole("link", { name: /notes\.txt/ });
  await expect(link).toHaveAttribute("href", /^\/api\/attachments\/\d+$/);
  await expect(page.getByRole("button", { name: "Remove notes.txt" })).toHaveCount(0);
  const saved = await page.request.get((await link.getAttribute("href"))!);
  expect(saved.ok()).toBe(true);
  expect(await saved.text()).toBe("Remember the milk.\n");
  // The model got the file inside the message.
  const sent = ollama.chats().find((r) => r.body.messages?.at(-1)?.content.includes("--- Attached file: notes.txt ---"));
  expect(sent?.body.messages?.at(-1)?.content).toContain("Remember the milk.");
});

test("an attached file can be removed before sending", async ({ page }) => {
  await openApp(page);
  await attach(page, { name: "draft.md", mimeType: "text/markdown", buffer: Buffer.from("# Draft\n") });
  await page.getByRole("button", { name: "Remove draft.md" }).click();
  await expect(page.getByText("draft.md")).toHaveCount(0);
});

test("an image is attached for a model that can see, and shown in the sent message", async ({ page, ollama }) => {
  await openApp(page);
  await chooseModel(page, "seer:latest");
  const text = unique("look");
  await attach(page, { name: "dot.png", mimeType: "image/png", buffer: png(16, 16) });
  const preview = page.getByRole("img", { name: "dot.png" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);

  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();
  const image = userMessages(page).last().getByRole("img", { name: "dot.png" });
  await expect(image).toHaveAttribute("src", /^\/api\/attachments\/\d+$/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(16);
  const sent = ollama.chats().find((r) => r.body.messages?.some((m) => m.images?.length));
  expect(sent?.body.model).toBe("seer:latest");
  expect(sent?.body.messages?.at(-1)?.images).toHaveLength(1);
});

test("an image is refused for a model that can't see", async ({ page }) => {
  await openApp(page);
  await expect(attachButton(page)).toHaveAttribute("title", "Attach text files (this model can't see images)");
  await attach(page, { name: "dot.png", mimeType: "image/png", buffer: png(16, 16) });
  const refusal = page.getByRole("alert").filter({ hasText: "dot.png: this model can't see images" });
  await expect(refusal).toBeVisible();
  await expect(page.getByRole("img", { name: "dot.png" })).toHaveCount(0);
  await refusal.getByRole("button", { name: "Dismiss" }).click();
  await expect(refusal).toHaveCount(0);
});
