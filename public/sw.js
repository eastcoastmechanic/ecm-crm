// Service worker. Three jobs:
// 1. PWA installability (a registered worker with a fetch handler).
// 2. The truck screen offline: the last loaded /field-board page (today's jobs, addresses,
//    access notes; never money, the truck screen has none) is kept on the phone, and opened
//    from there when there is no signal. Only /field-board is kept. Every other page is
//    live only, because stale CRM data offline would be worse than none. Signing out (any
//    request to /login) deletes the saved copy.
//    Taps made offline are queued by the page itself (IndexedDB), not here.
// 3. Job alerts (web push).

const TRUCK_CACHE = "ecm-truck-page-v1";
const STATIC_CACHE = "ecm-static-v1";
const TRUCK_PATH = "/field-board";
const MAX_STATIC_ENTRIES = 600;
// On one bar of signal, show the saved copy rather than spin forever.
const NETWORK_TIMEOUT_MS = 8000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ecm-") && key !== TRUCK_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function forgetTruckPage() {
  return caches.delete(TRUCK_CACHE).catch(() => false);
}

function savedTruckPage() {
  return caches
    .open(TRUCK_CACHE)
    .then((cache) => cache.match(TRUCK_PATH))
    .catch(() => undefined);
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>No signal</title>' +
      '<body style="font-family:system-ui;background:#0a1628;color:#fff;padding:24px">' +
      "<h1>No signal</h1><p>This page needs signal. Open the truck screen once with signal and it will be saved for next time.</p>" +
      '<p><a style="color:#e8502a" href="/field-board">Truck screen</a></p></body>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Network first, saved copy when there is no signal (or it takes too long).
function truckPage(request) {
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === "basic" && !response.redirected) {
      const copy = response.clone();
      caches
        .open(TRUCK_CACHE)
        .then((cache) => cache.put(TRUCK_PATH, copy))
        .catch(() => {});
    } else if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
      // Signed out or not allowed: don't keep showing the old list.
      forgetTruckPage();
    }
    return response;
  });

  return new Promise((resolve) => {
    let settled = false;
    const useSaved = () =>
      savedTruckPage().then((saved) => {
        if (settled) return;
        if (saved) {
          settled = true;
          resolve(saved);
        }
        return saved;
      });
    const timer = setTimeout(useSaved, NETWORK_TIMEOUT_MS);
    network
      .then((response) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(response);
        }
      })
      .catch(() => {
        clearTimeout(timer);
        useSaved().then((saved) => {
          if (!saved && !settled) {
            settled = true;
            resolve(offlinePage());
          }
        });
      });
  });
}

// The app opens on /dashboard (a tech is sent on to /field-board). With no signal, show the saved truck screen.
function startPage(request) {
  return fetch(request).catch(() => savedTruckPage().then((saved) => saved || offlinePage()));
}

// Build files have the version in their name and never change, so the saved copy is always right.
function staticFile(request) {
  return caches.open(STATIC_CACHE).then((cache) =>
    cache.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          cache
            .put(request, response.clone())
            .then(() => trimStatic(cache))
            .catch(() => {});
        }
        return response;
      });
    })
  );
}

function trimStatic(cache) {
  return cache.keys().then((keys) => {
    if (keys.length <= MAX_STATIC_ENTRIES) return;
    return Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((key) => cache.delete(key)));
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Other sites, and anything that isn't a plain read (form posts, the sync queue), go straight to the network.
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    event.waitUntil(forgetTruckPage());
    return;
  }
  if (request.mode === "navigate") {
    if (url.pathname === TRUCK_PATH) {
      event.respondWith(truckPage(request));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/dashboard") {
      event.respondWith(startPage(request));
      return;
    }
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(staticFile(request));
  }
});

// Job alerts (web push). The server sends { title, body, url }; show it and open the app on tap.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "East Coast Mechanical";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/field-board" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/field-board";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
