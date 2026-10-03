// Dev helper: measures every page at phone width. Usage: npx tsx scripts/mobile-audit.ts [--shots]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const PAGES = ["/dashboard","/transactions","/spending","/income","/accounts","/budgets","/bills","/payday","/wishlist","/calendar","/goals","/debts","/forecast","/simulator","/planner","/retirement","/resp","/sinking-funds","/networth","/investments","/registered-accounts","/insurance","/subscriptions","/tax","/reports","/monthly-review","/year-in-review","/rules","/import","/finance-documents","/assistant","/api-access","/emergency","/backup","/household","/settings","/notifications","/vehicle-dashboard","/vehicles","/maintenance","/service-history","/repairs","/parts","/reminders","/documents","/vehicle-costs","/expenses","/mileage","/keep-or-replace"];
(async () => {
  const exe = ["/opt/pw-browsers/chromium"].find(existsSync);
  const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`${base}/login`); await p.fill('input[type="email"]', "david@familyfinance.local"); await p.fill('input[type="password"]', "DemoPass123!"); await p.click('button[type="submit"]'); await p.waitForURL("**/dashboard");
  if (process.argv.includes("--shots")) mkdirSync("/tmp/audit", { recursive: true });
  console.log("page".padEnd(24), "overflowX  pageH  chromeH  smallText  smallTap");
  for (const path of PAGES) {
    await p.goto(`${base}${path}`); await p.waitForLoadState("networkidle").catch(() => undefined); await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const main = document.querySelector("main") as HTMLElement | null;
      const h1 = document.querySelector("main h1") as HTMLElement | null;
      let wide = ""; 
      for (const el of Array.from(document.querySelectorAll("main *")) as HTMLElement[]) { const r = el.getBoundingClientRect(); if (r.right > 391 && r.width > 0 && getComputedStyle(el).position !== "fixed") { wide = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`; break; } }
      const small = Array.from(document.querySelectorAll("main *")).filter((e) => e.childNodes.length && Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length;
      const tap = Array.from(document.querySelectorAll("main button, main a, main select, main input")).filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32 && !(e as HTMLInputElement).type?.match(/checkbox|radio|hidden|file/); }).length;
      return { over: de.scrollWidth - de.clientWidth, pageH: de.scrollHeight, chromeH: Math.round(h1 ? h1.getBoundingClientRect().top + window.scrollY : (main?.getBoundingClientRect().top ?? 0)), wide, small, tap };
    });
    console.log(path.padEnd(24), String(m.over).padStart(8), String(m.pageH).padStart(7), String(m.chromeH).padStart(8), String(m.small).padStart(10), String(m.tap).padStart(9), m.over > 0 ? `  <-- ${m.wide}` : m.wide ? `  (child wider: ${m.wide})` : "");
    if (process.argv.includes("--shots")) await p.screenshot({ path: `/tmp/audit/${path.replace(/\//g, "_")}.png` });
  }
  await b.close();
})();
