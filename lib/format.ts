// Token counts the way context sizes are named: 8192 -> "8K", 4300 -> "4.2K".
export const formatTokens = (n: number) => (n < 1024 ? String(n) : `${+(n / 1024).toFixed(1)}K`);
