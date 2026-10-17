// Desktop notifications when a reply finishes while the user is in another app or tab.
// Off by default; the browser asks for permission the first time they are turned on.

const KEY = "notify";
const listeners = new Set<() => void>();

export type NotifyState = "unsupported" | "blocked" | "off" | "on";

const available = () => typeof window !== "undefined" && "Notification" in window;

export function getState(): NotifyState {
  if (!available()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    return Notification.permission === "granted" && localStorage.getItem(KEY) === "1" ? "on" : "off";
  } catch {
    return "off";
  }
}

export async function setEnabled(on: boolean) {
  if (on && available() && Notification.permission === "default") await Notification.requestPermission();
  try {
    if (on && available() && Notification.permission === "granted") localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

// Re-renders on changes made here and on permission changes made in the browser's settings.
export function subscribe(cb: () => void) {
  listeners.add(cb);
  let status: PermissionStatus | undefined;
  let cancelled = false;
  try {
    navigator.permissions
      .query({ name: "notifications" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener("change", cb);
      })
      .catch(() => {});
  } catch {}
  return () => {
    cancelled = true;
    listeners.delete(cb);
    status?.removeEventListener("change", cb);
  };
}

// In another app, another window, or another tab.
export const userIsAway = () => document.visibilityState === "hidden" || !document.hasFocus();

// The start of a reply as plain text, for the notification body.
export function snippet(markdown: string, max = 160) {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " [code] ")
    .replace(/[`*_#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

let last: Notification | undefined;

export function notify({ title, body }: { title: string; body: string }) {
  if (getState() !== "on") return;
  try {
    // The previous one is closed here rather than replaced through a `tag`: a replacement is updated in place,
    // without a new banner, so only the first notification would be noticed until it was dismissed.
    last?.close();
    const n = new Notification(title, { body, icon: "/icon.png" });
    last = n;
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}
