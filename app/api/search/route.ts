import { search } from "@/lib/db";
import { jsonError } from "@/lib/http";

// Full-text search across all chats: GET /api/search?q=words
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > 200) return jsonError("Query too long", 400);
  return Response.json({ hits: search(q) });
}
