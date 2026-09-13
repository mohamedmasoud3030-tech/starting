/**
 * Recovery for stale lazy chunks.
 *
 * Every page is a content-hashed lazy chunk. After a new deploy, a tab still
 * running the previous build (or a service worker that served the previous
 * shell) asks for a chunk that no longer exists → 404 →
 * "Failed to fetch dynamically imported module". Without handling, this
 * surfaces as a full-screen error on any page not yet visited.
 *
 * Strategy: reload the page ONCE (guarded by sessionStorage so a genuinely
 * broken deploy can't loop). The reload fetches the fresh index.html, which
 * references the new chunk hashes.
 */

const RELOAD_GUARD_KEY = "jiwdah:chunk-reload-at";
const RELOAD_GUARD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /Unable to preload CSS/i,
  /'text\/html' is not a valid JavaScript MIME type/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String((error as { message?: unknown }).message ?? "");
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function canReloadNow(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
    return Date.now() - last > RELOAD_GUARD_WINDOW_MS;
  } catch {
    return true;
  }
}

function markReloaded(): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

/** Reload once to pick up the fresh build. Returns false if we already
 *  reloaded very recently (so the caller can show a real error instead). */
export function reloadForFreshBuild(): boolean {
  if (typeof window === "undefined") return false;
  if (!canReloadNow()) return false;
  markReloaded();
  window.location.reload();
  return true;
}

/**
 * Wire the global listeners once at boot:
 *  - Vite's `vite:preloadError` fires when a dynamic import's chunk 404s.
 *  - `unhandledrejection` covers engines/paths that bypass the Vite hook.
 */
export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    if (!reloadForFreshBuild()) {
      console.error("Stale chunk after recent reload; not reloading again.", event);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason) && reloadForFreshBuild()) {
      event.preventDefault();
    }
  });
}
