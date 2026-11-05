"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { sanitizeSvg } from "@/lib/svg";
import { CopyButton } from "./CopyButton";

type Theme = "light" | "dark";

// The app's theme, followed as it changes (lib/theme.ts sets it on <html>).
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const getTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

// Diagrams drawn so far, by theme and code: a message shown again (another chat, the reply once saved)
// draws at once.
const drawn = new Map<string, SVGSVGElement>();
const DRAWN_MAX = 50;

let queue: Promise<unknown> = Promise.resolve();
let renders = 0;

// Draws a diagram, or null if it can't be drawn. One at a time: Mermaid's configuration is global.
function draw(code: string, theme: Theme): Promise<SVGSVGElement | null> {
  const run = queue.then(async () => {
    // Mermaid is big: it loads with the first diagram shown, not with the app.
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "neutral",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      suppressErrorRendering: true,
      // What a diagram can't change with a directive: Mermaid's own list, then the theme and anything that
      // adds CSS, so a diagram follows the app and can't style itself into loading something.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "theme",
        "themeVariables",
        "themeCSS",
        "darkMode",
        "fontFamily",
        "altFontFamily",
      ],
    });
    if (!(await mermaid.parse(code, { suppressErrors: true }))) return null;
    const id = `mermaid-${++renders}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return sanitizeSvg(svg);
    } catch {
      return null;
    } finally {
      // Mermaid draws in temporary elements on the page, and may leave them behind when it fails.
      for (const tmp of [`d${id}`, `i${id}`, id]) document.getElementById(tmp)?.remove();
    }
  }).catch(() => null);
  queue = run;
  return run;
}

const VIEWS = [
  ["diagram", "Diagram"],
  ["code", "Code"],
] as const;

// A ```mermaid block: the diagram, with the code a click away. `complete` is false while the block is still
// streaming in: the code shows, as in any other block, until it parses, and a diagram that doesn't parse is
// only reported once the block is complete.
export function MermaidBlock({ code, complete, children }: { code: string; complete: boolean; children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light" as Theme);
  const key = `${theme}\n${code}`;
  // The latest drawing; svg is null when that code didn't parse.
  const [last, setLast] = useState<{ key: string; svg: SVGSVGElement | null } | null>(null);
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const box = useRef<HTMLDivElement>(null);
  const cached = useMemo(() => drawn.get(key)?.cloneNode(true) as SVGSVGElement | undefined, [key]);

  useEffect(() => {
    if (drawn.has(key)) return;
    let cancelled = false;
    // Not on every streamed token: once the code has been still for a moment.
    const timer = setTimeout(
      () => {
        void draw(code, theme).then((svg) => {
          if (svg) {
            drawn.set(key, svg.cloneNode(true) as SVGSVGElement);
            if (drawn.size > DRAWN_MAX) drawn.delete(drawn.keys().next().value!);
          }
          // While streaming, a diagram that stops parsing for a moment (a line half written) stays as it was.
          if (!cancelled && (svg || complete)) setLast({ key, svg });
        });
      },
      complete ? 0 : 300,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, code, theme, complete]);

  const svg = cached ?? last?.svg ?? null;
  const failed = !svg && last?.key === key;
  const showDiagram = svg !== null && view === "diagram";

  useLayoutEffect(() => {
    if (showDiagram && box.current) box.current.replaceChildren(svg);
  }, [showDiagram, svg]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="font-mono">mermaid</span>
        <div className="flex items-center gap-1">
          {svg && (
            <div role="group" aria-label="Show as" className="flex rounded-md border border-border p-0.5">
              {VIEWS.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                    view === value ? "bg-surface text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <CopyButton text={code} label="Copy code" />
        </div>
      </div>
      {showDiagram ? <div ref={box} data-testid="diagram" className="mermaid-diagram" /> : <pre>{children}</pre>}
      {failed && <p className="border-t border-border px-4 py-2 text-xs text-muted">Couldn&apos;t draw this diagram</p>}
    </div>
  );
}
