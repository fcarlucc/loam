"use client";

import { createContext, memo, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { Options as KatexOptions } from "rehype-katex";
import remarkGfm from "remark-gfm";
import { preprocessMath } from "@/lib/math";
import { CopyButton } from "./CopyButton";
import { MermaidBlock } from "./Mermaid";

// A formula KaTeX can't read shows as its source (rehype-katex retries with throwOnError: false).
const katexOptions: KatexOptions = {
  // Keeps \href, \includegraphics and the like from loading or linking anything.
  trust: false,
  strict: "ignore",
  errorColor: "var(--fg-muted)",
  maxSize: 50,
};

type Plugins = { remark: Options["remarkPlugins"]; rehype: Options["rehypePlugins"] };
const plain: Plugins = { remark: [remarkGfm], rehype: [rehypeHighlight] };

// KaTeX (its code, its stylesheet and its fonts) loads with the first reply that has math in it, not with
// the app: most replies have none. Until then the formulas show as text.
let withMath: Plugins | null = null;
let loading: Promise<void> | null = null;
const loaded = new Set<() => void>();
function loadMath() {
  loading ??= Promise.all([import("remark-math"), import("rehype-katex"), import("katex/dist/katex.min.css")])
    .then(([{ default: remarkMath }, { default: rehypeKatex }]) => {
      // KaTeX first, so math isn't taken for code to highlight.
      withMath = { remark: [remarkGfm, remarkMath], rehype: [[rehypeKatex, katexOptions], rehypeHighlight] };
      loaded.forEach((notify) => notify());
    })
    .catch(() => {
      loading = null; // try again with the next reply
    });
}
const onMathLoaded = (notify: () => void) => {
  loaded.add(notify);
  return () => loaded.delete(notify);
};
// After preprocessMath every formula is written with dollars; ```math blocks are drawn by KaTeX too.
const HAS_MATH = /\$|^[ \t>]*(?:```|~~~)[ \t]*math\b/m;

// The markdown being shown, for the code blocks to tell whether they are complete yet.
const Source = createContext("");

function toText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(toText).join("");
  return "";
}

function languageOf(code: Element | undefined) {
  const classes = (code?.properties?.className ?? []) as string[];
  return classes.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
}

function CodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const source = useContext(Source);
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const text = code ? toText(code).replace(/\n$/, "") : "";
  const language = languageOf(code);
  if (language === "mermaid") {
    // A block still streaming in has no closing fence yet: it runs to the end of the reply.
    const end = node?.position?.end.offset;
    const complete = end !== undefined && /\n[ \t>]*(`{3,}|~{3,})[ \t]*$/.test(source.slice(0, end));
    return (
      <MermaidBlock code={text} complete={complete}>
        {children}
      </MermaidBlock>
    );
  }
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="font-mono">{language || "text"}</span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // Never load images from model output: a crafted URL could leak the conversation to a remote server.
  // Show a link the user can choose to open instead.
  img({ src, alt }) {
    if (typeof src !== "string" || !src) return alt ? <span>{alt}</span> : null;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || "Image"} (image link)
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

// Memoized so earlier messages don't re-parse on every streamed token.
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const source = preprocessMath(children);
  const math = useSyncExternalStore(onMathLoaded, () => withMath, () => null);
  const needsMath = HAS_MATH.test(source);
  useEffect(() => {
    if (needsMath && !math) loadMath();
  }, [needsMath, math]);
  const plugins = math && needsMath ? math : plain;
  return (
    <div className="prose-chat">
      <Source.Provider value={source}>
        <ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={components}>
          {source}
        </ReactMarkdown>
      </Source.Provider>
    </div>
  );
});
