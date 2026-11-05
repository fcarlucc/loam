// How replies are prepared for remark-math (lib/math.ts): the backslash delimiters become dollars, prices and
// half-written formulas stay text, and code is never touched. Node runs the TypeScript file as is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { preprocessMath } from "../../lib/math.ts";

const cases = [
  ["text without math", "Hello *world*.", "Hello *world*."],
  ["inline dollars", "Energy $E = mc^2$ here.", "Energy $E = mc^2$ here."],
  ["\\(…\\) becomes inline math", "So \\( a^2 + b^2 \\) holds.", "So $a^2 + b^2$ holds."],
  ["\\[…\\] on its own line becomes display math", "\\[ x = 1 \\]", "$$\nx = 1\n$$"],
  ["\\[…\\] over several lines", "Text\n\\[\n  x = 1\n\\]\nmore", "Text\n$$\n  x = 1\n$$\nmore"],
  ["$$…$$ alone on a line is display math", "$$x^2$$", "$$\nx^2\n$$"],
  ["$$…$$ inside a sentence stays inline", "a $$x$$ b", "a $$x$$ b"],
  ["display math in a blockquote keeps its markers", "> \\[x\\]", "> $$\n> x\n> $$"],
  ["display math in a list item stays in it", "1. \\[x\\] then", "1. $$\n   x\n   $$\n   then"],
  ["prices stay text", "It costs $5 and $10.", "It costs \\$5 and \\$10."],
  ["a price range stays text", "From $5-$10.", "From \\$5-\\$10."],
  ["a formula starting with a digit is math", "Then $2^n$ grows.", "Then $2^n$ grows."],
  ["a price next to a formula", "Pay $5, or $x$ each.", "Pay \\$5, or $x$ each."],
  ["a dollar before a space is text", "a $ b $ c", "a \\$ b \\$ c"],
  ["an escaped dollar stays escaped", "only \\$5", "only \\$5"],
  ["a formula still streaming in is text", "Then $\\frac{a", "Then \\$\\frac{a"],
  ["display math still streaming in is text", "$$\n\\sum", "\\$\\$\n\\sum"],
  ["an unclosed \\( is left as written", "So \\(x + ", "So \\(x + "],
  ["inline code is untouched", "Use `$x$` and `\\(y\\)`.", "Use `$x$` and `\\(y\\)`."],
  ["a fenced block is untouched", "```latex\n$5 and \\(x\\)\n```\n$y$", "```latex\n$5 and \\(x\\)\n```\n$y$"],
  ["a tilde fence is untouched", "~~~\n\\[x\\]\n~~~", "~~~\n\\[x\\]\n~~~"],
  ["an unclosed fence runs to the end", "```\n$5 and $10", "```\n$5 and $10"],
  ["side by side formulas stay apart", "\\(a\\)\\(b\\)", "$a$ $b$"],
  ["an escaped backslash is not a delimiter", "\\\\(x\\\\)", "\\\\(x\\\\)"],
];

for (const [name, input, expected] of cases) {
  test(name, () => assert.equal(preprocessMath(input), expected));
}
