// Ollama going away and coming back, as the page shows it.
import { expect, test } from "./fixtures";
import { composer, lastReply, modelPicker, ollamaStatus, openApp, say, send, sendButton, unique } from "./helpers";

test("when Ollama is offline the app says so, and recovers when it is back", async ({ page, ollama }) => {
  await openApp(page);
  await expect(page.getByText("Your local model is ready.")).toBeVisible();
  try {
    await ollama.pause();
    // The status is polled every few seconds.
    await expect(ollamaStatus(page)).toHaveText("Ollama is stopped", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Start Ollama" })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
    await expect(composer(page)).toHaveAttribute("placeholder", "Start Ollama to write");
    await expect(sendButton(page)).toBeDisabled();
    await expect(page.getByText("Ollama is stopped: start it from the sidebar to begin.")).toBeVisible();
  } finally {
    await ollama.resume();
  }
  await expect(ollamaStatus(page)).toHaveText("Ollama is running", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Stop Ollama" })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByText("Your local model is ready.")).toBeVisible();
  await expect(modelPicker(page)).toContainText(/:latest$/);

  const text = unique("back");
  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();
});
