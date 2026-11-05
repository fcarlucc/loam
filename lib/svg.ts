// Cleans an SVG drawn from model output (a Mermaid diagram) before it is shown. A diagram can name images,
// links and styles by URL, and anything the page loads from outside would tell a server about the
// conversation. This keeps only what refers to the SVG itself (#fragments) or is inline (data:).
// Runs in the browser: the markup is parsed into an inert document, where nothing loads, and the cleaned
// element is returned to be inserted as is, so it is never parsed a second time.

// Elements that load something, run something or point somewhere; removed with their content.
const DROPPED = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "audio",
  "base",
  "discard",
  "embed",
  "feimage",
  "fencedframe",
  "form",
  "frame",
  "frameset",
  "iframe",
  "image",
  "img",
  "input",
  "link",
  "meta",
  "object",
  "picture",
  "portal",
  "script",
  "set",
  "source",
  "track",
  "video",
]);

// Attributes whose value is a URL. Only href may stay, and only as a #fragment.
const URL_ATTRIBUTES = new Set(["action", "background", "cite", "data", "formaction", "href", "lowsrc", "ping", "poster", "src", "srcset"]);

const CSS_REFERENCE = /url\(\s*(['"]?)([^'")]*)/gi;
// CSS functions that load an image from a plain string, without url().
const CSS_LOADERS = /(?:image-set|image|cross-fade|element|src)\s*\(/i;

// Whether a CSS value only refers to the SVG itself or to inline data.
function isLocalCss(value: string) {
  if (CSS_LOADERS.test(value)) return false;
  for (const [, , target] of value.matchAll(CSS_REFERENCE)) {
    if (!/^\s*(#|data:)/i.test(target)) return false;
  }
  return true;
}

// Removes the declarations that refer outside, from a style attribute or a rule (read as parsed by the browser,
// so escapes like u\rl( can't hide one).
function cleanDeclarations(style: CSSStyleDeclaration) {
  for (const name of Array.from(style)) {
    if (!isLocalCss(style.getPropertyValue(name))) style.removeProperty(name);
  }
}

function cleanRules(rules: CSSRuleList) {
  for (const rule of Array.from(rules)) {
    if ("style" in rule && rule.style instanceof CSSStyleDeclaration) cleanDeclarations(rule.style);
    if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList) cleanRules(rule.cssRules);
  }
}

// A stylesheet's text with the declarations that refer outside left out. A constructed sheet ignores @import.
function cleanStylesheet(css: string) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  cleanRules(sheet.cssRules);
  return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
}

export function sanitizeSvg(markup: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.body.querySelector("svg");
  if (!svg) throw new Error("No SVG in the diagram");

  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    const tag = el.localName.toLowerCase();
    if (DROPPED.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === "style") {
      el.textContent = cleanStylesheet(el.textContent ?? "");
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value.trim();
      const remove =
        name.startsWith("on") ||
        (URL_ATTRIBUTES.has(name) && !(name === "href" && value.startsWith("#"))) ||
        // Presentation attributes (fill, filter, mask…) can name a resource with url(). A backslash could be a
        // CSS escape hiding one, so a value with both is dropped.
        (name !== "style" && value.includes("(") && (value.includes("\\") || !isLocalCss(value)));
      if (remove) el.removeAttributeNode(attr);
    }
    // Any element with inline styles: HTML, SVG and MathML (KaTeX in a label) alike.
    if ("style" in el && el.style instanceof CSSStyleDeclaration) {
      cleanDeclarations(el.style);
      if (!el.style.length) el.removeAttribute("style");
    }
    // A link to elsewhere keeps its text and shapes, not the link.
    const linked = Array.from(el.attributes).some((attr) => attr.localName === "href");
    if (tag === "a" && !linked) el.replaceWith(...Array.from(el.childNodes));
  }
  return svg;
}
