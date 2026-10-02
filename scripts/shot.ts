// Dev helper: screenshots pages as the demo user. Usage: npx tsx scripts/shot.ts /dashboard [/other ...] [--mobile] [--dark]
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const mobile = args.includes("--mobile");
const dark = args.includes("--dark");
const paths = args.filter((a) => a.startsWith("/"));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.env.SHOT_DIR ?? "/tmp/shots";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light", isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("favicon") && errors.push(`[http ${r.status()}] ${r.url().replace(base, "")}`));
  await page.goto(`${base}/login`);
  await page.fill('input[type="email"]', "demo@autovault.local");
  await page.fill('input[type="password"]', "DemoPass123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
  const fs = await import("node:fs");
  fs.mkdirSync(out, { recursive: true });
  for (const p of paths) {
    await page.goto(`${base}${p}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(700);
    const file = `${out}/${p.replace(/[^a-z0-9]+/gi, "_")}${mobile ? "_m" : ""}${dark ? "_d" : ""}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", file);
  }
  if (errors.length) console.log("ISSUES:\n" + [...new Set(errors)].join("\n"));
  await browser.close();
})();
