import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import process from "node:process";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const REQUEST_TIMEOUT_MS = 5_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await request("/login", { redirect: "manual" });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Production preview did not become ready: ${lastError ?? "timeout"}`);
}

async function assertSpaRoute(pathname) {
  const response = await request(pathname, { redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, `${pathname} returned HTTP ${response.status}`);
  assert(
    response.headers.get("content-type")?.includes("text/html"),
    `${pathname} did not return HTML`,
  );
  assert(body.includes('id="root"'), `${pathname} did not return the application shell`);
}

async function assertPwaFiles() {
  const manifestResponse = await request("/manifest.webmanifest");
  assert(manifestResponse.status === 200, "manifest.webmanifest is not served");
  const manifest = await manifestResponse.json();
  assert(manifest.lang === "ar", "PWA manifest language must be Arabic");
  assert(manifest.dir === "rtl", "PWA manifest direction must be RTL");
  assert(manifest.start_url === "/home", "PWA manifest start_url must be /home");
  assert(
    manifest.icons?.some((icon) => icon.src === "/pwa-192.png" && icon.sizes === "192x192"),
    "PWA manifest must include the 192px PNG icon",
  );
  assert(
    manifest.icons?.some((icon) => icon.src === "/pwa-512.png" && icon.sizes === "512x512"),
    "PWA manifest must include the 512px PNG icon",
  );

  for (const iconPath of ["/apple-touch-icon.png", "/pwa-192.png", "/pwa-512.png"]) {
    const iconResponse = await request(iconPath);
    assert(iconResponse.status === 200, `${iconPath} is not served`);
    assert(
      iconResponse.headers.get("content-type")?.includes("image/png"),
      `${iconPath} must be served as PNG`,
    );
  }

  const indexResponse = await request("/");
  const indexSource = await indexResponse.text();
  assert(
    indexSource.includes('rel="apple-touch-icon"') &&
      indexSource.includes('/apple-touch-icon.png'),
    "index.html must expose the iOS apple-touch-icon",
  );
  assert(
    indexSource.includes("viewport-fit=cover"),
    "index.html viewport must enable iOS safe-area layout",
  );
  // Fonts are self-hosted (@fontsource): no runtime font requests may leave
  // the deployment, and the service worker can cache them for offline use.
  assert(
    !indexSource.includes("fonts.googleapis.com") &&
      !indexSource.includes("fonts.gstatic.com"),
    "index.html must not load fonts from an external CDN",
  );

  const workerResponse = await request("/sw.js");
  assert(workerResponse.status === 200, "sw.js is not served");
  const workerSource = await workerResponse.text();
  assert(workerSource.includes("cacheableDestinations"), "Service worker lost static-only cache guard");
  assert(!workerSource.includes("/rest/v1/"), "Service worker must not cache Supabase REST traffic");
  assert(!workerSource.includes("/auth/v1/"), "Service worker must not cache Supabase Auth traffic");
  // The app must OPEN offline on a site/warehouse phone: navigations need a
  // cached app-shell fallback, not the browser's offline error page.
  assert(
    workerSource.includes('request.mode === "navigate"'),
    "Service worker must handle navigations to provide an offline app shell",
  );
  assert(
    workerSource.includes("APP_SHELL_URL"),
    "Service worker must fall back to a cached app shell when offline",
  );
  // Non-GET traffic (every command/mutation) must never be intercepted.
  assert(
    workerSource.includes('request.method !== "GET"'),
    "Service worker must never intercept mutations",
  );
}

async function assertBuildIsSplit() {
  const files = await readdir("dist/assets");
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  assert(jsFiles.length >= 4, `Expected route-level code splitting, found only ${jsFiles.length} JS file(s)`);

  const sizes = await Promise.all(
    jsFiles.map(async (file) => ({
      file,
      size: (await stat(`dist/assets/${file}`)).size,
    })),
  );
  sizes.sort((a, b) => b.size - a.size);

  const largest = sizes[0];
  assert(largest, "No JavaScript chunks were emitted");
  assert(
    largest.size <= 500 * 1024,
    `Largest production JS chunk is ${(largest.size / 1024).toFixed(1)} KiB; expected <= 500 KiB`,
  );

  console.log("Production JS chunks:");
  for (const item of sizes) {
    console.log(`  ${item.file}: ${(item.size / 1024).toFixed(1)} KiB`);
  }
}

async function assertVercelContract() {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert(
    config.rewrites?.some((rewrite) => rewrite.destination === "/index.html"),
    "vercel.json must preserve SPA fallback to /index.html",
  );

  const serializedHeaders = JSON.stringify(config.headers ?? []);
  assert(serializedHeaders.includes("X-Content-Type-Options"), "Missing nosniff deployment header");
  assert(serializedHeaders.includes("X-Frame-Options"), "Missing clickjacking deployment header");
  assert(serializedHeaders.includes("Referrer-Policy"), "Missing referrer deployment header");

  // Defense-in-depth CSP: scripts/fonts/images self-hosted, API traffic only
  // to Supabase, nothing framed, no object embedding.
  assert(serializedHeaders.includes("Content-Security-Policy"), "Missing CSP deployment header");
  assert(
    serializedHeaders.includes("script-src 'self'") &&
      serializedHeaders.includes("connect-src 'self' https://*.supabase.co") &&
      serializedHeaders.includes("frame-ancestors 'none'"),
    "CSP must lock scripts to self, connections to Supabase and forbid framing",
  );
}

const viteBinary = process.platform === "win32" ? "node_modules/.bin/vite.cmd" : "node_modules/.bin/vite";
const preview = spawn(viteBinary, ["preview", "--host", HOST, "--port", String(PORT)], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += chunk.toString();
});
preview.stderr.on("data", (chunk) => {
  previewOutput += chunk.toString();
});

try {
  await waitForServer();

  for (const route of [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/home",
    "/events",
    "/quotes",
    "/procurement",
    "/consumables",
    "/catalog",
    "/packages",
    "/customers",
    "/staff",
  ]) {
    await assertSpaRoute(route);
  }

  await assertPwaFiles();
  await assertBuildIsSplit();
  await assertVercelContract();

  console.log("Production smoke proof passed.");
} catch (error) {
  if (previewOutput) {
    console.error(previewOutput);
  }
  throw error;
} finally {
  if (preview.exitCode === null) {
    preview.kill("SIGTERM");
  }

  if (preview.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      preview.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
