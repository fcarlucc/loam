// Every request to an engine goes through here. Engines are reached only at the URL the user configured:
// a redirect is refused, so a reply can never carry a conversation to a host the loopback check didn't see.
export function engineFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, redirect: "error" });
}
