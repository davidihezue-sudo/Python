import { expect, test } from "@playwright/test";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { addBmwFromTemplate, apiJson, lastToken, login, prisma, registerVerifyLogin, uniqueEmail, PASSWORD } from "./helpers";

test.afterAll(async () => prisma.$disconnect());

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fixture = (name: string, data: Buffer) => {
  mkdirSync("test-results/fixtures", { recursive: true });
  const p = path.resolve("test-results/fixtures", name);
  writeFileSync(p, data);
  return p;
};

test("Journey A: new user → verify → household → BMW X3 → odometer → schedules → dashboard", async ({ page }) => {
  const email = uniqueEmail("a");
  await registerVerifyLogin(page, email);
  // empty dashboard offers the first action
  await expect(page.getByRole("heading", { name: "Add your first vehicle" })).toBeVisible();

  // household: rename the auto-created household in Settings
  await page.goto("/settings?tab=household");
  await page.getByLabel("Household name").first().fill("Tester Family");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Household renamed")).toBeVisible();

  const vehicleId = await addBmwFromTemplate(page);
  await expect(page.getByRole("heading", { name: "My X3" })).toBeVisible();

  // starter profile: checklist created, no fabricated history
  await page.getByRole("tab", { name: "Maintenance" }).click();
  await page.getByLabel("Filter by status").selectOption("all");
  await expect(page.getByText("Engine oil", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Spark plugs").first()).toBeVisible();
  await expect(page.locator("span, div, p", { hasText: "Unknown history" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Service history" }).click();
  await expect(page.getByText("No service history")).toBeVisible();

  // enter the odometer via Quick add
  await page.getByRole("button", { name: "Quick add" }).first().click();
  await page.getByRole("menuitem", { name: "Update mileage" }).click();
  await page.getByLabel("Odometer").fill("168000");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("Mileage updated")).toBeVisible();

  // configure a schedule: tell it the oil was last changed at 160,000 km
  await page.getByRole("tab", { name: "Maintenance" }).click();
  await page.getByLabel("Filter by status").selectOption("all");
  await page.getByLabel("Edit Engine oil").click();
  await page.getByLabel(/^Date\s*\*?$/).fill("2024-01-01");
  await page.getByLabel(/^Odometer\s*\*?$/).fill("160000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Schedule updated")).toBeVisible();
  const oil = await prisma.maintenanceScheduleAssignment.findFirstOrThrow({ where: { vehicleId, name: "Engine oil" } });
  expect(Number(oil.nextDueKm)).toBe(170000); // 160,000 + suggested 10,000 km
  expect(oil.sourceType).toBe("SUGGESTED"); // only the history changed, so the library suggestion stays labelled as a suggestion

  // dashboard shows real database information
  await page.goto("/dashboard");
  await expect(page.getByText("168,000 km").first()).toBeVisible();
  await expect(page.getByText("My X3").first()).toBeVisible();
  await expect(page.getByText("Engine oil").first()).toBeVisible();
});

test("Journey B + C + D: oil change with receipt, repair lifecycle, mileage-triggered notification", async ({ page }) => {
  const email = uniqueEmail("b");
  await registerVerifyLogin(page, email);
  const vehicleId = await addBmwFromTemplate(page);
  await prisma.userPreference.updateMany({ where: { user: { email } }, data: { alertKmBefore: [1000, 500] } });

  await page.getByRole("button", { name: "Quick add" }).first().click();
  await page.getByRole("menuitem", { name: "Update mileage" }).click();
  await page.getByLabel("Odometer").fill("160000");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("Mileage updated")).toBeVisible();

  // ── Journey B: record the oil change from the schedule
  await page.goto(`/vehicles/${vehicleId}?tab=schedule`);
  await page.getByLabel("Filter by status").selectOption("all");
  await page.getByRole("link", { name: "Record" }).first().waitFor();
  const oil = await prisma.maintenanceScheduleAssignment.findFirstOrThrow({ where: { vehicleId, name: "Engine oil" } });
  await page.goto(`/service-history/new?assignmentId=${oil.id}`);
  await expect(page.getByLabel("Title")).toHaveValue("Engine oil"); // prefilled from the schedule
  await expect(page.getByLabel("Item name").first()).toHaveValue("Engine oil");
  await expect(page.getByLabel("Item name").nth(1)).toHaveValue("Oil filter");
  await page.getByLabel("Service date").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Odometer").fill("160500");
  await page.getByLabel("Service provider").selectOption("__new");
  await page.getByPlaceholder("Workshop name").fill("Calgary Lube");
  for (const summary of await page.getByText("Parts & cost details").all()) await summary.click();
  await page.getByLabel("Part replaced").first().fill("Synthetic 5W-30");
  await page.getByLabel("Part replaced").nth(1).fill("Oil filter");
  await page.getByLabel(/^Parts\s*\*?$/).fill("65.5");
  await page.getByLabel(/^Labour\s*\*?$/).fill("40");
  await page.getByLabel(/^Tax\s*\*?$/).fill("5.28");
  await expect(page.getByText("Total $110.78")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(fixture("receipt.png", png));
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Service recorded")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Oil change").or(page.getByRole("dialog").getByText("Engine oil")).first()).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: /receipt/i })).toBeVisible(); // receipt attached

  const rec = await prisma.maintenanceRecord.findFirstOrThrow({ where: { vehicleId } });
  expect(Number(rec.totalCost)).toBe(110.78);
  const oil2 = await prisma.maintenanceScheduleAssignment.findUniqueOrThrow({ where: { id: oil.id } });
  expect(Number(oil2.lastCompletedKm)).toBe(160500);
  expect(Number(oil2.nextDueKm)).toBe(170500);
  expect(await prisma.expense.count({ where: { vehicleId, category: "MAINTENANCE" } })).toBe(1);
  // service history + next service calculation visible in the UI
  await page.goto(`/vehicles/${vehicleId}?tab=history`);
  await expect(page.getByText("Calgary Lube").first()).toBeVisible();
  await page.goto(`/vehicles/${vehicleId}?tab=schedule`);
  await page.getByLabel("Filter by status").selectOption("all");
  await expect(page.getByText(/next at 170,500 km/).first()).toBeVisible();

  // ── Journey D: mileage approaches the next oil service → notification → open → complete → recalculated
  await page.getByRole("button", { name: "Quick add" }).first().click();
  await page.getByRole("menuitem", { name: "Update mileage" }).click();
  await page.getByLabel("Odometer").fill("169700");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByText("Mileage updated")).toBeVisible();
  // the scheduled job (HTTP cron endpoint, bearer-protected) generates the notification — no user session involved
  const bad = await page.request.post("/api/cron/run?job=notifications.generate", { headers: { authorization: "Bearer wrong" } });
  expect(bad.status()).toBe(401);
  const cron = await page.request.post("/api/cron/run?job=notifications.generate", { headers: { authorization: `Bearer ${CRON}` } });
  expect(cron.status()).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const notes = await prisma.notification.findMany({ where: { userId: user.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } });
  expect(notes).toHaveLength(1);
  expect(notes[0].title).toMatch(/Engine oil/);
  // running again never duplicates
  await page.request.post("/api/cron/run?job=notifications.generate", { headers: { authorization: `Bearer ${CRON}` } });
  expect(await prisma.notification.count({ where: { userId: user.id, dedupeKey: { startsWith: `maint:${oil.id}:` } } })).toBe(1);

  // open the reminder from the notification inbox
  await page.goto("/reminders#notifications");
  await expect(page.getByText(/Engine oil coming up/)).toBeVisible();
  await page.getByRole("button", { name: "Open" }).first().click();
  await page.waitForURL(/tab=schedule/);
  expect((await prisma.notification.findUniqueOrThrow({ where: { id: notes[0].id } })).actionedAt).not.toBeNull();

  // complete the maintenance and verify the schedule recalculated
  await page.goto(`/service-history/new?assignmentId=${oil.id}`);
  await expect(page.getByLabel("Title")).toHaveValue("Engine oil"); // wait for the prefill so it can't overwrite our input
  await page.getByLabel("Odometer").fill("169800");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Service recorded")).toBeVisible();
  const after = await prisma.maintenanceScheduleAssignment.findUniqueOrThrow({ where: { id: oil.id } });
  expect(Number(after.lastCompletedKm)).toBe(169800);
  expect(Number(after.nextDueKm)).toBe(179800);
  expect(after.status).toBe("UP_TO_DATE");
});

test("Journey C: report issue with photo → diagnostic code → repair → resolved → expense analytics", async ({ page }) => {
  const email = uniqueEmail("c");
  await registerVerifyLogin(page, email);
  const vehicleId = await addBmwFromTemplate(page);
  await page.getByRole("button", { name: "Quick add" }).first().click();
  await page.getByRole("menuitem", { name: "Report a vehicle issue" }).click();
  await page.getByLabel("What's wrong?").fill("Coolant leak");
  await page.getByLabel("Description").fill("Puddle under the engine after parking");
  await page.getByLabel("Severity").selectOption("HIGH");
  await page.getByLabel(/Photos/).setInputFiles(fixture("leak.png", png));
  await page.getByRole("button", { name: "Report issue" }).click();
  await page.waitForURL(/\/repairs\?issue=/);
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Coolant leak")).toBeVisible();
  await expect(dlg.locator("img").first()).toBeVisible(); // photo attached

  // diagnostic findings: a generic code is explained but never presented as a diagnosis
  await dlg.getByRole("button", { name: "Add code" }).click();
  await page.getByRole("dialog", { name: "Add diagnostic trouble code" }).getByLabel("Code").fill("P0128");
  await expect(page.getByText(/not a diagnosis/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(dlg.getByText("P0128")).toBeVisible();

  // lifecycle
  await dlg.getByLabel("Lifecycle status").selectOption("DIAGNOSED");
  await expect(page.getByText("Status: Diagnosis completed").or(page.getByText("Status: Diagnosed"))).toBeVisible();

  // create the repair record with cost → issue resolved
  await dlg.getByRole("button", { name: "Convert to completed repair" }).click();
  await page.getByLabel("Parts cost").fill("245");
  await page.getByLabel("Labour cost").fill("320");
  await page.getByLabel(/^Tax\s*\*?$/).fill("28.25");
  await page.getByRole("button", { name: "Record repair" }).click();
  await expect(page.getByText("Repair recorded and issue resolved")).toBeVisible();
  const issue = await prisma.repairIssue.findFirstOrThrow({ where: { vehicleId } });
  expect(issue.status).toBe("RESOLVED");
  expect(Number(issue.actualCost)).toBe(593.25);

  // analytics reflect it
  await page.goto("/reports");
  await page.getByLabel("Date range").selectOption("all");
  await expect(page.getByText("$593.25").first()).toBeVisible();
});

test("Journey E: household invite, scoped access, and blocked unauthorized access", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const spouseCtx = await browser.newContext();
  const outsiderCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const spouse = await spouseCtx.newPage();
  const outsider = await outsiderCtx.newPage();
  const ownerEmail = uniqueEmail("owner");
  const spouseEmail = uniqueEmail("spouse");
  await registerVerifyLogin(owner, ownerEmail, "Olivia Owner");
  const sharedId = await addBmwFromTemplate(owner);
  await owner.goto("/vehicles/new");
  await owner.getByLabel("Make").fill("Honda");
  await owner.getByLabel(/^Model\s*\*?$/).fill("Civic");
  await owner.getByLabel("Model year").fill("2012");
  await owner.getByLabel("Nickname").fill("Private Civic");
  await owner.getByRole("button", { name: "Add vehicle" }).click();
  await owner.waitForURL(/\/vehicles\/(?!new)[a-z0-9]+/);
  const privateId = owner.url().split("/vehicles/")[1].split("?")[0];

  // spouse registers first (so their address is verified), then the owner invites with access to ONE vehicle
  await registerVerifyLogin(spouse, spouseEmail, "Sam Spouse");
  await owner.goto("/settings?tab=household");
  await owner.getByRole("button", { name: "Invite a family member" }).click();
  await owner.getByLabel("Email").fill(spouseEmail);
  await owner.getByRole("checkbox", { name: "My X3" }).check();
  await owner.getByLabel("Access level for My X3").selectOption("MAINTENANCE_MANAGER");
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByRole("heading", { name: "Invitation created" })).toBeVisible();
  const token = await lastToken(spouseEmail, "invited");
  expect(token).toBeTruthy();

  await spouse.goto(`/invite/${token}`);
  await spouse.getByRole("button", { name: "Accept invitation" }).click();
  await expect(spouse.getByText("You've joined the household")).toBeVisible();

  // permitted: sees the shared vehicle (and can log mileage), but not the private one
  await spouse.goto("/vehicles");
  await expect(spouse.getByText("My X3")).toBeVisible();
  await expect(spouse.getByText("Private Civic")).toHaveCount(0);
  await spouse.goto(`/vehicles/${sharedId}`);
  await expect(spouse.getByText(/maintenance manager access/)).toBeVisible();
  await expect(spouse.getByRole("tab", { name: "Expenses" })).toHaveCount(0); // costs hidden
  await expect(spouse.getByRole("tab", { name: "Sharing & access" })).toHaveCount(0);

  // blocked: direct API/URL access to the private vehicle and its data (404, not 403 — existence isn't leaked)
  expect((await apiJson(spouseCtx, `/api/vehicles/${privateId}`)).status).toBe(404);
  expect((await apiJson(spouseCtx, `/api/vehicles/${privateId}/odometer`)).status).toBe(404);
  expect((await apiJson(spouseCtx, `/api/maintenance/records?vehicleId=${privateId}`)).status).toBe(404);
  expect((await apiJson(spouseCtx, `/api/expenses?vehicleId=${sharedId}`)).status).toBe(403);
  await spouse.goto(`/vehicles/${privateId}`);
  await expect(spouse.getByText("Vehicle not found").first()).toBeVisible();
  // write attempts outside their permission fail server-side even if the UI were bypassed
  const patch = await apiJson(spouseCtx, `/api/vehicles/${sharedId}`, { method: "PATCH", data: { colour: "Pink" } });
  expect(patch.status).toBe(403);

  // an unrelated user sees neither vehicle
  await registerVerifyLogin(outsider, uniqueEmail("outsider"), "Mallory");
  expect((await apiJson(outsiderCtx, `/api/vehicles/${sharedId}`)).status).toBe(404);
  expect((await apiJson(outsiderCtx, `/api/vehicles`)).body.data).toHaveLength(0);
  await ownerCtx.close(); await spouseCtx.close(); await outsiderCtx.close();
});

const CRON = "e2e-cron-secret-e2e-cron-secret";
export { login, PASSWORD };
