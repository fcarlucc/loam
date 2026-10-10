"use client";

import { useId, useState } from "react";

export type Bar = { key: string; label: string; value: number; detail: string };

// Single-series bar chart: thin bars with rounded tops on a shared baseline, a hover/focus tooltip on each
// bar (the whole column is the hit target), and the same data as a screen-reader table.
export function BarChart({
  title,
  bars,
  format,
  height = 140,
  axisLabels,
}: {
  title: string;
  bars: Bar[];
  format: (n: number) => string;
  height?: number;
  axisLabels?: [string, string]; // under the first and last bar
}) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(...bars.map((b) => b.value), 0);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between text-sm font-medium">
        {title}
        <span className="text-xs font-normal text-muted tabular-nums">max {format(max)}</span>
      </figcaption>
      <div className="relative" style={{ height }} onPointerLeave={() => setActive(null)} aria-describedby={tableId}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-border">
          {bars.map((b, i) => (
            <div
              key={b.key}
              tabIndex={0}
              aria-label={`${b.label}: ${b.detail}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="group flex h-full min-w-0 flex-1 items-end outline-none"
            >
              <div
                className={`w-full rounded-t-[4px] bg-viz-1 transition-opacity ${active === null || active === i ? "" : "opacity-50"}`}
                style={{ height: max > 0 && b.value > 0 ? `max(2px, ${(b.value / max) * 100}%)` : 0 }}
              />
            </div>
          ))}
        </div>
        {active !== null && bars[active] && (
          <div
            role="status"
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: `${((active + 0.5) / bars.length) * 100}%` }}
          >
            <span className="font-medium">{bars[active].label}</span>
            <span className="text-muted"> · {bars[active].detail}</span>
          </div>
        )}
      </div>
      {axisLabels && (
        <div className="flex justify-between text-[11px] text-muted" aria-hidden>
          <span>{axisLabels[0]}</span>
          <span>{axisLabels[1]}</span>
        </div>
      )}
      <table id={tableId} className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{b.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
