import { chromium, devices } from "playwright";
const b = await chromium.launch({ args: ["--no-sandbox"] });
for (const [tag, opts] of [["d",{ viewport:{width:1440,height:900} }],["m",{ ...devices["iPhone 13"] }]]) {
  const ctx = await b.newContext({ ...opts, locale: "ar-OM", timezoneId: "Asia/Muscat" });
  const p = await ctx.newPage();
  await p.goto("https://jiwdah.vercel.app/login", { waitUntil: "networkidle" });
  await p.fill('input[type="email"]', "Demo@jiwdah.com"); await p.fill('input[type="password"]', "123456");
  await p.click('button[type="submit"]'); await p.waitForURL(u => !u.pathname.includes("login"), { timeout: 30000 });
  await p.goto("https://jiwdah.vercel.app/consumables", { waitUntil: "networkidle" }); await p.waitForTimeout(3500);
  await p.screenshot({ path: `wh-${tag}-materials.png` });
  await p.getByRole("button", { name: "العدة" }).first().click(); await p.waitForTimeout(3500);
  await p.screenshot({ path: `wh-${tag}-kit.png` });
  await ctx.close();
}
await b.close();
