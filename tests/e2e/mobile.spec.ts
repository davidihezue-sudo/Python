import { expect, test } from "@playwright/test";
import { addBmwFromTemplate, prisma, registerVerifyLogin, uniqueEmail } from "./helpers";

test.afterAll(async () => prisma.$disconnect());

test("mobile: bottom navigation, quick add, no horizontal overflow, PWA basics", async ({ page }) => {
  await registerVerifyLogin(page, uniqueEmail("m"));
  await addBmwFromTemplate(page);
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden(); // desktop sidebar hidden

  for (const path of ["/dashboard", "/vehicles", "/maintenance", "/service-history", "/repairs", "/parts", "/expenses", "/reminders", "/reports", "/documents", "/settings", "/service-history/new"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }

  await page.goto("/dashboard");
  await nav.getByRole("button", { name: "Quick add" }).click();
  await expect(page.getByRole("menuitem", { name: "Add fuel" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Add fuel" }).click();
  await expect(page.getByRole("dialog", { name: "Add fuel" })).toBeVisible();
  await page.keyboard.press("Escape");

  // secondary navigation
  await nav.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("link", { name: "Reports & Analytics" })).toBeVisible();

  // PWA: manifest is valid and installable metadata is present
  const m = await (await page.request.get("/manifest.webmanifest")).json();
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i: any) => i.sizes === "512x512")).toBe(true);
  expect(m.icons.some((i: any) => i.purpose === "maskable")).toBe(true);
  expect((await page.request.get("/sw.js")).status()).toBe(200);
  expect((await page.request.get("/icons/icon-192.png")).status()).toBe(200);
});

test("offline: previously loaded data stays readable and drafts sync when back online", async ({ page, context }) => {
  await registerVerifyLogin(page, uniqueEmail("off"));
  const vehicleId = await addBmwFromTemplate(page);
  // wait for the service worker to take control, then load the pages we'll want offline
  await page.goto("/vehicles");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto(`/vehicles/${vehicleId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "My X3" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My X3" })).toBeVisible(); // served from the offline cache
  await expect(page.getByText(/You're offline/)).toBeVisible();

  // create a mileage draft while offline
  await page.getByRole("button", { name: "Update mileage" }).click();
  await page.getByLabel("Odometer").fill("123456");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("Saved offline")).toBeVisible();
  expect(await prisma.odometerEntry.count({ where: { vehicleId, valueKm: 123456 } })).toBe(0);

  await context.setOffline(false);
  await expect.poll(async () => prisma.odometerEntry.count({ where: { vehicleId, valueKm: 123456 } }), { timeout: 20_000 }).toBe(1);
});
