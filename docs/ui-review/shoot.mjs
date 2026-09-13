import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = "https://jiwdah.vercel.app";
const OUT = "/home/user/shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  locale: "ar-OM",
  timezoneId: "Asia/Muscat",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("supabase")) errors.push(`HTTP ${r.status()} ${r.url().split("/rest/v1/")[1] ?? r.url()}`); });

async function shot(name, full = true) {
  await page.waitForTimeout(4000); await page.locator(".animate-pulse").first().waitFor({state:"detached",timeout:15000}).catch(()=>{});
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("shot", name);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot("01-login", false);
await page.fill('input[type="email"]', "Demo@jiwdah.com");
await page.fill('input[type="password"]', "123456");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
await page.waitForLoadState("networkidle");
await shot("02-home");

const routes = [
  ["03-events", "/events"],
  ["05-staff", "/staff"],
  ["06-accounting", "/accounting"],
  ["07-customers", "/customers"],
  ["08-packages", "/packages"],
  ["09-consumables", "/consumables"],
  ["10-settings", "/settings"],
];
for (const [name, path] of routes) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await shot(name);
}

// first event workspace
await page.goto(BASE + "/events", { waitUntil: "networkidle" });
const link = page.getByText(/EV-2026-00001/).first();
if (await link.count()) {
  await link.click();
  await page.waitForURL(/\/events\/[0-9a-f-]+/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await shot("04-event-workspace");
  const evUrl = page.url().split("?")[0];
  for (const [n, tab] of [["a","التسعير"],["b","الفريق"],["c","المعدات"],["d","الحضور"],["e","المدفوعات"],["f","المالية"]]) {
    await page.goto(evUrl + "?tab=" + encodeURIComponent(tab), { waitUntil: "networkidle" });
    await shot(`04${n}-event-${tab}`);
  }
}

// more menu
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
const more = page.getByRole("button", { name: /المزيد/ }).first();
if (await more.count()) { await more.click(); await shot("11-more-menu", false); }

// quick event dialog
await page.goto(BASE + "/home", { waitUntil: "networkidle" });
const q = page.getByRole("button", { name: /مناسبة جديدة/ }).first();
if (await q.count()) { await q.click(); await shot("12-quick-event", false); }

fs.writeFileSync(`${OUT}/errors.txt`, errors.join("\n"));
console.log("errors:", errors.length);
await browser.close();
