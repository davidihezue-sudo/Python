import { describe, expect, it } from "vitest";
import { budgetPeriod, budgetStatus, costPerDistance, spendByCategory, spendByMonth } from "@/server/engine/costs";
import { computeFuelSegments, computeFuelStats } from "@/server/engine/fuel";
import { dateAlert, maintenanceAlert } from "@/server/engine/alerts";
import { DEFAULT_THRESHOLDS, evaluateRule } from "@/server/engine/schedule";
import { checkVin } from "@/lib/vin";
import { lookupDtc } from "@/lib/dtc";
import { can } from "@/lib/permissions";

const R = (date: string, valueKm: number) => ({ date, valueKm });
const E = (date: string, amount: number, category = "MAINTENANCE") => ({ date, amount, category });

describe("cost per distance", () => {
  const readings = [R("2024-01-01", 100000), R("2024-12-31", 110000)];
  it("divides expenses in the covered window by distance", () => {
    const r = costPerDistance([E("2024-03-01", 500), E("2024-09-01", 500, "REPAIRS")], readings, {});
    expect(r.distanceKm).toBe(10000);
    expect(r.costPerKm).toBeCloseTo(0.1, 6);
    expect(r.coverage).toBe("full");
  });
  it("separates maintenance-only, repair-only and excluded categories", () => {
    const rows = [E("2024-03-01", 500), E("2024-09-01", 300, "REPAIRS"), E("2024-05-01", 1000, "FUEL")];
    expect(costPerDistance(rows, readings, {}, { include: ["MAINTENANCE"] }).costPerKm).toBeCloseTo(0.05, 6);
    expect(costPerDistance(rows, readings, {}, { include: ["REPAIRS"] }).costPerKm).toBeCloseTo(0.03, 6);
    expect(costPerDistance(rows, readings, {}, { exclude: ["FUEL"] }).costPerKm).toBeCloseTo(0.08, 6);
  });
  it("does not inflate cost when expenses predate odometer coverage", () => {
    const r = costPerDistance([E("2020-01-01", 9000), E("2024-06-01", 100)], readings, {});
    expect(r.totalCost).toBe(100);
    expect(r.excludedOutsideCoverage).toEqual({ count: 1, amount: 9000 });
    expect(r.coverage).toBe("partial");
  });
  it("refuses to compute with incomplete mileage", () => {
    const r = costPerDistance([E("2024-03-01", 500)], [R("2024-01-01", 1)], {});
    expect(r.costPerKm).toBeNull();
    expect(r.coverage).toBe("none");
  });
});

describe("spending aggregates and budgets", () => {
  it("groups by category and zero-fills months", () => {
    const rows = [E("2024-01-05", 10.1), E("2024-01-20", 20.2), E("2024-03-05", 5, "FUEL")];
    expect(spendByCategory(rows)[0]).toEqual({ key: "MAINTENANCE", total: 30.3, count: 2 });
    expect(spendByMonth(rows, "2024-01-01", "2024-03-31")).toEqual([
      { month: "2024-01", total: 30.3 },
      { month: "2024-02", total: 0 },
      { month: "2024-03", total: 5 },
    ]);
  });
  it("computes budget utilization, remaining and projection", () => {
    const p = budgetPeriod("ANNUAL", 2024);
    const s = budgetStatus({ amount: 1000, actual: 500, periodStart: p.start, periodEnd: p.end, today: "2024-07-01" });
    expect(s.remaining).toBe(500);
    expect(s.utilizationPct).toBe(50);
    expect(s.projected).toBeGreaterThan(900);
    expect(s.state).toBe("ok");
    expect(budgetStatus({ amount: 1000, actual: 850, periodStart: p.start, periodEnd: p.end, today: "2024-07-01" }).state).toBe("approaching");
    expect(budgetStatus({ amount: 1000, actual: 1100, periodStart: p.start, periodEnd: p.end, today: "2024-07-01" }).state).toBe("exceeded");
    expect(budgetPeriod("MONTHLY", 2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
});

describe("fuel economy", () => {
  const f = (date: string, odometerKm: number, litres: number, totalCost: number, fullTank = true, missedPrevious = false) => ({ date, odometerKm, litres, totalCost, fullTank, missedPrevious });
  it("computes full-to-full consumption, ignoring the first fill's litres", () => {
    const segs = computeFuelSegments([f("2024-01-01", 1000, 40, 60), f("2024-01-10", 1500, 40, 60), f("2024-01-20", 2000, 50, 75)]);
    expect(segs).toHaveLength(2);
    expect(segs[0].litresPer100Km).toBeCloseTo(8, 6);
    expect(segs[1].litresPer100Km).toBeCloseTo(10, 6);
  });
  it("accounts for partial fills", () => {
    const segs = computeFuelSegments([f("2024-01-01", 1000, 40, 60), f("2024-01-05", 1200, 20, 30, false), f("2024-01-10", 1500, 20, 30)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].litres).toBe(40);
    expect(segs[0].litresPer100Km).toBeCloseTo(8, 6);
    expect(segs[0].cost).toBe(60);
  });
  it("breaks the chain at a missed fill-up", () => {
    const segs = computeFuelSegments([f("2024-01-01", 1000, 40, 60), f("2024-01-10", 1500, 40, 60), f("2024-02-10", 3000, 40, 60, true, true), f("2024-02-20", 3400, 32, 48)]);
    expect(segs).toHaveLength(2);
    expect(segs[1].distanceKm).toBe(400);
  });
  it("aggregates weighted averages", () => {
    const s = computeFuelStats([f("2024-01-01", 1000, 40, 60), f("2024-01-10", 1500, 40, 60), f("2024-01-20", 2000, 50, 75)]);
    expect(s.avgLitresPer100Km).toBeCloseTo(9, 6); // 90 L over 1000 km
    expect(s.totalCost).toBe(195);
    expect(s.avgCostPerKm).toBeCloseTo(0.135, 6);
    expect(computeFuelStats([f("2024-01-01", 1000, 40, 60)]).avgLitresPer100Km).toBeNull();
  });
});

describe("alert generation", () => {
  const prefs = { alertKmBefore: [1000, 500], alertDaysBefore: [30, 7], alertOnDue: true, alertOnOverdue: true };
  const rule = { triggerType: "MILEAGE" as const, intervalKm: 10000, lastCompletedKm: 160000, lastCompletedAt: "2024-01-01" };
  const ctx = (km: number) => ({ currentKm: km, today: "2024-06-01", avgDailyKm: 50, thresholds: DEFAULT_THRESHOLDS });
  const alert = (km: number) => maintenanceAlert({ assignmentId: "a1", vehicleId: "v1", vehicleName: "X3", itemName: "Oil", evaluation: evaluateRule(rule, ctx(km)), prefs, unit: "KM" });
  it("fires nothing when far from due", () => expect(alert(165000)).toBeNull());
  it("fires staged alerts with stable, distinct dedupe keys", () => {
    const a1 = alert(169200);
    const a2 = alert(169600);
    expect(a1?.type).toBe("MAINTENANCE_UPCOMING");
    expect(a1?.dedupeKey).toBe(alert(169200)?.dedupeKey);
    expect(a2?.dedupeKey).not.toBe(a1?.dedupeKey);
    expect(alert(170000)?.type).toBe("MAINTENANCE_DUE");
    expect(alert(171000)?.type).toBe("MAINTENANCE_OVERDUE");
  });
  it("re-arms for the next cycle after service", () => {
    const next = maintenanceAlert({ assignmentId: "a1", vehicleId: "v1", vehicleName: "X3", itemName: "Oil", evaluation: evaluateRule({ ...rule, lastCompletedKm: 171000 }, ctx(180200)), prefs, unit: "KM" });
    expect(next?.dedupeKey).toContain("181000");
    expect(next?.dedupeKey).not.toBe(alert(170000)?.dedupeKey);
  });
  it("respects disabled overdue alerts", () => {
    const ev = evaluateRule(rule, ctx(172000));
    expect(maintenanceAlert({ assignmentId: "a", vehicleId: "v", vehicleName: "n", itemName: "i", evaluation: ev, prefs: { ...prefs, alertOnOverdue: false }, unit: "KM" })).toBeNull();
  });
  it("creates date alerts at lead times", () => {
    const a = dateAlert({ kind: "WARRANTY_EXPIRING", id: "w1", label: "Powertrain warranty", vehicleId: "v", vehicleName: "X3", date: "2024-06-20", today: "2024-06-01", leadDays: [30, 7], actionUrl: "/x" });
    expect(a?.dedupeKey).toBe("WARRANTY_EXPIRING:w1:2024-06-20:lead:30");
    expect(dateAlert({ kind: "WARRANTY_EXPIRING", id: "w1", label: "x", vehicleId: "v", vehicleName: "n", date: "2024-09-20", today: "2024-06-01", actionUrl: "/x" })).toBeNull();
    expect(dateAlert({ kind: "INSURANCE_RENEWAL", id: "i", label: "x", vehicleId: "v", vehicleName: "n", date: "2024-05-20", today: "2024-06-01", actionUrl: "/x" })?.severity).toBe("CRITICAL");
  });
});

describe("VIN and DTC helpers", () => {
  it("validates the ISO 3779 check digit", () => {
    expect(checkVin("1M8GDM9AXKP042788").checkDigitOk).toBe(true); // canonical example VIN
    expect(checkVin("1M8GDM9A1KP042788").checkDigitOk).toBe(false);
    expect(checkVin("ABC").valid).toBe(false);
    expect(checkVin("1M8GDM9AXKP04278I").valid).toBe(false);
  });
  it("distinguishes generic, manufacturer-specific and unknown codes without diagnosing", () => {
    expect(lookupDtc("p0301")).toMatchObject({ scope: "GENERIC", known: true, system: "Powertrain" });
    expect(lookupDtc("P1000").scope).toBe("MANUFACTURER_SPECIFIC");
    expect(lookupDtc("2A87").scope).toBe("MANUFACTURER_SPECIFIC");
    expect(lookupDtc("hello").scope).toBe("UNKNOWN_FORMAT");
    expect(lookupDtc("P0420").disclaimer).toMatch(/not a diagnosis/i);
  });
});

describe("permissions", () => {
  const a = (level: any, fin = false, role: any = "MEMBER") => ({ householdRole: role, vehicleLevel: level, canViewFinancials: fin });
  it("household admins can do everything", () => expect(can(a(null, false, "ADMIN"), "delete")).toBe(true));
  it("non-members have no access", () => expect(can(null, "view")).toBe(false));
  it("viewer is read-only and financials are opt-in", () => {
    expect(can(a("VIEWER"), "view")).toBe(true);
    expect(can(a("VIEWER"), "write")).toBe(false);
    expect(can(a("VIEWER"), "viewFinancials")).toBe(false);
    expect(can(a("VIEWER", true), "viewFinancials")).toBe(true);
  });
  it("maintenance manager can write but not manage", () => {
    expect(can(a("MAINTENANCE_MANAGER"), "write")).toBe(true);
    expect(can(a("MAINTENANCE_MANAGER"), "editVehicle")).toBe(false);
  });
  it("co-owner cannot delete or change access", () => {
    expect(can(a("CO_OWNER"), "editVehicle")).toBe(true);
    expect(can(a("CO_OWNER"), "delete")).toBe(false);
    expect(can(a("CO_OWNER"), "manageAccess")).toBe(false);
  });
  it("member with no vehicle grant has nothing", () => expect(can(a(null), "view")).toBe(false));
});
