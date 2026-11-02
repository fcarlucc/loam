// Light, dark and system themes, kept across reloads.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openApp } from "./helpers";

const html = (page: Page) => page.locator("html");
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("light, dark and system themes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  const theme = page.getByRole("group", { name: "Theme" });
  const light = theme.getByRole("button", { name: "Light theme" });
  const dark = theme.getByRole("button", { name: "Dark theme" });
  const system = theme.getByRole("button", { name: "Match system" });

  // Fresh: follows the system, which is light.
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  const lightBackground = await background(page);

  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(system).toHaveAttribute("aria-pressed", "false");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => background(page)).not.toBe(lightBackground);

  // The choice is kept, and applied before the page is painted.
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect.poll(() => background(page)).toBe(lightBackground);

  // An explicit theme ignores the system; "Match system" follows it, and follows it changing.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await system.click();
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});
