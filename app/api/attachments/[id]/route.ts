import { getAttachment } from "@/lib/db";
import { jsonError } from "@/lib/http";

// The file itself, for the thumbnails in a chat and for opening an attachment in a new tab. Text is
// always served as plain text (never as HTML) and image types are limited to a safe few at upload.
export async function GET(_req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const id = Number((await ctx.params).id);
  const a = Number.isSafeInteger(id) ? getAttachment(id) : undefined;
  if (!a) return jsonError("Attachment not found", 404);
  return new Response(a.kind === "image" ? new Uint8Array(a.data ?? []) : a.text, {
    headers: {
      "Content-Type": a.kind === "image" ? a.type : "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
