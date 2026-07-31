// Minimal service worker: exists only to satisfy PWA installability (a
// registered service worker with a fetch handler). Intentionally does no
// caching — this is a live CRM, and stale data offline would be worse than
// no offline support at all.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
