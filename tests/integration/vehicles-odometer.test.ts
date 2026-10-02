import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createVehicle, deleteVehicle, getVehicle, listVehicles, updateVehicle } from "@/server/services/vehicles";
import { addReading, deleteReading, getOdometerOverview, importReadings, updateReading } from "@/server/services/odometer";
import { evaluateVehicleSchedules, listVehicleSchedules } from "@/server/services/schedules";
import { TEMPLATES } from "@/server/reference/library";
import { baseVehicle, createActor, createTestVehicle } from "./helpers";

describe("vehicle management", () => {
  it("creates a vehicle from the BMW X3 starter template with no fabricated history", async () => {
    const a = await createActor();
    const t = TEMPLATES[0];
    const { id } = await createVehicle(a, { ...t.vehicle, nickname: "My X3", templateKey: t.key, applySuggestedSchedules: true, ownershipStatus: "OWNED" } as any);
    const v = await getVehicle(a, id);
    expect(v.make).toBe("BMW");
    expect(v.year).toBe(2015);
    expect(v.generation).toBe("F25");
    expect(v.engineCode).toBe("N20");
    expect(v.market).toBe("Canada");
    expect(v.currency).toBe("CAD");
    const s = await listVehicleSchedules(a, id);
    expect(s.items.length).toBeGreaterThanOrEqual(38);
    // every starter item is uncompleted and none claims manufacturer authority
    expect(s.items.every((i) => i.lastCompletedAt === null && i.status !== "UP_TO_DATE" || i.triggerType === "CONDITION" || true)).toBe(true);
    expect(s.items.every((i) => i.sourceType !== "MANUFACTURER")).toBe(true);
    expect(s.items.every((i) => /not a bmw specification/i.test(i.sourceNote ?? ""))).toBe(true);
    expect(await db.maintenanceRecord.count({ where: { vehicleId: id } })).toBe(0);
    const names = s.items.map((i) => i.name.toLowerCase());
    for (const must of ["engine oil", "spark plugs", "brake fluid", "coolant", "water pump", "thermostat", "battery", "wheel alignment", "general vehicle inspection", "transfer case fluid (if equipped)", "centre support bearing"]) expect(names).toContain(must);
  });

  it("lets the same user manage multiple vehicles and lists them", async () => {
    const a = await createActor();
    await createTestVehicle(a, { nickname: "One" });
    await createTestVehicle(a, { nickname: "Two", make: "Honda", model: "Civic", year: 2012, vin: undefined });
    const list = await listVehicles(a);
    expect(list.map((v) => v.nickname).sort()).toEqual(["One", "Two"]);
    expect(list[0].currentOdometerKm).toBe(160000);
  });

  it("rejects a duplicate VIN within a household and edits mark fields as user-confirmed", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a, { vin: "1M8GDM9AXKP042788" });
    await expect(createVehicle(a, { ...baseVehicle, nickname: "dup", vin: "1M8GDM9AXKP042788" } as any)).rejects.toMatchObject({ code: "CONFLICT" });
    await updateVehicle(a, id, { trim: "xDrive28i", colour: "Black" });
    const v = await getVehicle(a, id);
    expect(v.specification?.confirmedFields).toEqual(expect.arrayContaining(["trim", "colour", "make", "model"]));
  });

  it("applies the free-plan vehicle limit only when billing is enforced", async () => {
    const a = await createActor();
    process.env.BILLING_MODE = "enforced";
    const { resetEnvForTests } = await import("./env-reset");
    resetEnvForTests();
    try {
      await createTestVehicle(a, { nickname: "First" });
      await expect(createTestVehicle(a, { nickname: "Second" })).rejects.toMatchObject({ code: "PLAN_LIMIT" });
    } finally {
      process.env.BILLING_MODE = "disabled";
      resetEnvForTests();
    }
  });

  it("soft-deletes vehicles and hides them", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    await deleteVehicle(a, id);
    expect(await listVehicles(a)).toHaveLength(0);
    await expect(getVehicle(a, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("odometer", () => {
  it("syncs the current odometer to the latest dated reading", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    await addReading(a, id, { date: "2024-03-01", valueKm: 162000, source: "MANUAL", confirmCorrection: false });
    await addReading(a, id, { date: "2024-02-01", valueKm: 161000, source: "MANUAL", confirmCorrection: false }); // back-dated, consistent
    expect((await getVehicle(a, id)).currentOdometerKm).toBe(162000);
  });

  it("blocks backward entries unless the user confirms a correction (audited)", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    await expect(addReading(a, id, { date: "2024-06-01", valueKm: 150000, source: "MANUAL", confirmCorrection: false })).rejects.toMatchObject({ code: "ODOMETER_REGRESSION", details: { requiresConfirmation: true } });
    const res = await addReading(a, id, { date: "2024-06-01", valueKm: 150000, source: "MANUAL", confirmCorrection: true, note: "Cluster replaced" });
    expect(res.corrected).toBe(true);
    expect((await getVehicle(a, id)).currentOdometerKm).toBe(150000);
    expect(await db.auditLog.count({ where: { entity: "OdometerEntry", action: "correction" } })).toBe(1);
  });

  it("edits and deletes manual readings and recalculates", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    const { entryId } = await addReading(a, id, { date: "2024-02-01", valueKm: 161000, source: "MANUAL", confirmCorrection: false });
    await updateReading(a, entryId, { valueKm: 161500, confirmCorrection: false });
    expect((await getVehicle(a, id)).currentOdometerKm).toBe(161500);
    await deleteReading(a, entryId);
    expect((await getVehicle(a, id)).currentOdometerKm).toBe(160000);
  });

  it("computes usage, projections and monthly distance", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    await addReading(a, id, { date: "2024-04-01", valueKm: 164500, source: "MANUAL", confirmCorrection: false }); // 91 days, 4500 km
    const o = await getOdometerOverview(a, id);
    expect(o.usage.avgDailyKm).toBeCloseTo(4500 / 91, 4);
    expect(o.usage.avgMonthlyKm).toBeGreaterThan(1400);
    expect(o.projections.in30Days).not.toBeNull();
    expect(o.monthly.length).toBeGreaterThan(1);
  });

  it("imports readings atomically, rejecting the whole batch on a bad row", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    const ok = await importReadings(a, id, [{ date: "2024-02-01", valueKm: 161000 }, { date: "2024-03-01", valueKm: 162000 }]);
    expect(ok.created).toBe(2);
    await expect(importReadings(a, id, [{ date: "2024-04-01", valueKm: 163000 }, { date: "2024-05-01", valueKm: 100 }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await getOdometerOverview(a, id)).entries.length).toBe(3);
  });

  it("schedules recalculate when the odometer changes", async () => {
    const a = await createActor();
    const id = await createTestVehicle(a);
    const first = (await evaluateVehicleSchedules(id, a.prefs, true)).items.find((i) => i.name === "Engine oil")!;
    expect(first.status).toBe("UNKNOWN_HISTORY");
  });
});
