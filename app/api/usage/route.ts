import { getUsage } from "@/lib/db";

export async function GET() {
  return Response.json(getUsage());
}
