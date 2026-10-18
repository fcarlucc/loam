import type { NewAttachment } from "./types";

// Per message. The page resizes images to about 1024 px before sending, so a photo is a few hundred KB.
// Everything must stay well under 10 MB, the body size the request guard (proxy.ts) buffers.
export const MAX_ATTACHMENTS = 8;
export const MAX_TEXT_CHARS = 200_000; // per text file
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // per image
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]; // never SVG: it can carry scripts

const NAME_MAX = 120;

// A file name fit for display: no path, no control characters, cut short.
function cleanName(name: unknown) {
  if (typeof name !== "string") return "";
  const base = name.split(/[\\/]/).pop() ?? "";
  return Array.from(base.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, NAME_MAX).join("");
}

// Validates what the page sent. Returns the attachments, or the reason they can't be accepted.
export function parseAttachments(value: unknown): NewAttachment[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: "Invalid attachments" };
  if (value.length > MAX_ATTACHMENTS) return { error: `At most ${MAX_ATTACHMENTS} files per message` };
  const list: NewAttachment[] = [];
  let total = 0;
  for (const item of value) {
    const a = item as Partial<NewAttachment> | null;
    const name = cleanName(a?.name);
    if (!a || !name || typeof a.data !== "string" || typeof a.type !== "string" || a.type.length > 100) return { error: "Invalid attachments" };
    if (a.kind === "text") {
      if (a.data.length > MAX_TEXT_CHARS) return { error: `${name} is too large: text files may have ${MAX_TEXT_CHARS / 1000}K characters` };
      if (a.data.includes("\0")) return { error: `${name} isn't a text file` };
      total += Buffer.byteLength(a.data);
      list.push({ name, type: a.type, kind: "text", data: a.data });
    } else if (a.kind === "image") {
      if (!IMAGE_TYPES.includes(a.type)) return { error: `${name}: only PNG, JPEG, WebP and GIF images` };
      // Base64 with nothing else in it, since it goes to Ollama as is.
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) || a.data.length % 4 !== 0 || !a.data) return { error: "Invalid attachments" };
      const bytes = Buffer.from(a.data, "base64").length;
      if (bytes > MAX_IMAGE_BYTES) return { error: `${name} is too large: images may have ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
      total += bytes;
      list.push({ name, type: a.type, kind: "image", data: a.data });
    } else {
      return { error: "Invalid attachments" };
    }
  }
  if (total > MAX_TOTAL_BYTES) return { error: `The files take more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB together` };
  return list;
}

// The text the model gets for a message with text files: what the user wrote, then each file, marked.
export function inlineFiles(content: string, files: { name: string; text: string }[]) {
  return [content, ...files.map((f) => `--- Attached file: ${f.name} ---\n${f.text}\n--- End of ${f.name} ---`)].filter(Boolean).join("\n\n");
}
