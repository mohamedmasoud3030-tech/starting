/**
 * Registers the service worker that gives the app an offline-capable shell.
 *
 * UPDATE BEHAVIOUR
 * ----------------
 * A stale cached build is an operational hazard: an operator could keep using
 * an old bundle against a newer database contract. The worker calls
 * `skipWaiting()` on install, so once a new version is fetched it takes over
 * immediately, and this registration reloads the page ONCE on controller
 * change so the running tab picks up the new build instead of lingering.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Service worker registration failed", error);
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Guard against a reload loop if the controller changes more than once.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
