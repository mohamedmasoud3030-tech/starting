import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-OM", timezoneId: "Asia/Muscat" });
const p = await ctx.newPage();
const shot = async (n) => { await p.waitForTimeout(3000); await p.screenshot({ path: `d-${n}.png` }); console.log(n); };
await p.goto("https://jiwdah.vercel.app/login", { waitUntil: "networkidle" }); await shot("login");
await p.fill('input[type="email"]', "Demo@jiwdah.com"); await p.fill('input[type="password"]', "123456");
await p.click('button[type="submit"]'); await p.waitForURL(u => !u.pathname.includes("login"), { timeout: 30000 });
await p.waitForLoadState("networkidle"); await shot("home");
for (const [n, path] of [["events","/events"],["staff","/staff"],["accounting","/accounting"],["customers","/customers"],["packages","/packages"],["consumables","/consumables"],["catalog","/catalog"],["operations","/operations"],["dashboard","/dashboard"],["settings","/settings"]]) {
  await p.goto("https://jiwdah.vercel.app"+path, { waitUntil: "networkidle" }); await shot(n);
}
await p.goto("https://jiwdah.vercel.app/events", { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
await p.getByText(/EV-2026-00001/).first().click(); await p.waitForURL(/\/events\/[0-9a-f-]+/); await shot("event");
const u = p.url().split("?")[0];
for (const t of ["المعدات","المخزن","المواد","الحضور","المدفوعات"]) { await p.goto(u+"?tab="+encodeURIComponent(t), { waitUntil: "networkidle" }); await shot("event-"+t); }
await b.close();
