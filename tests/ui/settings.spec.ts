// Per-chat settings: saved as they change, back after a reload, and sent to the model.
import { expect, test } from "./fixtures";
import { chatInSidebar, lastReply, openApp, requestsFor, send, sendButton, startChat, unique } from "./helpers";

test("the system prompt and temperature are saved and survive a reload", async ({ page, api, ollama }) => {
  await openApp(page);
  const title = unique("settings");
  await startChat(page, title);
  const settingsOf = async () => {
    const { chats } = (await (await api.get("/api/chats")).json()) as { chats: { title: string; settings: unknown }[] };
    return chats.find((c) => c.title === title)?.settings;
  };
  expect(await settingsOf()).toEqual({});

  await page.getByRole("button", { name: "Chat settings", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Chat settings" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^Model default \(/)).toBeVisible();
  await panel.getByLabel("System prompt").fill("Answer like a pirate");
  // The slider goes from 0 to 2 in steps of 0.1: to the end, then seven steps back.
  const slider = panel.getByLabel("Temperature");
  await slider.press("End");
  await expect(slider).toHaveValue("2");
  await expect(panel.getByText(/^2\.0/)).toBeVisible();
  for (let i = 0; i < 7; i++) await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("1.3");
  await expect(panel.getByText(/^1\.3/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat settings (customized)" })).toBeVisible();
  await expect.poll(settingsOf).toEqual({ system: "Answer like a pirate", temperature: 1.3 });

  await page.reload();
  await openApp(page);
  await chatInSidebar(page, title).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("System prompt")).toHaveValue("Answer like a pirate");
  await expect(panel.getByLabel("Temperature")).toHaveValue("1.3");
  await expect(page.getByRole("button", { name: "Chat settings (customized)" })).toBeVisible();

  // Both reach the model: the fake echoes the system prompt it was given.
  await send(page, "ahoy");
  await expect(lastReply(page)).toContainText("system=Answer like a pirate");
  await expect(sendButton(page)).toBeVisible();
  expect(requestsFor(ollama, "ahoy").at(-1)?.body.options?.temperature).toBe(1.3);

  await panel.getByRole("button", { name: "Reset to model defaults" }).click();
  await expect(panel.getByLabel("System prompt")).toHaveValue("");
  await expect.poll(settingsOf).toEqual({});
});

test("the panel closes with its button and reopens where it was", async ({ page }) => {
  await openApp(page);
  const panel = page.getByRole("complementary", { name: "Chat settings" });
  await page.getByRole("button", { name: "Chat settings", exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close chat settings" }).click();
  await expect(panel).toBeHidden();
  await page.reload();
  await openApp(page);
  await expect(panel).toBeHidden();
});
