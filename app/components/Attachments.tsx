"use client";

import { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_CHARS } from "@/lib/attachments";
import { formatFileSize } from "@/lib/format";
import type { Attachment, NewAttachment } from "@/lib/types";
import { FileIcon, XIcon } from "./icons";

// What the file picker offers. Anything can still be dropped or pasted: its content decides.
const TEXT_EXTENSIONS =
  ".txt,.md,.markdown,.json,.yaml,.yml,.toml,.xml,.csv,.tsv,.log,.ini,.env,.sql,.sh,.zsh,.bash,.py,.js,.mjs,.cjs,.ts,.tsx,.jsx,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.html,.css,.scss";
// `canSee` is undefined while the model's details aren't known: images are taken, and the server has the last word.
export const acceptFor = (canSee: boolean | undefined) => `text/*,${TEXT_EXTENSIONS}${canSee === false ? "" : ",image/*"}`;

const IMAGE_MAX_SIDE = 1024; // images are shrunk to this before they leave the page: plenty for a model, small to keep
const TOO_LONG = `text files may have up to ${MAX_TEXT_CHARS / 1000}K characters`;

// Size of a file about to be sent, in bytes (about, for base64).
export const sizeOf = (a: NewAttachment) => (a.kind === "image" ? Math.round(a.data.length * 0.75) : new Blob([a.data]).size);
const dataUrl = (a: NewAttachment) => `data:${a.type};base64,${a.data}`;
// The file as the message shows it while it is being sent: an image keeps its preview until the saved one comes back.
export const metaOf = (a: NewAttachment): Attachment => ({
  name: a.name,
  type: a.type,
  kind: a.kind,
  size: sizeOf(a),
  ...(a.kind === "image" ? { preview: dataUrl(a) } : {}),
});
// Rough token count of the text files: what they will take from the model's context.
export const textTokens = (list: NewAttachment[]) => list.reduce((n, a) => n + (a.kind === "text" ? Math.ceil(a.data.length / 4) : 0), 0);

// Whether decoded bytes read like text: few control characters, few undecodable ones.
function looksLikeText(text: string) {
  const sample = text.slice(0, 4000);
  let odd = 0;
  for (const ch of sample) if ((ch < " " && ch !== "\n" && ch !== "\r" && ch !== "\t") || ch === "�") odd++;
  return odd <= sample.length / 50;
}

// Reads the files the user picked, dropped or pasted: text files as text, images resized and re-encoded.
// Returns what can be sent, and one line per file that can't.
export async function readFiles(files: File[], { canSee, room }: { canSee: boolean | undefined; room: number }) {
  const accepted: NewAttachment[] = [];
  const refused: string[] = [];
  for (const file of files) {
    if (accepted.length >= room) {
      refused.push(`${file.name}: at most ${MAX_ATTACHMENTS} files per message`);
    } else if (file.type.startsWith("image/")) {
      if (canSee === false) refused.push(`${file.name}: this model can't see images`);
      else {
        try {
          accepted.push(await readImage(file));
        } catch {
          refused.push(`${file.name}: couldn't read this image`);
        }
      }
    } else if (file.size > MAX_TEXT_CHARS * 4) {
      refused.push(`${file.name}: ${TOO_LONG}`);
    } else {
      const text = await file.text();
      if (text.includes("\0") || !looksLikeText(text)) refused.push(`${file.name}: not a text file`);
      else if (text.length > MAX_TEXT_CHARS) refused.push(`${file.name}: ${TOO_LONG}`);
      else accepted.push({ name: file.name, type: file.type || "text/plain", kind: "text", data: text });
    }
  }
  return { accepted, refused };
}

async function readImage(file: File): Promise<NewAttachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  // Small enough already, in a type the server takes: sent as is, so a crisp screenshot stays crisp.
  if (scale === 1 && IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES) {
    bitmap.close();
    return { name: file.name, type: file.type, kind: "image", data: await toBase64(file) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps text and drawings sharp; photos, and anything that would still be too big, go as JPEG.
  for (const type of file.type === "image/png" ? ["image/png", "image/jpeg"] : ["image/jpeg"]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (blob && blob.size <= MAX_IMAGE_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg");
      return { name, type, kind: "image", data: await toBase64(blob) };
    }
  }
  throw new Error("too large");
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The files of a message, or those about to be sent (then each has a remove button). Saved files open
// in a new tab; a file whose message is still being sent has no link yet.
export function AttachmentChips({
  items,
  onRemove,
  className = "",
}: {
  items: (Attachment | NewAttachment)[];
  onRemove?: (index: number) => void;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((a, i) => {
        const pending = "data" in a;
        const href = pending
          ? a.kind === "image"
            ? dataUrl(a)
            : undefined
          : a.id !== undefined
            ? `/api/attachments/${a.id}`
            : a.preview;
        const label = `${a.name} (${formatFileSize(pending ? sizeOf(a) : a.size)})`;
        const body =
          a.kind === "image" && href ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local file, sized by the server
            <img src={href} alt={a.name} title={label} className="h-20 max-w-56 rounded-lg border border-border object-cover" />
          ) : (
            <span title={label} className="flex max-w-64 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg">
              <FileIcon width={14} height={14} className="shrink-0 text-muted" />
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 text-muted">{formatFileSize(pending ? sizeOf(a) : a.size)}</span>
            </span>
          );
        return (
          <li key={`${i}-${a.name}`} className="relative">
            {!pending && href ? (
              <a href={href} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-80">
                {body}
              </a>
            ) : (
              body
            )}
            {onRemove && (
              <button
                onClick={() => onRemove(i)}
                aria-label={`Remove ${a.name}`}
                title="Remove"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-2 text-muted hover:text-fg"
              >
                <XIcon width={12} height={12} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
