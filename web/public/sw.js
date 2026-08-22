/* Contextboard offline shell cache */
const CACHE_NAME = "contextboard-shell-v2";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest", "/vite.svg", "/sw.js"];

async function precacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  const list = Array.from(new Set((urls || []).filter(Boolean)));
  await Promise.all(
    list.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response && response.ok) {
          await cache.put(url, response.clone());
        }
      } catch {
        // Best-effort; runtime caching will fill gaps after first online visit.
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheUrls(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "PRECACHE" && Array.isArray(data.urls)) {
    event.waitUntil(precacheUrls(data.urls));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cached =
          (await cache.match(request)) ||
          (await cache.match(url.pathname)) ||
          (request.mode === "navigate"
            ? (await cache.match("/index.html")) || (await cache.match("/"))
            : null);
        if (cached) return cached;
        return Response.error();
      }
    })()
  );
});
