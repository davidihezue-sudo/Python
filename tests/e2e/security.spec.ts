import { expect, test } from "@playwright/test";
import { apiJson, login, prisma, registerVerifyLogin, uniqueEmail, PASSWORD } from "./helpers";

test.afterAll(async () => prisma.$disconnect());

test("unauthenticated access is rejected and pages redirect to login", async ({ page, request }) => {
  for (const p of ["/api/vehicles", "/api/expenses", "/api/documents", "/api/users/me", "/api/admin/stats"]) expect((await request.get(p)).status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("security headers: CSP with nonce, no framing, nosniff", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("CSRF: cross-origin state-changing requests are blocked; same-origin works; cookies are HttpOnly", async ({ page, context }) => {
  const email = uniqueEmail("sec");
  await registerVerifyLogin(page, email);
  const cookies = await context.cookies();
  const sess = cookies.find((c) => c.name === "av_session")!;
  expect(sess.httpOnly).toBe(true);
  expect(sess.sameSite).toBe("Lax");
  const evil = await apiJson(context, "/api/households", { method: "POST", data: { name: "x" }, headers: { origin: "https://evil.example", "content-type": "application/json" } });
  expect(evil.status).toBe(403);
  const crossSite = await apiJson(context, "/api/households", { method: "POST", data: { name: "x" }, headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" } });
  expect(crossSite.status).toBe(403);
  const ok = await apiJson(context, "/api/households", { method: "POST", data: { name: "Second household" }, headers: { origin: new URL(page.url()).origin, "content-type": "application/json" } });
  expect(ok.status).toBe(201);
});

test("login is rate limited and errors never reveal whether an account exists", async ({ request }) => {
  const email = uniqueEmail("rl");
  let last = 0;
  let msg = "";
  for (let i = 0; i < 12; i++) {
    const r = await request.post("/api/auth/login", { data: { email, password: "wrong-password-1" }, headers: { "content-type": "application/json" } });
    last = r.status();
    if (i === 0) msg = (await r.json()).error.message;
  }
  expect(msg).toBe("Invalid email or password");
  expect(last).toBe(429);
});

test("uploads: spoofed content, oversized files and cross-user downloads are rejected; files are served nosniff", async ({ page, browser }) => {
  const email = uniqueEmail("up");
  await registerVerifyLogin(page, email);
  const vres = await page.request.post("/api/vehicles", { data: { make: "Honda", model: "Civic", year: 2012, nickname: "U", applySuggestedSchedules: false, fuelType: "PETROL", ownershipStatus: "OWNED" } });
  const vid = (await vres.json()).data.id;
  const html = Buffer.from("<html><script>alert(1)</script></html>");
  const bad = await page.request.post("/api/documents", { multipart: { file: { name: "evil.png", mimeType: "image/png", buffer: html }, vehicleId: vid, category: "OTHER" } });
  expect(bad.status()).toBe(415);
  const big = await page.request.post("/api/documents", { multipart: { file: { name: "big.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(11 * 1024 * 1024)]) }, vehicleId: vid, category: "OTHER" } });
  expect([413, 400]).toContain(big.status());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const good = await page.request.post("/api/documents", { multipart: { file: { name: "ok.png", mimeType: "application/octet-stream", buffer: png }, vehicleId: vid, category: "OTHER" } });
  expect(good.status()).toBe(201);
  const doc = (await good.json()).data.document;
  const f = await page.request.get(doc.url);
  expect(f.status()).toBe(200);
  expect(f.headers()["content-type"]).toBe("image/png");
  expect(f.headers()["x-content-type-options"]).toBe("nosniff");
  // another signed-in user cannot download it
  const other = await browser.newContext();
  const op = await other.newPage();
  await registerVerifyLogin(op, uniqueEmail("other"));
  expect((await other.request.get(doc.url)).status()).toBe(404);
  // anonymous cannot either
  const anon = await browser.newContext();
  expect((await anon.request.get(doc.url)).status()).toBe(401);
  await other.close(); await anon.close();
});

test("data export and account deletion", async ({ page }) => {
  const email = uniqueEmail("del");
  await registerVerifyLogin(page, email);
  await page.request.post("/api/vehicles", { data: { make: "Mazda", model: "3", year: 2018, nickname: "M3", applySuggestedSchedules: false, fuelType: "PETROL", ownershipStatus: "OWNED" } });
  const exp = await page.request.get("/api/users/me/export");
  expect(exp.status()).toBe(200);
  const body = await exp.json();
  expect(body.format).toBe("autovault-export-v1");
  expect(body.vehicles).toHaveLength(1);
  await page.goto("/settings?tab=privacy");
  await page.getByRole("button", { name: /Delete my account/ }).click();
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await page.waitForURL(/login\?deleted=1/);
  expect(await prisma.user.count({ where: { email } })).toBe(0);
  await login(page, email).catch(() => undefined);
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("admin area is limited to platform administrators and exposes no vehicle data", async ({ page }) => {
  const adminEmail = "admin-e2e@example.com";
  await registerVerifyLogin(page, adminEmail, "Platform Admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  const stats = await page.request.get("/api/admin/stats");
  expect(stats.status()).toBe(200);
  expect(JSON.stringify(await stats.json())).not.toMatch(/Civic|Mazda|nickname/);
  const regular = await page.context().browser()!.newContext();
  const rp = await regular.newPage();
  await registerVerifyLogin(rp, uniqueEmail("reg"));
  expect((await regular.request.get("/api/admin/stats")).status()).toBe(403);
  await regular.close();
});
