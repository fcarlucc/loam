// Keyboard shortcuts. ⌘ on a Mac, Ctrl elsewhere; keys are matched by their position (KeyboardEvent.code),
// so they work whatever the keyboard layout, and with Option, which changes the character typed on a Mac.
// Combinations the browser keeps for itself (⌘N, ⌘T, ⌘W, ⌘⇧R reload, ⌘⇧M profiles…) are avoided.

export type ShortcutId = "palette" | "newChat" | "search" | "model" | "regenerate" | "stop" | "focusComposer" | "help";

type Combo = { code: string; mod?: boolean; shift?: boolean; alt?: boolean };

export const SHORTCUTS: Record<ShortcutId, { combo: Combo; label: string }> = {
  palette: { combo: { code: "KeyK", mod: true }, label: "Command palette" },
  newChat: { combo: { code: "KeyO", mod: true, shift: true }, label: "New chat" },
  search: { combo: { code: "KeyF", mod: true, shift: true }, label: "Search chats" },
  model: { combo: { code: "KeyL", mod: true, shift: true }, label: "Choose model" },
  regenerate: { combo: { code: "KeyR", mod: true, alt: true }, label: "Regenerate the latest reply" },
  stop: { combo: { code: "Escape" }, label: "Stop generating" },
  focusComposer: { combo: { code: "Escape", shift: true }, label: "Focus the message box" },
  help: { combo: { code: "Slash", mod: true }, label: "Keyboard shortcuts" },
};

export function isMac() {
  if (typeof navigator === "undefined") return true;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform || navigator.userAgent);
}

export function matches(e: KeyboardEvent, id: ShortcutId, mac = isMac()) {
  const { code, mod = false, shift = false, alt = false } = SHORTCUTS[id].combo;
  // The modifier of the other platform must be up: Ctrl+K on a Mac stays the text editing key it is.
  const modDown = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const noMod = !e.metaKey && !e.ctrlKey;
  return e.code === code && (mod ? modDown : noMod) && e.shiftKey === shift && e.altKey === alt;
}

// The keys to press, as shown to the user: "⇧⌘O" on a Mac, "Ctrl+Shift+O" elsewhere.
export function keysOf(id: ShortcutId, mac = isMac()) {
  const { code, mod, shift, alt } = SHORTCUTS[id].combo;
  const key = code === "Escape" ? "Esc" : code === "Slash" ? "/" : code.replace(/^Key/, "");
  if (mac) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${key}`; // Apple's order
  return [mod && "Ctrl", alt && "Alt", shift && "Shift", key].filter(Boolean).join("+");
}
