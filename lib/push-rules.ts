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

/** Validate what the browser sends. Only https push endpoints are accepted. */
export function parseSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof r.endpoint === "string" ? r.endpoint : "";
  const p256dh = typeof r.keys?.p256dh === "string" ? r.keys.p256dh : "";
  const auth = typeof r.keys?.auth === "string" ? r.keys.auth : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 1000 || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}
