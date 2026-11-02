// The app as the tests see it: where things are and how to wait for them.
import { expect, type Locator, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import type { ApiClient, FakeOllama } from "./fixtures";

// Text no other test uses, so a chat, a message or a reply can be told apart in the sidebar and in search.
export const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// What the fake Ollama answers to a message carrying this (see tests/e2e/helpers/fake-ollama.mjs). It names
// the chat with the same text, since the title prompt quotes the message.
export const say = (text: string) => `<<say: ${text}>>`;

export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
export const sendButton = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
export const stopButton = (page: Page) => page.getByRole("button", { name: "Stop generating" });
export const chatTitle = (page: Page) => page.getByTestId("chat-title");
export const userMessages = (page: Page) => page.getByTestId("user-message");
export const replies = (page: Page) => page.getByTestId("assistant-message");
export const lastReply = (page: Page) => replies(page).last();
export const modelPicker = (page: Page) => page.getByTitle("Choose model");
export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Saved chats" });
export const chatInSidebar = (page: Page, title: string) => sidebar(page).getByRole("button", { name: title, exact: true });
export const ollamaStatus = (page: Page) => page.getByText(/^Ollama is (running|stopped)$/);

// Opens the app on a new chat, ready to send: Ollama is up and a model is selected.
export async function openApp(page: Page) {
  await page.goto("/");
  await expect(ollamaStatus(page)).toHaveText("Ollama is running");
  await expect(modelPicker(page)).toContainText(/:latest$/);
  await expect(composer(page)).toBeEnabled();
}

export async function chooseModel(page: Page, name: string) {
  await modelPicker(page).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(modelPicker(page)).toContainText(name);
}

// Types a message and sends it with Enter.
export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

// Sends a scripted message and waits until its reply is in.
export async function ask(page: Page, text: string) {
  await send(page, say(text));
  await expect(lastReply(page)).toContainText(text);
  await expect(sendButton(page)).toBeVisible();
}

// The first exchange of a chat: once the reply is in, the model names the chat after it.
export async function startChat(page: Page, text: string) {
  await ask(page, text);
  await expect(chatTitle(page)).toHaveText(text);
  await expect(chatInSidebar(page, text)).toHaveAttribute("aria-current", "page");
}

// A chat with scripted messages, created through the API; `model` is the fake's "fake:latest" unless given.
// Returns the chat id and the messages on its branch.
export async function seedChat(api: ApiClient, exchanges: string[], model = "fake:latest") {
  let chatId: number | null = null;
  for (const text of exchanges) {
    const res = await api.post("/api/chat", { chatId, model, settings: {}, content: say(text) });
    expect(res.ok, `seeding "${text}"`).toBe(true);
    chatId = Number(res.headers.get("X-Chat-Id"));
    await res.text(); // the whole reply, so the message is saved before the next one
  }
  const { messages } = (await (await api.get(`/api/chats/${chatId}`)).json()) as { messages: { id: number; role: string; content: string }[] };
  return { id: chatId!, messages };
}

// The requests the fake Ollama got for a message: one per reply (a regenerated reply asks again).
// Looked up by the message, since a request from an earlier test (naming its chat) may land late.
export const requestsFor = (ollama: FakeOllama, content: string) =>
  ollama.chats().filter((r) => r.body.stream !== false && r.body.messages?.at(-1)?.content === content);

// Clicks a button that shows on hover (edit, rename, delete): hover its row first, so it is there to click.
export async function clickHidden(row: Locator, button: Locator) {
  await row.hover();
  await button.click();
}

// A small solid PNG (width x height, one color), decodable by the browser.
export function png(width: number, height: number, [r, g, b] = [220, 40, 40]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
