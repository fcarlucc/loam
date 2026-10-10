import { formatTokens } from "@/lib/format";
import type { ReplyStats } from "@/lib/types";

// A context window this full means Ollama will soon start dropping the oldest messages.
export const nearlyFull = (s?: ReplyStats) => !!s?.contextSize && s.contextUsed / s.contextSize >= 0.9;

export function StatsLine({ stats }: { stats: ReplyStats }) {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const details = [
    `${stats.promptTokens} tokens read, ${stats.tokens} generated`,
    `total ${seconds(stats.totalMs)}`,
    ...(stats.loadMs >= 500 ? [`of which ${seconds(stats.loadMs)} loading the model`] : []),
  ].join(" · ");
  return (
    <span title={details} className="ml-1 self-center text-xs text-muted tabular-nums">
      {stats.tokensPerSecond.toFixed(1)} tok/s · {stats.tokens} tokens
      {stats.contextSize ? (
        <span className={nearlyFull(stats) ? "text-danger" : undefined}>
          {" "}
          · context {formatTokens(stats.contextUsed)}/{formatTokens(stats.contextSize)}
        </span>
      ) : null}
    </span>
  );
}
