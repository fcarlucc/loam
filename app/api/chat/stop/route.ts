import { generations } from "@/lib/generations";
import { jsonError, readJson } from "@/lib/http";

// Stops the reply being generated for a chat. The reply's stream then ends normally, after the
// partial text has been saved, so the client knows the saved message.
export async function POST(request: Request) {
  const { chatId } = await readJson(request);
  if (typeof chatId !== "number") return jsonError("Invalid request", 400);
  const stop = generations.get(chatId);
  stop?.();
  return Response.json({ stopped: !!stop });
}
