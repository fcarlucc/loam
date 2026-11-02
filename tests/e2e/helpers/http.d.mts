// Types of http.mjs, for the browser tests (tests/ui) written in TypeScript.
export type RequestInitLike = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  origin?: string | null;
  signal?: AbortSignal;
};
export type JsonResult = { status: number; headers: Headers; data: unknown };
export type ApiClient = {
  base: string;
  request(path: string, init?: RequestInitLike): Promise<Response>;
  json(path: string, init?: RequestInitLike): Promise<JsonResult>;
  get(path: string, init?: RequestInitLike): Promise<Response>;
  post(path: string, body?: unknown, init?: RequestInitLike): Promise<Response>;
  put(path: string, body?: unknown, init?: RequestInitLike): Promise<Response>;
  patch(path: string, body?: unknown, init?: RequestInitLike): Promise<Response>;
  delete(path: string, body?: unknown, init?: RequestInitLike): Promise<Response>;
};
export function apiClient(base: string): ApiClient;
export function rawRequest(options: {
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>;
export type StreamedReply = { text: string; thinking: string; types: string[]; stats: unknown; error: string | undefined };
export function readEvents(res: Response): Promise<StreamedReply>;
export function readLines(res: Response): Promise<unknown[]>;
export function chat(
  api: ApiClient,
  body: unknown,
  init?: RequestInitLike,
): Promise<({ status: number; id: number } & StreamedReply) | { status: number; error: string }>;
