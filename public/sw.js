/* AutoVault service worker.
 * - Static assets: cache-first.
 * - API GETs: network-first with cache fallback so previously loaded vehicles/records stay readable offline.
 * - Navigations: network-first, fall back to the last cached page, then /offline.
 * - Offline writes are queued in IndexedDB by the page; this worker only wakes pages to flush (Background Sync where supported).
 * Private data is cleared on logout/login via postMessage. */
const VERSION = "v1";
const STATIC = `av-static-${VERSION}`;
const API = `av-api-${VERSION}`;
const PAGES = `av-pages-${VERSION}`;
const NEVER_CACHE_API = [/^\/api\/auth\//, /^\/api\/admin\//, /^\/api\/users\/me\/export/, /^\/api\/documents\/[^/]+\/file/, /^\/api\/reports\//, /^\/api\/cron\//, /^\/api\/health/, /^\/api\/integrations\/obd/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(["/offline", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![STATIC, API, PAGES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && (event.data.type === "LOGOUT" || event.data.type === "CLEAR")) {
    event.waitUntil(Promise.all([caches.delete(API), caches.delete(PAGES)]));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (NEVER_CACHE_API.some((r) => r.test(url.pathname))) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { cacheName: API });
          return hit || new Response(JSON.stringify({ error: { code: "OFFLINE", message: "You are offline and this data has not been saved on this device yet." } }), { status: 503, headers: { "content-type": "application/json" } });
        }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.headers.get("content-type")?.includes("text/html") && !url.pathname.startsWith("/login")) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req, { cacheName: PAGES })) || (await caches.match("/offline", { cacheName: STATIC })) || Response.error()),
    );
  }
});

// Background Sync: ask any open page to flush its IndexedDB outbox (only where the browser supports it).
self.addEventListener("sync", (event) => {
  if (event.tag === "autovault-flush") {
    event.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: "FLUSH" }))));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "AutoVault", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "AutoVault", { body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: data.tag, data: { url: data.url || "/dashboard" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => "focus" in x);
      if (c) {
        c.navigate(url);
        return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
