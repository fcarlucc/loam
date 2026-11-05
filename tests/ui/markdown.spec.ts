// Math and diagrams in replies: formulas drawn with KaTeX, ```mermaid blocks drawn as diagrams, all of it
// from the app itself, and nothing in a reply able to make the page load something from outside.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseModel, lastReply, openApp, replies, say, send, sendButton, stopButton } from "./helpers";

// Sends a scripted reply and waits until it is in. Not `ask`: drawn math doesn't read as the text it came from.
async function reply(page: Page, text: string) {
  const message = replies(page).nth(await replies(page).count());
  await send(page, say(text));
  await expect(message).toContainText(/tok\/s/);
  await expect(sendButton(page)).toBeVisible();
  return message;
}

const mermaid = (code: string) => ["```mermaid", code, "```"].join("\n");
const note = "Couldn't draw this diagram";
// Elements Mermaid draws in on the page, outside the reply.
const strayElements = (page: Page) => page.locator("body > [id^='dmermaid'], body > [id^='imermaid'], body > svg[id^='mermaid']");

test("math is drawn, whichever way the model writes it", async ({ page }) => {
  await openApp(page);
  const message = await reply(
    page,
    [
      "Inline $E = mc^2$ and \\(a^2 + b^2 = c^2\\) in a sentence.",
      "",
      "$$\\int_0^1 x \\, dx = \\frac{1}{2}$$",
      "",
      "\\[ \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} \\]",
      "",
      "It costs $5 and $10, or $2^n$ at most.",
    ].join("\n"),
  );
  await expect(message.locator(".katex-display")).toHaveCount(2);
  await expect(message.locator(".katex")).toHaveCount(5);
  await expect(message.locator("p", { hasText: "Inline" }).locator(".katex")).toHaveCount(2);
  await expect(message.locator(".katex-display").first()).toContainText("1");
  // Prices stay text; a formula next to them is still drawn.
  const prices = message.locator("p", { hasText: "It costs" });
  await expect(prices).toContainText("It costs $5 and $10, or");
  await expect(prices.locator(".katex")).toHaveCount(1);

  // KaTeX's fonts come from the app (the page can't reach anything else: see the noInternet fixture).
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((name) => /KaTeX/i.test(name)),
  );
  expect(fonts.length).toBeGreaterThan(0);
  for (const font of fonts) expect(new URL(font).origin).toBe(new URL(page.url()).origin);
});

test("math in code stays code, and a formula that doesn't parse shows as text", async ({ page }) => {
  await openApp(page);
  const message = await reply(
    page,
    ["```latex", "$x^2$ and \\(y\\)", "```", "", "Inline `$z$` code, then $\\frac{1}{$ broken."].join("\n"),
  );
  await expect(message.locator("pre")).toContainText("$x^2$ and \\(y\\)");
  await expect(message.locator("p code")).toHaveText("$z$");
  await expect(message.locator(".katex-display")).toHaveCount(0);
  await expect(message.locator(".katex-error")).toHaveText("\\frac{1}{");
  await expect(message.locator(".katex")).toHaveCount(0);
});

test("a mermaid block is drawn as a diagram, with the code a click away", async ({ page }) => {
  await openApp(page);
  const message = await reply(page, mermaid(["flowchart TD", "  A[Start] --> B[Done]"].join("\n")));
  const diagram = message.getByTestId("diagram").locator("svg");
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText("Start");
  await expect(diagram).toContainText("Done");
  await expect(message.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(message.getByText(note)).toHaveCount(0);

  const views = message.getByRole("group", { name: "Show as" });
  await views.getByRole("button", { name: "Code" }).click();
  await expect(views.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "true");
  await expect(diagram).toHaveCount(0);
  await expect(message.locator("pre")).toContainText("A[Start] --> B[Done]");
  await views.getByRole("button", { name: "Diagram" }).click();
  await expect(diagram).toBeVisible();
  await expect(message.locator("pre")).toHaveCount(0);

  // Redrawn in the app's theme when it changes.
  const lightId = await diagram.getAttribute("id");
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark theme" }).click();
  await expect(diagram).not.toHaveAttribute("id", lightId!);
  await expect(diagram).toContainText("Start");
  await expect(strayElements(page)).toHaveCount(0);
});

test("a diagram that doesn't parse shows its code and a note", async ({ page }) => {
  await openApp(page);
  const message = await reply(page, mermaid("flowchart TD\n  A[Start --> B("));
  await expect(message.getByText(note)).toBeVisible();
  await expect(message.locator("pre")).toContainText("A[Start --> B(");
  await expect(message.getByRole("group", { name: "Show as" })).toHaveCount(0);
  await expect(message.getByTestId("diagram")).toHaveCount(0);
  await expect(strayElements(page)).toHaveCount(0);
});

test("while a reply streams in, the diagram's code shows until it can be drawn", async ({ page }) => {
  await openApp(page);
  await chooseModel(page, "slow:latest");
  const lines = ["flowchart LR", ...Array.from({ length: 12 }, (_, i) => `  N${i} --> N${i + 1}`)];
  await send(page, say(["A diagram:", "", mermaid(lines.join("\n")), "", "That is all."].join("\n")));
  await expect(stopButton(page)).toBeVisible();
  await expect(lastReply(page).locator(".code-block")).toBeVisible();
  await expect(lastReply(page).getByText(note)).toHaveCount(0);
  await expect(lastReply(page)).toContainText("That is all.");
  await expect(sendButton(page)).toBeVisible();
  await expect(lastReply(page).getByTestId("diagram").locator("svg")).toContainText("N12");
  await expect(lastReply(page).getByText(note)).toHaveCount(0);
});

test("a diagram can't make the page load anything from outside", async ({ page }) => {
  await openApp(page);
  // Mermaid fetches a node's image while drawing: the page refuses it (and the noInternet fixture would catch
  // the request), so the diagram can't be drawn.
  const image = await reply(page, mermaid(['flowchart TD', '  A@{ img: "https://example.com/x.png", label: "Pic", pos: "t" }', "  A --> B"].join("\n")));
  await expect(image.getByText(note)).toBeVisible();
  await expect(image.locator("pre")).toContainText("https://example.com/x.png");

  // Images and links that point outside are taken out of the diagrams that can be drawn. (Not ->> for the
  // arrow: >> would end the scripted reply.)
  const sequence = await reply(
    page,
    mermaid(
      [
        "sequenceDiagram",
        "  participant A as Alice",
        "  participant B as Bob",
        '  properties A: {"icon": "https://example.com/i.png"}',
        '  links B: {"Home": "https://example.com/home"}',
        "  A->B: Hi",
      ].join("\n"),
    ),
  );
  const flowchart = await reply(page, mermaid(["flowchart TD", "  A[Link] --> B[Done]", '  click A href "https://example.com/page"'].join("\n")));
  for (const [message, label] of [
    [sequence, "Alice"],
    [flowchart, "Link"],
  ] as const) {
    const diagram = message.getByTestId("diagram").locator("svg");
    await expect(diagram).toContainText(label);
    expect(await diagram.evaluate((svg) => svg.outerHTML)).not.toContain("example.com");
    await expect(diagram.locator("image, img, a[href^='http']")).toHaveCount(0);
  }
});

test("KaTeX in a reply can't link or load anything", async ({ page }) => {
  await openApp(page);
  const message = await reply(page, "See $\\href{https://example.com}{here}$ and $\\includegraphics{https://example.com/x.png}$.");
  await expect(message.locator("a")).toHaveCount(0);
  await expect(message.locator("img")).toHaveCount(0);
});
