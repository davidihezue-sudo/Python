import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { convertIssueToRepair, createCode, createIssue, getIssue, listIssues, updateIssue } from "@/server/services/repairs";
import { createBudget, createExpense, deleteExpense, listBudgets, listExpenses, updateExpense } from "@/server/services/expenses";
import { createFuel, deleteFuel, fuelStats, listFuel } from "@/server/services/fuel";
import { getExpenseAnalytics, getDashboard } from "@/server/services/analytics";
import { getVehicle } from "@/server/services/vehicles";
import { addReading } from "@/server/services/odometer";
import { createActor, createTestVehicle } from "./helpers";

describe("Journey C: repair lifecycle", () => {
  it("reports an issue, records a code, converts to a repair, and analytics reflect the cost", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const { id } = await createIssue(a, { vehicleId, title: "Coolant leak", description: "Puddle under the engine", discoveredAt: "2024-05-01", odometerKm: 165000, severity: "HIGH", status: "NEW", componentKey: "water_pump", estimatedCost: 900 } as any);
    expect((await listIssues(a, { vehicleId, open: true })).total).toBe(1);

    const code = await createCode(a, { vehicleId, repairIssueId: id, code: "p0128", detectedAt: "2024-05-01", odometerKm: 165000, severity: "MODERATE", source: "MANUAL", status: "ACTIVE" } as any);
    expect(code.code).toBe("P0128");
    expect(code.reference.scope).toBe("GENERIC");
    expect(code.reference.disclaimer).toMatch(/not a diagnosis/i);

    await updateIssue(a, id, { status: "INVESTIGATING", mechanicAssessment: "Water pump housing cracked" });
    await updateIssue(a, id, { status: "DIAGNOSED" });
    await updateIssue(a, id, { status: "AWAITING_PARTS" });
    const conv = await convertIssueToRepair(a, id, { serviceDate: "2024-05-10", odometerKm: 165200, laborCost: 400, partsCost: 450, tax: 42.5, workPerformedBy: "INDEPENDENT_MECHANIC", providerId: null, items: [{ name: "Water pump replacement", componentKey: "water_pump", completed: true, quantity: 1, unitCost: 450, laborCost: 400, trackAsPart: true, partName: "Water pump", partManufacturer: "Pierburg" }], confirmOdometerCorrection: false } as any);
    expect(conv.totalCost).toBe(892.5);

    const issue = await getIssue(a, id);
    expect(issue.status).toBe("RESOLVED");
    expect(issue.actualCost).toBe(892.5);
    expect(issue.resolvedAt).toBe("2024-05-10");
    expect(issue.repairRecords).toHaveLength(1);
    expect(issue.codes[0].status).toBe("RESOLVED");
    expect((await listIssues(a, { vehicleId, open: true })).total).toBe(0);

    const exp = await listExpenses(a, { vehicleId, category: "REPAIRS" });
    expect(exp.total).toBe(1);
    expect(exp.items[0].amount).toBe(892.5);
    const an = await getExpenseAnalytics(a, { vehicleId, range: "all" });
    expect(an.totals.repairs).toBe(892.5);
    expect(an.repairByComponent[0]).toMatchObject({ component: "water_pump", total: 892.5 });
    expect(an.averages.averageRepairCost).toBe(892.5);
  });

  it("closed issues can only be reopened as new", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const { id } = await createIssue(a, { vehicleId, title: "Rattle", discoveredAt: "2024-05-01", severity: "LOW", status: "NEW" } as any);
    await updateIssue(a, id, { status: "CLOSED" });
    await expect(updateIssue(a, id, { status: "MONITORING" })).rejects.toMatchObject({ code: "CONFLICT" });
    await updateIssue(a, id, { status: "NEW" });
    expect((await getIssue(a, id)).status).toBe("NEW");
  });

  it("an inconsistent issue odometer warns but never blocks the report", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const r = await createIssue(a, { vehicleId, title: "Noise", discoveredAt: "2024-05-01", odometerKm: 100, severity: "LOW", status: "NEW" } as any);
    expect(r.warnings.length).toBe(1);
    expect((await getIssue(a, r.id)).odometerKm).toBe(100);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(160000);
  });
});

describe("expenses & budgets", () => {
  it("creates, updates, filters and deletes manual expenses, but protects linked ones", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const { id } = await createExpense(a, { vehicleId, date: "2024-03-01", amount: 120, tax: 5.71, category: "INSURANCE", vendor: "Acme Insurance", paymentMethod: "CREDIT" } as any);
    await createExpense(a, { vehicleId, date: "2024-03-15", amount: 15, category: "CAR_WASH" } as any);
    expect((await listExpenses(a, { vehicleId })).totals.amount).toBe(135);
    expect((await listExpenses(a, { vehicleId, category: "INSURANCE" })).total).toBe(1);
    expect((await listExpenses(a, { vehicleId, q: "acme" })).total).toBe(1);
    await updateExpense(a, id, { amount: 130 });
    expect((await listExpenses(a, { vehicleId })).totals.amount).toBe(145);
    await expect(createExpense(a, { vehicleId, date: "2024-03-01", amount: 10, tax: 20, category: "OTHER" } as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await deleteExpense(a, id);
    expect((await listExpenses(a, { vehicleId })).total).toBe(1);
  });

  it("computes cost per distance excluding categories and flags incomplete mileage", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a); // 160,000 on 2024-01-01
    await addReading(a, vehicleId, { date: "2024-12-31", valueKm: 170000, source: "MANUAL", confirmCorrection: false });
    await createExpense(a, { vehicleId, date: "2024-03-01", amount: 500, category: "MAINTENANCE" } as any);
    await createExpense(a, { vehicleId, date: "2024-04-01", amount: 300, category: "REPAIRS" } as any);
    await createExpense(a, { vehicleId, date: "2024-05-01", amount: 1000, category: "INSURANCE" } as any);
    await createExpense(a, { vehicleId, date: "2022-05-01", amount: 9999, category: "MAINTENANCE" } as any);
    const an = await getExpenseAnalytics(a, { vehicleId, range: "all" });
    expect(an.costPerDistance.maintenanceOnly.costPerKm).toBeCloseTo(0.05, 6);
    expect(an.costPerDistance.repairOnly.costPerKm).toBeCloseTo(0.03, 6);
    expect(an.costPerDistance.totalOwnership.costPerKm).toBeCloseTo(0.18, 6);
    expect(an.costPerDistance.totalOwnership.excludedOutsideCoverage).toEqual({ count: 1, amount: 9999 });
    const noIns = await getExpenseAnalytics(a, { vehicleId, range: "all", exclude: ["INSURANCE"] });
    expect(noIns.costPerDistance.totalOwnership.costPerKm).toBeCloseTo(0.08, 6);
    expect(an.byCategory.map((c) => c.key)).toContain("INSURANCE");
    expect(an.byYear.map((y) => y.key)).toEqual(["2022", "2024"]);
  });

  it("budgets show utilisation, remaining and projection", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const year = new Date().getUTCFullYear();
    await createBudget(a, { vehicleId, period: "ANNUAL", year, amount: 1000, categories: ["MAINTENANCE", "REPAIRS"], alertAtPercent: [80, 100] } as any);
    await expect(createBudget(a, { vehicleId, period: "ANNUAL", year, amount: 500, categories: ["MAINTENANCE"], alertAtPercent: [80] } as any)).rejects.toMatchObject({ code: "CONFLICT" });
    await createExpense(a, { vehicleId, date: `${year}-01-02`, amount: 850, category: "MAINTENANCE" } as any);
    const [b] = await listBudgets(a, { year });
    expect(b.actual).toBe(850);
    expect(b.remaining).toBe(150);
    expect(b.state).toBe("approaching");
    expect(b.utilizationPct).toBe(85);
  });
});

describe("fuel", () => {
  it("records fill-ups with unit conversion, computes economy over partial fills and updates odometer + expense", async () => {
    const a = await createActor();
    const vehicleId = await createTestVehicle(a);
    const mk = (date: string, km: number, q: number, cost: number, fullTank = true, extra: any = {}) => createFuel(a, { vehicleId, date, odometerKm: km, quantity: q, unit: "L", totalCost: cost, fuelType: "PETROL", fullTank, missedPrevious: false, confirmOdometerCorrection: false, ...extra } as any);
    await mk("2024-02-01", 160500, 40, 60);
    await mk("2024-02-10", 160700, 20, 30, false);
    await mk("2024-02-15", 161000, 20, 30);
    const stats = await fuelStats(a, vehicleId);
    expect(stats.avgLitresPer100Km).toBeCloseTo(8, 6); // 40 L over 500 km
    expect(stats.avgEconomy).toBeCloseTo(8, 6);
    expect(stats.segments).toHaveLength(1);
    expect(stats.totalCost).toBe(120);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(161000);
    expect((await listExpenses(a, { vehicleId, category: "FUEL" })).totals.amount).toBe(120);
    const f = await listFuel(a, { vehicleId });
    expect(f.items).toHaveLength(3);
    await deleteFuel(a, f.items[0].id);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(160700);
    expect((await listExpenses(a, { vehicleId, category: "FUEL" })).totals.amount).toBe(90);
  });

  it("converts gallons to litres and reports economy in the user's unit", async () => {
    const a = await createActor();
    const { updatePreferences } = await import("@/server/services/users");
    await updatePreferences(a, { fuelEconomyUnit: "MPG_US", volumeUnit: "GAL_US" } as any);
    const { reloadActor } = await import("./helpers");
    const a2 = await reloadActor(a);
    const vehicleId = await createTestVehicle(a2);
    await createFuel(a2, { vehicleId, date: "2024-02-01", odometerKm: 160100, quantity: 10, unit: "GAL_US", totalCost: 40, fuelType: "PETROL", fullTank: true } as any);
    await createFuel(a2, { vehicleId, date: "2024-02-10", odometerKm: 160100 + 603.5, quantity: 10, unit: "GAL_US", totalCost: 40, fuelType: "PETROL", fullTank: true } as any);
    const s = await fuelStats(a2, vehicleId);
    expect(s.economyUnit).toBe("MPG (US)");
    // 603.5 km on 10 US gal = 374.99 mi / 10 gal ≈ 37.5 MPG
    expect(s.avgEconomy).toBeGreaterThan(37);
    expect(s.avgEconomy).toBeLessThan(38);
    const row = await db.fuelEntry.findFirstOrThrow({ where: { vehicleId }, orderBy: { date: "asc" } });
    expect(Number(row.quantityL)).toBeCloseTo(37.854, 2);
  });
});

describe("dashboard", () => {
  it("returns real numbers from the database for the household and a single vehicle", async () => {
    const a = await createActor();
    const v1 = await createTestVehicle(a, { nickname: "One" });
    const v2 = await createTestVehicle(a, { nickname: "Two", vin: undefined, currentOdometerKm: 50000 });
    const year = new Date().getUTCFullYear();
    await createExpense(a, { vehicleId: v1, date: `${year}-01-05`, amount: 200, category: "MAINTENANCE" } as any);
    await createExpense(a, { vehicleId: v2, date: `${year}-01-06`, amount: 300, category: "REPAIRS" } as any);
    await createIssue(a, { vehicleId: v2, title: "Check engine light", discoveredAt: `${year}-01-06`, severity: "MODERATE", status: "NEW" } as any);
    const d = await getDashboard(a, { range: "all" });
    expect(d.kpis.vehicles).toBe(2);
    expect(d.kpis.combinedKm).toBe(210000);
    expect(d.kpis.maintenanceSpendYtd).toBe(200);
    expect(d.kpis.repairSpendYtd).toBe(300);
    expect(d.kpis.lifetimeSpend).toBe(500);
    expect(d.kpis.outstandingRepairs).toBe(1);
    expect(d.vehicles).toHaveLength(2);
    const one = await getDashboard(a, { vehicleId: v1, range: "all" });
    expect(one.kpis.vehicles).toBe(1);
    expect(one.kpis.repairSpendYtd).toBe(0);
    expect(d.expense.currency).toBe("CAD");
  });
});
