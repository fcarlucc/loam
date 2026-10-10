import { getStatus } from "@/lib/ollama";

export async function GET() {
  return Response.json(await getStatus());
}
