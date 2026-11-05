// Models write math as $…$, $$…$$, \(…\) or \[…\], and remark-math only reads dollars. This rewrites a reply
// so that it does: the backslash forms become dollars, and a dollar that doesn't pair up is escaped, so a
// price ("$5 and $10") or a formula still streaming in shows as plain text. Code is left exactly as written.
// Links are not: a lone dollar in a URL (https://x/?a=$b) is escaped too, which may break that link. Rare in
// model output, and fenced or inline code keeps one intact.

// A fence line, also inside a blockquote or a list item.
const FENCE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})/;
// What opens a line before its text: indentation, blockquote markers, a list marker.
const MARKERS = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/;
const LIST_MARKER = /(?:[-*+]|\d{1,9}[.)])[ \t]+$/;
const BLANK_LINE = /\n[ \t>]*\n/;

export function preprocessMath(markdown: string) {
  if (!/[$\\]/.test(markdown)) return markdown;
  return splitFences(markdown)
    .map(({ code, text }) => (code ? text : rewrite(text)))
    .join("");
}

// The markdown in pieces, fenced code blocks apart. A fence still open (a reply streaming in) runs to the end.
function splitFences(markdown: string) {
  const parts: { code: boolean; text: string }[] = [];
  let text = "";
  let fence = "";
  const flush = (code: boolean) => {
    if (text) parts.push({ code, text });
    text = "";
  };
  for (const line of markdown.split(/(?<=\n)/)) {
    const m = FENCE.exec(line);
    if (!fence) {
      // A backtick fence's info string can't contain a backtick: then it is inline code.
      if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
        flush(false);
        fence = m[1];
      }
      text += line;
    } else {
      text += line;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) {
        flush(true);
        fence = "";
      }
    }
  }
  flush(fence !== "");
  return parts;
}

const runLength = (s: string, i: number, char: string) => {
  let j = i;
  while (s[j] === char) j++;
  return j - i;
};

// Where the next run of exactly `n` of `char` starts, from `from` on; -1 if there is none.
function nextRun(s: string, from: number, char: string, n: number) {
  for (let i = s.indexOf(char, from); i >= 0; i = s.indexOf(char, i)) {
    const len = runLength(s, i, char);
    if (len === n) return i;
    i += len;
  }
  return -1;
}

// The dollars closing those opening at `i`, or -1. A single dollar follows Pandoc's rule, which tells prices
// from math: it opens only before a non-space, and closes only after a non-space and not before a digit.
function closingDollars(s: string, i: number, n: number) {
  if (n > 1) return nextRun(s, i + n, "$", n);
  if (!s[i + 1] || /\s/.test(s[i + 1])) return -1;
  const end = nextRun(s, i + 1, "$", 1);
  if (end < 0 || BLANK_LINE.test(s.slice(i, end)) || /\s/.test(s[end - 1]) || /\d/.test(s[end + 1] ?? "")) return -1;
  return end;
}

// The line holding position `i`: whether only markers stand before `i`, and the indent that continues the
// line's blockquote or list item on a new line.
function lineAt(s: string, i: number) {
  const line = s.slice(s.lastIndexOf("\n", i - 1) + 1, i);
  const markers = MARKERS.exec(line)![0];
  return { atStart: markers.length === line.length, indent: markers.replace(LIST_MARKER, (m) => " ".repeat(m.length)) };
}

// Display math as remark-math wants it: the $$ fences on lines of their own.
function displayMath(inner: string, indent: string) {
  const lines = inner.split("\n");
  // The first line continues the opening one; the others already carry their own markers.
  const first = lines[0].trim();
  if (first) lines[0] = indent + first;
  else lines.shift();
  const last = lines.length - 1;
  if (last > 0 && /^[ \t>]*$/.test(lines[last])) lines.pop();
  else lines[last] = lines[last].trimEnd();
  return `$$\n${lines.join("\n")}\n${indent}$$`;
}

function rewrite(s: string) {
  let out = "";
  let i = 0;

  // Display math, on lines of its own, then whatever followed it on a new line.
  const display = (start: number, inner: string, next: number) => {
    const { atStart, indent } = lineAt(s, start);
    if (!atStart) out = `${out.replace(/[ \t]+$/, "")}\n${indent}`;
    out += displayMath(inner, indent);
    i = next;
    while (s[i] === " " || s[i] === "\t") i++;
    if (i < s.length && s[i] !== "\n") out += `\n${indent}`;
  };

  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const open = s[i + 1];
      if (open === "(" || open === "[") {
        const end = s.indexOf(open === "(" ? "\\)" : "\\]", i + 2);
        const inner = end < 0 ? "" : s.slice(i + 2, end);
        // A formula holding a dollar is left alone: the dollar would close the ones put around it.
        if (inner.trim() && !inner.includes("$")) {
          if (open === "[" && (lineAt(s, i).atStart || inner.includes("\n"))) {
            display(i, inner, end + 2);
            continue;
          }
          if (!BLANK_LINE.test(inner)) {
            // Dollars side by side would read as one longer run.
            out += `${out.endsWith("$") ? " " : ""}$${inner.trim()}$${s[end + 2] === "$" ? " " : ""}`;
            i = end + 2;
            continue;
          }
        }
      }
      // Any other escape, \$ included, stays as written.
      out += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "`") {
      const n = runLength(s, i, "`");
      const end = nextRun(s, i + n, "`", n);
      const stop = end < 0 || BLANK_LINE.test(s.slice(i, end)) ? i + n : end + n;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "$") {
      const n = runLength(s, i, "$");
      const end = closingDollars(s, i, n);
      const inner = end < 0 ? "" : s.slice(i + n, end);
      if (!inner.trim()) {
        out += "\\$".repeat(n);
        i += n;
        continue;
      }
      if (n === 2 && (lineAt(s, i).atStart || inner.includes("\n"))) {
        display(i, inner, end + n);
        continue;
      }
      out += s.slice(i, end + n);
      i = end + n;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
