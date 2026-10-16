/*
 * Tick service worker — makes Tick installable and lets it open with no signal.
 *  - The app itself (page, scripts, styles, fonts, icons) is cached, so it launches offline.
 *  - Face models are cached by the app (cache "tick-face-models-v1"); this worker leaves them alone.
 *  - /api/* always goes to the network: registers are never served from a stale copy.
 */
const VERSION = "tick-app-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([VERSION, "tick-face-models-v1"]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the teacher taps "Update"
self.addEventListener("message", (event) => { if (event.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/models/")) return;

  // Pages: try the network first (fresh app), fall back to the cached app when offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(VERSION)).put("/index.html", res.clone());
        return res;
      } catch {
        return (await caches.match("/index.html")) || (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  // Hashed build files never change: cache first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Everything else (icons, manifest): use the cache, refresh it in the background
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  })());
});
