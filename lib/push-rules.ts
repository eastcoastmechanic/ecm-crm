// Pure helpers for web push. No database or network imports, so they can be tested.

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Keep the text short enough for a lock screen and strip anything that is not plain text. */
export function buildPushPayload(input: { title: string; body: string; url: string; tag?: string }): PushPayload {
  const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
  return {
    title: clean(input.title, 80),
    body: clean(input.body, 180),
    url: input.url.startsWith("/") || input.url.startsWith("https://") ? input.url : "/field-board",
    ...(input.tag ? { tag: input.tag } : {}),
  };
}

/** The push service says this subscription will never work again, so the row should be deleted. */
export function isGoneStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

// Browsers hand out endpoints on their own push service. Because the server will POST to whatever
// endpoint is saved, only those services are accepted, so a signed-in user cannot point it elsewhere.
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "web.push.apple.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];
const PUSH_SUFFIXES = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Validate what the browser sends. Only https endpoints on a known push service are accepted. */
export function parseSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof r.endpoint === "string" ? r.endpoint : "";
  const p256dh = typeof r.keys?.p256dh === "string" ? r.keys.p256dh : "";
  const auth = typeof r.keys?.auth === "string" ? r.keys.auth : "";
  if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}
