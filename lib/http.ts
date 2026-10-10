// Reads a JSON object body. Anything else (invalid JSON, null, arrays) becomes {} so callers only validate fields.
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export const jsonError = (error: string, status: number) => Response.json({ error }, { status });
