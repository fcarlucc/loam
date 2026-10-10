"use client";

import { memo, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function toText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(toText).join("");
  return "";
}

function languageOf(code: Element | undefined) {
  const classes = (code?.properties?.className ?? []) as string[];
  return classes.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
}

const components: Components = {
  pre({ node, children }: { node?: Element; children?: ReactNode }) {
    const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
    const text = code ? toText(code).replace(/\n$/, "") : "";
    return (
      <div className="code-block">
        <div className="code-block-header">
          <span className="font-mono">{languageOf(code) || "text"}</span>
          <CopyButton text={text} label="Copy code" />
        </div>
        <pre>{children}</pre>
      </div>
    );
  },
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
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
