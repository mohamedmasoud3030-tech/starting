import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import process from "node:process";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Production preview did not become ready: ${lastError ?? "timeout"}`);
}

async function assertSpaRoute(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`, { redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, `${pathname} returned HTTP ${response.status}`);
  assert(
    response.headers.get("content-type")?.includes("text/html"),
    `${pathname} did not return HTML`,
  );
  assert(body.includes('id="root"'), `${pathname} did not return the application shell`);
}

async function assertPwaFiles() {
  const manifestResponse = await fetch(`${BASE_URL}/manifest.webmanifest`);
  assert(manifestResponse.status === 200, "manifest.webmanifest is not served");
  const manifest = await manifestResponse.json();
  assert(manifest.lang === "ar", "PWA manifest language must be Arabic");
  assert(manifest.dir === "rtl", "PWA manifest direction must be RTL");
  assert(manifest.start_url === "/home", "PWA manifest start_url must be /home");

  const workerResponse = await fetch(`${BASE_URL}/sw.js`);
  assert(workerResponse.status === 200, "sw.js is not served");
  const workerSource = await workerResponse.text();
  assert(workerSource.includes("cacheableDestinations"), "Service worker lost static-only cache guard");
  assert(!workerSource.includes("/rest/v1/"), "Service worker must not cache Supabase REST traffic");
  assert(!workerSource.includes("/auth/v1/"), "Service worker must not cache Supabase Auth traffic");
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
}

const preview = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "preview", "--", "--host", HOST, "--port", String(PORT)],
  {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

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
  preview.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    preview.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
