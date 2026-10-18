import { DEFAULT_TITLE } from "./db";

// Cuts text on a character boundary, with an ellipsis when something was left out.
function cut(text: string, max: number) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

// The title a chat is created with: its first message, whitespace collapsed, cut short. A placeholder
// until the model names the chat (see /api/chats/[id]/title).
export function makeTitle(content: string) {
  return cut(content.replace(/\s+/g, " "), 48);
}

// Whether a chat still carries the title it was created with, so the model may name it.
export const isPlaceholderTitle = (title: string, firstMessage: string) => title === DEFAULT_TITLE || title === makeTitle(firstMessage);

const EXCERPT = 1500; // characters of each message shown to the model

// Asks for a title in the conversation's language. The exchange is quoted inside one user message rather
// than replayed as the conversation itself, so the model names it instead of continuing it.
export function titlePrompt(question: string, answer: string | undefined) {
  return [
    "Write a title for the conversation below: at most six words, in the language of the conversation, no quotes and no final period. Reply with the title only.",
    `User: ${cut(question, EXCERPT)}`,
    ...(answer ? [`Assistant: ${cut(answer, EXCERPT)}`] : []),
  ].join("\n\n");
}

// Turns what the model wrote into a title: its first line, without the wrappers models add anyway
// (markdown, "Title:", quotes, a final period), cut short. Empty when nothing usable came back.
export function cleanTitle(raw: string) {
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = line
    .replace(/[*_`#]/g, "")
    .replace(/^[\s"'“”‘’«»]+/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[\s"'“”‘’«»]+/, "")
    .replace(/[\s"'“”‘’«».。]+$/, "")
    .replace(/\s+/g, " ");
  return cut(title, 60);
}
