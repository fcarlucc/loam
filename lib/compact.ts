import type { ModelMessage } from "./engines";
import type { ChatMessage } from "./types";

// Compacting a chat: the model summarizes the older part of a branch, and from then on reads that summary
// instead of those messages. The summary is kept on the last message it covers (messages.summary), so it
// belongs to the branches that go through that message and to no other.

// The context assumed when nothing tells it: the page doesn't know what the engine loaded (OpenAI-compatible
// servers don't say) and the chat sets none.
export const DEFAULT_CONTEXT = 4096;

const SUMMARY_HEADING =
  "Summary of the earlier part of this conversation. The messages it covers were replaced by it to save room; go on from it as if you had read them:";

// Where the model's view of a branch starts: after the last message carrying a summary, with that summary.
export function compactedView<T extends Pick<ChatMessage, "summary">>(path: T[]) {
  const at = path.findLastIndex((m) => m.summary);
  return { summary: at < 0 ? undefined : path[at].summary, messages: path.slice(at + 1) };
}

// The system message: the chat's own instructions, then the summary.
export function systemContent(system: string | undefined, summary: string | undefined) {
  return [system, summary && `${SUMMARY_HEADING}\n\n${summary}`].filter(Boolean).join("\n\n") || undefined;
}

// Which messages a compaction covers, as indexes into the branch: from the first one not summarized yet, up
// to the reply before the latest exchange, which stays as it is. When there is nothing older, the whole
// branch is summarized. It always ends on a reply, so a message waiting for one is never folded away.
// Null when there is nothing to summarize.
export function compactionRange(path: Pick<ChatMessage, "role" | "summary">[]) {
  const start = path.findLastIndex((m) => m.summary) + 1;
  const lastQuestion = path.findLastIndex((m) => m.role === "user");
  let end = lastQuestion - 1 >= start ? lastQuestion - 1 : path.length - 1;
  while (end >= start && path[end].role !== "assistant") end--;
  return end >= start ? { start, end } : null;
}

// Characters of conversation per summarizing request, for a model reading `contextTokens` at most: room is
// kept for the instructions, the summary so far and the new summary. Three characters per token, to be safe
// for English, Italian and code; Chinese, Japanese or Korean text runs closer to one, so a piece of it can be
// up to three times too long for the context and the engine cuts it.
export function chunkBudget(contextTokens: number, summaryTokens: number) {
  return Math.max(2000, (contextTokens - 2 * summaryTokens - 400) * 3);
}

// A message as a line of the transcript; one longer than the budget keeps its beginning and its end.
function line(m: ModelMessage, max: number) {
  const who = m.role === "user" ? "User" : "Assistant";
  const pictures = m.images?.length ? ` [${m.images.length} image${m.images.length > 1 ? "s" : ""}]` : "";
  let text = m.content;
  if (text.length > max) {
    const half = Math.floor((max - 20) / 2);
    text = `${text.slice(0, half)}\n[… cut …]\n${text.slice(-half)}`;
  }
  return `${who}: ${text}${pictures}`;
}

// The transcript in pieces of at most `budget` characters, cut between messages.
export function chunks(messages: ModelMessage[], budget: number) {
  const out: string[] = [];
  let current = "";
  for (const m of messages) {
    const next = line(m, budget);
    if (current && current.length + next.length + 2 > budget) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${next}` : next;
  }
  if (current) out.push(current);
  return out;
}

// One summarizing request: the summary so far (if any) and the next piece of the conversation.
export function summaryPrompt(previous: string | undefined, transcript: string) {
  return [
    "Summarize the conversation below, so that it can go on from your summary alone. Keep what is needed to continue: the user's goals, requests and preferences, facts, names and numbers, decisions taken, open questions, and any code or text still being worked on (word for word when it is short). Write compact notes in the language of the conversation, with no preamble.",
    ...(previous ? [`Summary of what came before:\n${previous}`] : []),
    `Conversation:\n${transcript}`,
  ].join("\n\n");
}
