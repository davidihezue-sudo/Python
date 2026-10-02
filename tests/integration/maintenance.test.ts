import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRecord, deleteRecord, getRecord, listRecords, prefillFromAssignment, updateRecord } from "@/server/services/records";
import { evaluateVehicleSchedules } from "@/server/services/schedules";
import { getVehicle } from "@/server/services/vehicles";
import { getOdometerOverview } from "@/server/services/odometer";
import { componentHistory } from "@/server/services/parts";
import { listExpenses } from "@/server/services/expenses";
import { createActor, createTestVehicle } from "./helpers";
import type { Actor } from "@/server/context";

async function setup() {
  const a = await createActor();
  const vehicleId = await createTestVehicle(a); // odometer 160,000 on 2024-01-01
  const sched = async () => (await evaluateVehicleSchedules(vehicleId, a.prefs, true, db, "2024-06-01")).items;
  const find = async (name: string) => (await sched()).find((i) => i.name === name)!;
  return { a, vehicleId, sched, find };
}

const oilRecord = (vehicleId: string, assignments: { oil: string; filter: string }, over: Record<string, unknown> = {}) => ({
  vehicleId,
  title: "Oil change",
  serviceDate: "2024-05-01",
  odometerKm: 168000,
  workPerformedBy: "INDEPENDENT_MECHANIC" as const,
  providerName: "Calgary Lube",
  laborCost: 40,
  partsCost: 65.5,
  tax: 5.28,
  discount: 0,
  status: "COMPLETED" as const,
  kind: "MAINTENANCE" as const,
  items: [
    { assignmentId: assignments.oil, name: "Engine oil", completed: true, quantity: 6, unitCost: 8, laborCost: 0, trackAsPart: false, partName: "Synthetic 5W-30", partManufacturer: "Castrol" },
    { assignmentId: assignments.filter, name: "Oil filter", completed: true, quantity: 1, unitCost: 17.5, laborCost: 0, trackAsPart: true, partName: "Oil filter", partNumber: "11427953129", partManufacturer: "Mann" },
  ],
  allowDuplicate: false,
  confirmOdometerCorrection: false,
  ...over,
});

describe("Journey B: oil change", () => {
  it("records a service, updates only the matching schedules, creates expense/odometer/part, and recalculates next due", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    const airFilter = await find("Engine air filter");
    const res = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }) as any);

    const after = await find("Engine oil");
    expect(after.lastCompletedAt).toBe("2024-05-01");
    expect(after.lastCompletedKm).toBe(168000);
    expect(after.nextDueKm).toBe(178000); // suggested 10,000 km interval
    expect(after.nextDueDate).toBe("2025-05-01"); // suggested 12 month interval
    expect(after.status).not.toBe("UNKNOWN_HISTORY");
    expect(after.remainingKm).toBe(178000 - 168000);
    // unrelated items remain untouched
    expect((await find("Engine air filter")).lastCompletedAt).toBeNull();
    expect((await find("Engine air filter")).status).toBe(airFilter.status);

    const rec = await getRecord(a, res.id);
    expect(rec.totalCost).toBe(110.78); // 65.5 + 40 + 5.28
    expect(rec.items).toHaveLength(2);

    // odometer reading created and vehicle updated
    const v = await getVehicle(a, vehicleId);
    expect(v.currentOdometerKm).toBe(168000);
    expect((await getOdometerOverview(a, vehicleId)).entries.some((e) => e.source === "MAINTENANCE" && e.valueKm === 168000)).toBe(true);

    // expense created (single source for analytics)
    const exp = await listExpenses(a, { vehicleId });
    expect(exp.total).toBe(1);
    expect(exp.items[0]).toMatchObject({ amount: 110.78, category: "MAINTENANCE", vendor: "Calgary Lube", linked: true });

    // tracked part installed
    const hist = await componentHistory(a, vehicleId, "oil_filter");
    expect(hist[0].current?.partName).toBe("Oil filter");
    expect(hist[0].current?.installedKm).toBe(168000);

    // appears in history
    const list = await listRecords(a, { vehicleId });
    expect(list.items[0].title).toBe("Oil change");
  });

  it("partial completion does not mark unfinished items as done", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    const body = oilRecord(vehicleId, { oil: oil.id, filter: filter.id });
    body.items[1].completed = false;
    await createRecord(a, body as any);
    expect((await find("Engine oil")).lastCompletedAt).toBe("2024-05-01");
    expect((await find("Oil filter")).lastCompletedAt).toBeNull();
  });

  it("drafts and scheduled records do not affect schedules, expenses or the odometer", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }, { status: "SCHEDULED" }) as any);
    expect((await find("Engine oil")).lastCompletedAt).toBeNull();
    expect((await listExpenses(a, { vehicleId })).total).toBe(0);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(160000);
  });

  it("moving a scheduled record to completed applies everything; reopening reverts it", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    const { id } = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }, { status: "SCHEDULED" }) as any);
    await updateRecord(a, id, { status: "COMPLETED" });
    expect((await find("Engine oil")).lastCompletedAt).toBe("2024-05-01");
    expect((await listExpenses(a, { vehicleId })).total).toBe(1);
    await updateRecord(a, id, { status: "IN_PROGRESS" });
    expect((await find("Engine oil")).lastCompletedAt).toBeNull();
    expect((await listExpenses(a, { vehicleId })).total).toBe(0);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(160000);
    await expect(updateRecord(a, id, { status: "DRAFT" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("correcting a record recalculates schedules, expense and odometer", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    const { id } = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }) as any);
    await updateRecord(a, id, { odometerKm: 167000, laborCost: 60 });
    const after = await find("Engine oil");
    expect(after.lastCompletedKm).toBe(167000);
    expect(after.nextDueKm).toBe(177000);
    expect((await listExpenses(a, { vehicleId })).items[0].amount).toBe(130.78);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(167000);
  });

  it("deleting a record rolls back schedule, expense, odometer and parts", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    const { id } = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }) as any);
    await deleteRecord(a, id);
    expect((await find("Engine oil")).lastCompletedAt).toBeNull();
    expect((await listExpenses(a, { vehicleId })).total).toBe(0);
    expect((await getVehicle(a, vehicleId)).currentOdometerKm).toBe(160000);
    expect(await componentHistory(a, vehicleId, "oil_filter")).toHaveLength(0);
    expect((await listRecords(a, { vehicleId })).total).toBe(0);
  });

  it("prevents accidental duplicates and replays idempotent offline submissions safely", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const filter = await find("Oil filter");
    await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }) as any);
    await expect(createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }) as any)).rejects.toMatchObject({ code: "DUPLICATE_RECORD" });
    const forced = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }, { allowDuplicate: true, title: "Oil change (second)" }) as any);
    expect(forced.id).toBeTruthy();
    const k = "client-key-12345678";
    const first = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }, { title: "Offline one", serviceDate: "2024-05-10", odometerKm: 169000, idempotencyKey: k }) as any);
    const replay = await createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: filter.id }, { title: "Offline one", serviceDate: "2024-05-10", odometerKm: 169000, idempotencyKey: k }) as any);
    expect(replay.id).toBe(first.id);
    expect(replay.idempotentReplay).toBe(true);
    expect(await db.maintenanceRecord.count({ where: { vehicleId, title: "Offline one" } })).toBe(1);
  });

  it("rejects service items that reference another vehicle's schedule, and odometer regressions", async () => {
    const { a, vehicleId, find } = await setup();
    const other = await createTestVehicle(a, { nickname: "Other", vin: undefined });
    const foreign = (await evaluateVehicleSchedules(other, a.prefs, true)).items[0];
    await expect(createRecord(a, oilRecord(vehicleId, { oil: foreign.id, filter: foreign.id }) as any)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const oil = await find("Engine oil");
    await expect(createRecord(a, oilRecord(vehicleId, { oil: oil.id, filter: oil.id }, { odometerKm: 100 }) as any)).rejects.toMatchObject({ code: "ODOMETER_REGRESSION" });
    // transaction rolled back — nothing persisted
    expect(await db.maintenanceRecord.count({ where: { vehicleId } })).toBe(0);
  });

  it("supports multiple services in one visit and filtering/sorting/search", async () => {
    const { a, vehicleId, find } = await setup();
    const oil = await find("Engine oil");
    const rot = await find("Tire rotation");
    const brake = await find("Brake fluid");
    await createRecord(a, { ...oilRecord(vehicleId, { oil: oil.id, filter: oil.id }), title: "Shop visit", items: [{ assignmentId: oil.id, name: "Engine oil", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }, { assignmentId: rot.id, name: "Tire rotation", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }, { assignmentId: brake.id, name: "Brake fluid", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }] } as any);
    for (const n of ["Engine oil", "Tire rotation", "Brake fluid"]) expect((await find(n)).lastCompletedAt).toBe("2024-05-01");
    await createRecord(a, { ...oilRecord(vehicleId, { oil: oil.id, filter: oil.id }), title: "Wipers", serviceDate: "2024-05-20", odometerKm: 169000, partsCost: 30, laborCost: 0, tax: 0, items: [] } as any);
    expect((await listRecords(a, { vehicleId, q: "wiper" })).total).toBe(1);
    expect((await listRecords(a, { vehicleId, minCost: 20, maxCost: 40 })).total).toBe(1);
    expect((await listRecords(a, { vehicleId, from: "2024-05-10" })).total).toBe(1);
    expect((await listRecords(a, { vehicleId, sort: "date_asc" })).items[0].title).toBe("Shop visit");
    expect((await listRecords(a, { vehicleId, category: "tires_wheels" })).total).toBe(1);
    expect((await listRecords(a, { vehicleId, category: "climate" })).total).toBe(0);
  });

  it("pre-fills a service from a schedule with the oil+filter bundle", async () => {
    const { a, find } = await setup();
    const oil = await find("Engine oil");
    const p = await prefillFromAssignment(a, oil.id);
    expect(p.items.map((i) => i.name).sort()).toEqual(["Engine oil", "Oil filter"]);
    expect(p.odometerKm).toBe(160000);
  });

  it("part replacement chain closes the previous installation and orders backfilled history", async () => {
    const { a, vehicleId, find } = await setup();
    const batt = await find("Battery");
    const mk = (title: string, date: string, km: number, partNo: string) => createRecord(a, { vehicleId, title, serviceDate: date, odometerKm: km, workPerformedBy: "OWNER_DIY", status: "COMPLETED", kind: "MAINTENANCE", laborCost: 0, partsCost: 150, tax: 0, discount: 0, items: [{ assignmentId: batt.id, name: "Battery", completed: true, quantity: 1, unitCost: 150, laborCost: 0, trackAsPart: true, partName: "AGM battery", partNumber: partNo, warrantyMonths: 36 }], allowDuplicate: false, confirmOdometerCorrection: false } as any);
    await mk("Battery 2", "2024-03-01", 163000, "B-2");
    await mk("Battery 1 (backfilled)", "2022-02-01", 150000, "B-1");
    await mk("Battery 3", "2024-05-01", 168000, "B-3");
    const h = (await componentHistory(a, vehicleId, "battery"))[0];
    expect(h.installations.map((i: any) => i.partNumber)).toEqual(["B-3", "B-2", "B-1"]);
    expect(h.replacements).toBe(2);
    const byNo = Object.fromEntries(h.installations.map((i: any) => [i.partNumber, i]));
    expect(byNo["B-1"].removedAt).toBe("2024-03-01");
    expect(byNo["B-1"].kmInService).toBe(13000);
    expect(byNo["B-2"].removedAt).toBe("2024-05-01");
    expect(byNo["B-3"].removedAt).toBeNull();
    const rec2 = (await listRecords(a, { vehicleId, q: "Battery 2" })).items[0];
    await deleteRecord(a, rec2.id);
    const h2 = (await componentHistory(a, vehicleId, "battery"))[0];
    expect(h2.installations).toHaveLength(2);
    expect(h2.installations.find((i: any) => i.partNumber === "B-1").removedAt).toBe("2024-05-01");
  });
});

export type { Actor };
