import { listChats } from "@/lib/db";

export async function GET() {
  return Response.json({ chats: listChats() });
}
