// Keyboard shortcuts. ⌘ on a Mac, Ctrl elsewhere. Letters are matched by their position (KeyboardEvent.code):
// K, O, F, L and R sit in the same place on QWERTY, QWERTZ and AZERTY, and Option changes the character a
// Mac types but not the position. Punctuation moves between layouts (the US "/" key types "-" on an Italian
// keyboard, where "/" is ⇧7), so it is matched by the character typed (KeyboardEvent.key), Shift or not.
// Combinations the browser keeps for itself (⌘N, ⌘T, ⌘W, ⌘⇧R reload, ⌘⇧M profiles…) are avoided.
// On Windows, AltGr arrives as Ctrl+Alt: on layouts where AltGr+R types a character, Ctrl+Alt+R does too.

export type ShortcutId = "palette" | "newChat" | "search" | "model" | "regenerate" | "stop" | "focusComposer" | "help";

type Combo = ({ code: string; key?: never } | { key: string; code?: never }) & { mod?: boolean; shift?: boolean; alt?: boolean };

export const SHORTCUTS: Record<ShortcutId, { combo: Combo; label: string }> = {
  palette: { combo: { code: "KeyK", mod: true }, label: "Command palette" },
  newChat: { combo: { code: "KeyO", mod: true, shift: true }, label: "New chat" },
  search: { combo: { code: "KeyF", mod: true, shift: true }, label: "Search chats" },
  model: { combo: { code: "KeyL", mod: true, shift: true }, label: "Choose model" },
  regenerate: { combo: { code: "KeyR", mod: true, alt: true }, label: "Regenerate the latest reply" },
  stop: { combo: { code: "Escape" }, label: "Stop generating" },
  focusComposer: { combo: { code: "Escape", shift: true }, label: "Focus the message box" },
  help: { combo: { key: "/", mod: true }, label: "Keyboard shortcuts" },
};

// The server can't tell, and says Mac: shortcut labels are only rendered on the client (Chat and the
// palette appear after the page has loaded), so no server-rendered text depends on this.
export function isMac() {
  if (typeof navigator === "undefined") return true;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform || navigator.userAgent);
}

export function matches(e: Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, id: ShortcutId, mac = isMac()) {
  const { code, key, mod = false, shift = false, alt = false } = SHORTCUTS[id].combo;
  // The modifier of the other platform must be up: Ctrl+K on a Mac stays the text editing key it is.
  const modDown = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const noMod = !e.metaKey && !e.ctrlKey;
  if ((mod ? !modDown : !noMod) || e.altKey !== alt) return false;
  // A character is typed with Shift on some layouts and without it on others: Shift doesn't count.
  return key !== undefined ? e.key === key : e.code === code && e.shiftKey === shift;
}

// The keys to press, as shown to the user: "⇧⌘O" on a Mac, "Ctrl+Shift+O" elsewhere.
export function keysOf(id: ShortcutId, mac = isMac()) {
  const { code, key, mod, shift, alt } = SHORTCUTS[id].combo;
  const name = key ?? (code === "Escape" ? "Esc" : code!.replace(/^Key/, ""));
  if (mac) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`; // Apple's order
  return [mod && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
}
