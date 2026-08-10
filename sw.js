/* Holston River Planner — service worker.
   Shell is cache-first so the app opens instantly and works with no signal.
   TVA data is stale-while-revalidate: you always get the last good numbers
   immediately, and they refresh in the background when there is a connection. */
const VERSION = "holston-v2";
const SHELL   = VERSION + "-shell";
const DATA    = VERSION + "-data";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
                "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(ASSETS).catch(() => c.add("./index.html")))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Data: serve what we have, refresh behind it. A failed refresh is not an error —
  // it just means you keep yesterday's numbers instead of an empty screen.
  if (url.pathname.includes("/data/tva.json")) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      const cached = await cache.match(request);
      const network = fetch(request).then(res => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      // Network first for the data file so a fresh page load gets fresh numbers,
      // but never leave the app with nothing — fall back to the last copy.
      return (await network) || cached ||
        new Response(JSON.stringify({ error: "offline" }),
          { status: 503, headers: { "content-type": "application/json" } });
    })());
    return;
  }

  // Navigation: try the network so a redeploy lands, fall back to the cached shell.
  // cache:"no-cache" forces revalidation — without it the browser's HTTP cache can
  // hand back a 10-minute-old index.html (GitHub Pages sets max-age=600) and a new
  // deploy silently does not appear until that expires.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request, { cache: "no-cache" }).then(res => {
        caches.open(SHELL).then(c => c.put("./index.html", res.clone()));
        return res;
      }).catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }

  e.respondWith(caches.match(request).then(r => r || fetch(request).then(res => {
    if (res && res.ok && url.origin === location.origin)
      caches.open(SHELL).then(c => c.put(request, res.clone()));
    return res;
  })));
});
