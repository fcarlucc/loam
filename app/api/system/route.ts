import os from "node:os";
import type { SystemInfo } from "@/lib/types";

// This Mac's chip and memory, for model recommendations.
export async function GET() {
  const info: SystemInfo = { chip: os.cpus()[0]?.model ?? null, memoryBytes: os.totalmem() };
  return Response.json(info);
}
