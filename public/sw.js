/*
 * Service worker for the hospitality operations PWA.
 *
 * OPERATIONAL CONTEXT
 * -------------------
 * The primary users are on phones and tablets on an event site or a warehouse
 * floor, where connectivity drops regularly. Two guarantees matter:
 *
 *  1. The app must still OPEN when offline. Previously only same-origin static
 *     assets were cached and there was no navigation fallback, so a reload
 *     without connectivity produced the browser's offline error page even
 *     though every asset needed to boot the app was already in the cache.
 *
 *  2. Operational data must NEVER be served stale from the cache. Warehouse
 *     balances, readiness and money are authoritative in the database, so API
 *     and auth traffic (Supabase, any non-GET, any cross-origin request) is
 *     deliberately NOT cached and NOT intercepted. An operator offline sees
 *     the app shell and the app's own error/loading states — never a stale
 *     quantity presented as fact.
 */

const VERSION = "v2";
const STATIC_CACHE = `hospitality-static-${VERSION}`;
const SHELL_CACHE = `hospitality-shell-${VERSION}`;
const EXPECTED_CACHES = new Set([STATIC_CACHE, SHELL_CACHE]);

/** The navigation fallback: the SPA entry document. */
const APP_SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Pre-cache the shell so the very first offline navigation succeeds.
      const cache = await caches.open(SHELL_CACHE);
      try {
        // Fetch + inspect instead of cache.add: a redirected response must
        // never become the shell (browsers refuse to serve a redirected
        // cached response to a navigation request).
        const response = await fetch(new Request(APP_SHELL_URL, { cache: "reload" }));
        if (response.ok && !response.redirected) {
          await cache.put(APP_SHELL_URL, response);
        }
      } catch {
        // A failed pre-cache must not block activation; the runtime handler
        // below will populate the shell on the first successful navigation.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !EXPECTED_CACHES.has(key)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept cross-origin traffic (Supabase REST/auth/realtime, fonts).
  if (url.origin !== self.location.origin) return;

  // ---------------------------------------------------------------- shell
  // Navigations: network first (always prefer fresh), fall back to the cached
  // shell so the app opens offline instead of showing a browser error page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Never cache a redirected response as the shell: browsers refuse to
          // serve a redirected cached response to a navigation request, which
          // would break the offline fallback exactly when it is needed.
          if (response && response.ok && !response.redirected) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(APP_SHELL_URL, response.clone());
          }
          return response;
        } catch {
          const cached =
            (await caches.match(APP_SHELL_URL)) ?? (await caches.match(request));
          if (cached) return cached;
          throw new Error("offline and no cached app shell");
        }
      })(),
    );
    return;
  }

  // --------------------------------------------------------------- assets
  // Build assets are content-hashed, so cache-first is safe and makes a cold
  // offline start fast. Only static asset destinations are considered.
  const cacheableDestinations = new Set(["script", "style", "font", "image"]);
  if (!cacheableDestinations.has(request.destination)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
