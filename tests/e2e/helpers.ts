import { expect, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({ datasourceUrl: "postgresql://autovault:autovault@localhost:5432/autovault_e2e?schema=public" });
export const PASSWORD = "CorrectHorse9!";
let n = 0;
export const uniqueEmail = (p = "e2e") => `${p}-${Date.now()}-${++n}@example.com`;

export async function lastToken(email: string, subject: string) {
  for (let i = 0; i < 20; i++) {
    const m = await prisma.emailOutbox.findFirst({ where: { toEmail: email, subject: { contains: subject } }, orderBy: { createdAt: "desc" } });
    if (m) return /token=([\w-]+)/.exec(m.text)?.[1] ?? /invite\/([\w-]+)/.exec(m.text)?.[1] ?? null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Registers through the UI, verifies via the emailed link, and signs in. */
export async function registerVerifyLogin(page: Page, email: string, name = "Ada Tester") {
  // each simulated user gets its own client IP so per-IP rate limits (register: 8/10min) don't trip across tests
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
  await page.goto("/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel(/I agree to the privacy policy/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const token = await lastToken(email, "Verify");
  expect(token).toBeTruthy();
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
  await login(page, email);
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Adds the BMW X3 starter profile through the UI. Returns the vehicle id from the URL. */
export async function addBmwFromTemplate(page: Page) {
  await page.goto("/vehicles/new");
  await page.getByRole("button", { name: /2015 BMW X3 28i/ }).click();
  await expect(page.getByLabel("Make")).toHaveValue("BMW");
  await expect(page.getByLabel(/^Model\s*\*?$/)).toHaveValue("X3");
  await page.getByLabel("Nickname").fill("My X3");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await page.waitForURL(/\/vehicles\/(?!new)[a-z0-9]+/);
  return page.url().split("/vehicles/")[1].split("?")[0];
}

export const apiJson = async (ctx: BrowserContext, path: string, init?: { method?: string; data?: unknown; headers?: Record<string, string> }) => {
  const res = await ctx.request.fetch(path, { method: init?.method ?? "GET", data: init?.data as any, headers: init?.headers });
  return { status: res.status(), body: await res.json().catch(() => null) };
};
