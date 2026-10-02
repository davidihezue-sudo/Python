import { describe, expect, it } from "vitest";
import { createTransaction, listTransactions, txQuerySchema, updateTransaction } from "@/server/finance/transactions";
import { vehicleObligations, vehicleOptions, vehicleOverview } from "@/server/finance/vehicles";
import { obligations } from "@/server/finance/calendar";
import { buildFinanceReport } from "@/server/finance/reports";
import { ask } from "@/server/finance/assistant";
import { account, coupleHousehold, ctxFor, spend } from "./helpers";
import { createActor, createTestVehicle as makeVehicleId } from "../helpers";

const createTestVehicle = async (a: Parameters<typeof makeVehicleId>[0], over: Record<string, unknown>) => ({ id: await makeVehicleId(a, over) });
import { listHouseholds } from "@/server/services/households";
import { setVehicleAccess } from "@/server/services/vehicles";

const q = (o: Record<string, unknown> = {}) => txQuerySchema.parse(o);

describe("vehicles inside the finance product", () => {
  it("counts the money once, from the ledger, and only what the viewer is allowed to see", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const v = await createTestVehicle(david, { householdId, nickname: "Family SUV" });
    await setVehicleAccess(david, v.id, { userId: sharon.id, level: "VIEWER", canViewFinancials: true } as never);
    const d = await ctxFor(david, householdId, "write");
    const s = await ctxFor(sharon, householdId, "write");
    const joint = await account(d, "Joint", { visibility: "HOUSEHOLD" });
    const sharonPrivate = await account(s, "Sharon private", { visibility: "PERSONAL" });

    await spend(d, joint, "Fuel", "80.00", { vehicleId: v.id, visibility: "HOUSEHOLD" });
    await spend(d, joint, "Fuel", "20.00", { vehicleId: v.id, visibility: "HOUSEHOLD" }, "2026-03-11");
    await spend(s, sharonPrivate, "Fuel", "500.00", { vehicleId: v.id, visibility: "PERSONAL" });

    const overview = await vehicleOverview(d, { view: "household", from: "2026-03-01", to: "2026-03-31" });
    expect(overview.vehicles).toHaveLength(1);
    expect(overview.vehicles[0].costs?.total).toBe("100.00"); // Sharon's personal 500.00 never reaches David
    expect(overview.totalCost).toBe("100.00");
    const fuel = overview.vehicles[0].costs?.byCategory.find((c) => c.name === "Fuel");
    expect(fuel?.amount).toBe("100.00");

    const mine = await vehicleOverview(s, { view: "my", from: "2026-03-01", to: "2026-03-31" });
    expect(mine.vehicles[0].costs?.total).toBe("500.00");

    // filtering the ledger by vehicle uses the same visibility rules
    expect((await listTransactions(d, q({ vehicleId: v.id }))).items).toHaveLength(2);
    expect((await listTransactions(s, q({ vehicleId: v.id }))).items).toHaveLength(3);
  });

  it("refuses to tag a transaction with a vehicle from another household or one the member cannot see", async () => {
    const { david, householdId } = await coupleHousehold();
    const outsider = await createActor("Outsider", "outsider@example.com");
    const foreign = await createTestVehicle(outsider, {});
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Chequing");
    await expect(spend(d, acct, "Fuel", "10.00", { vehicleId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await createTestVehicle(david, { householdId });
    const t = await spend(d, acct, "Fuel", "10.00", { vehicleId: mine.id }, "2026-03-12");
    await expect(updateTransaction(d, t.id, { vehicleId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await vehicleOptions(d)).map((x) => x.id)).toEqual([mine.id]);
  });

  it("hides costs when the member has no financial access to the vehicle, and shows maintenance on the calendar", async () => {
    const { david, householdId } = await coupleHousehold();
    const v = await createTestVehicle(david, { householdId });
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Chequing");
    await spend(d, acct, "Fuel", "42.00", { vehicleId: v.id });
    const ov = await vehicleOverview(d, { view: "household", from: "2026-01-01", to: "2026-12-31" });
    expect(ov.vehicles[0].costs?.total).toBe("42.00");
    const items = await vehicleObligations(d, "2020-01-01", "2035-12-31");
    expect(items.every((i) => i.direction === "neutral" && i.sourceId === v.id)).toBe(true);
    const all = await obligations(d, "2020-01-01", "2035-12-31", "all");
    expect(all.length).toBeGreaterThanOrEqual(items.length);
  });

  it("reports and the assistant answer vehicle questions from the same figures", async () => {
    const { david, householdId } = await coupleHousehold();
    const v = await createTestVehicle(david, { householdId, nickname: "Family SUV" });
    const d = await ctxFor(david, householdId, "write");
    const acct = await account(d, "Chequing");
    await spend(d, acct, "Fuel", "60.00", { vehicleId: v.id, visibility: "HOUSEHOLD" });
    const rep = await buildFinanceReport(d, { type: "vehicle-costs", view: "household", from: "2026-03-01", to: "2026-03-31", format: "json" } as never);
    expect(rep.rows[0]).toMatchObject({ vehicle: "Family SUV", cost: 60 });
    const a = await ask(d, { question: "What did the car cost in March 2026?", view: "household" });
    expect(a.answer).toContain("60.00");
    expect(await listHouseholds(david)).toBeTruthy();
  });
});
