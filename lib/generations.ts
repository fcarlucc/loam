// Replies being generated right now, by chat id, so the stop button can end one gracefully.
// On globalThis because each route can run in its own module instance.
const g = globalThis as unknown as { __generations?: Map<number, () => void> };
export const generations = (g.__generations ??= new Map<number, () => void>());
