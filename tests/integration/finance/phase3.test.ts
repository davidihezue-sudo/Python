import { describe, expect, it } from "vitest";
import { account, coupleHousehold, ctxFor, db } from "./helpers";
import { createActor, createTestVehicle } from "../helpers";
import { createFuel, deleteFuel, updateFuel } from "@/server/services/fuel";
import { fuelSchema, fuelUpdateSchema } from "@/lib/validation";
import { vehicleObligations, vehicleOverview } from "@/server/finance/vehicles";
import { createTrip, deleteTrip, keepReplaceDefaults, listTrips, mileageReport, tripSchema } from "@/server/finance/mileage";
import { setVehicleAccess } from "@/server/services/vehicles";

const fuelIn = (o: Record<string, unknown>) => fuelSchema.parse({ date: "2026-03-10", odometerKm: 170000, quantity: 40, unit: "L", totalCost: 80, ...o });

describe("fuel recorded in the ledger", () => {
  it("posts one tagged expense, keeps it in step, and removes it with the fill-up", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const vid = await createTestVehicle(david, { householdId, nickname: "Truck" });
    const acct = await account(d, "Chq");
    const r = await createFuel(david, fuelIn({ vehicleId: vid, ledgerAccountId: acct, station: "Shell" }));
    expect(r.ledgerTransactionId).toBeTruthy();
    const tx = await db.finTransaction.findUniqueOrThrow({ where: { id: r.ledgerTransactionId! } });
    expect(tx.vehicleId).toBe(vid);
    expect(tx.amount.toString()).toBe("-80");
    const ov = await vehicleOverview(d, { view: "my", from: "2026-03-01", to: "2026-03-31" });
    expect(ov.vehicles[0].costs?.total).toBe("80.00");

    await updateFuel(david, r.id, fuelUpdateSchema.parse({ totalCost: 90 }));
    expect((await db.finTransaction.findUniqueOrThrow({ where: { id: r.ledgerTransactionId! } })).amount.toString()).toBe("-90");

    await deleteFuel(david, r.id);
    expect((await db.finTransaction.findUniqueOrThrow({ where: { id: r.ledgerTransactionId! } })).deletedAt).not.toBeNull();
  });

  it("without an account nothing is posted, and a reconciled row is never changed", async () => {
    const { david, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write");
    const vid = await createTestVehicle(david, { householdId });
    const acct = await account(d, "Chq");
    const plain = await createFuel(david, fuelIn({ vehicleId: vid }));
    expect(plain.ledgerTransactionId).toBeNull();
    const r = await createFuel(david, fuelIn({ vehicleId: vid, ledgerAccountId: acct, odometerKm: 170500, date: "2026-03-12" }));
    await db.finTransaction.update({ where: { id: r.ledgerTransactionId! }, data: { reconciliation: "RECONCILED" } });
    await updateFuel(david, r.id, fuelUpdateSchema.parse({ totalCost: 200 }));
    expect((await db.finTransaction.findUniqueOrThrow({ where: { id: r.ledgerTransactionId! } })).amount.toString()).toBe("-80");
  });

  it("refuses another member's private account and a currency mismatch, saving nothing", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const vid = await createTestVehicle(david, { householdId });
    const secret = await account(s, "Sharon private", { visibility: "PERSONAL" });
    const usd = await account(d, "USD", { currency: "USD" });
    const before = await db.fuelEntry.count({ where: { vehicleId: vid } });
    await expect(createFuel(david, fuelIn({ vehicleId: vid, ledgerAccountId: secret }))).rejects.toBeTruthy();
    await expect(createFuel(david, fuelIn({ vehicleId: vid, ledgerAccountId: usd }))).rejects.toBeTruthy();
    expect(await db.fuelEntry.count({ where: { vehicleId: vid } })).toBe(before);
  });
});

describe("mileage log", () => {
  it("logs trips, reports business share and claims, and respects vehicle access", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const vid = await createTestVehicle(david, { householdId, nickname: "Work van" });
    const year = 2026;
    await db.odometerEntry.createMany({ data: [{ vehicleId: vid, date: new Date(`${year}-01-02T00:00:00Z`), valueKm: 170000, source: "MANUAL" } as never, { vehicleId: vid, date: new Date(`${year}-12-01T00:00:00Z`), valueKm: 180000, source: "MANUAL" } as never] });
    await createTrip(d, tripSchema.parse({ vehicleId: vid, date: `${year}-02-01`, km: 120.5, purpose: "Client visit" }));
    const personal = await createTrip(d, tripSchema.parse({ vehicleId: vid, date: `${year}-02-02`, km: 30, business: false }));
    expect((await listTrips(d, { year })).items).toHaveLength(2);
    const rep = await mileageReport(d, { year });
    expect(rep.vehicles[0].businessKm).toBe("120.5");
    expect(rep.vehicles[0].trips).toBe(2);
    await deleteTrip(d, personal.id);
    expect((await listTrips(d, { year })).items).toHaveLength(1);
    // Sharon has no access to this vehicle yet: she sees nothing and cannot log on it
    expect((await listTrips(s, { year })).items).toHaveLength(0);
    await expect(createTrip(s, tripSchema.parse({ vehicleId: vid, date: `${year}-03-01`, km: 10 }))).rejects.toBeTruthy();
    await setVehicleAccess(david, vid, { userId: sharon.id, level: "MAINTENANCE_MANAGER", canViewFinancials: false } as never);
    expect((await listTrips(s, { year })).items).toHaveLength(1);
    await expect(keepReplaceDefaults(s, vid)).rejects.toBeTruthy();
  });
});

describe("vehicle documents on the money calendar", () => {
  it("shows an expiring document to people with access only", async () => {
    const { david, sharon, householdId } = await coupleHousehold();
    const d = await ctxFor(david, householdId, "write"), s = await ctxFor(sharon, householdId, "write");
    const vid = await createTestVehicle(david, { householdId, nickname: "Sedan" });
    await db.document.create({ data: { householdId, vehicleId: vid, title: "Registration slip", category: "OTHER", fileKey: `k-${Date.now()}-a`, fileName: "r.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x", expiresOn: new Date("2026-11-15T00:00:00Z") } });
    await db.document.create({ data: { householdId, vehicleId: vid, title: "Insurance slip", category: "INSURANCE", fileKey: `k-${Date.now()}-b`, fileName: "i.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "y", expiresOn: new Date("2026-11-20T00:00:00Z") } });
    const mine = await vehicleObligations(d, "2026-11-01", "2026-11-30");
    expect(mine.map((o) => o.title).join("|")).toContain("Registration slip expires");
    expect(await vehicleObligations(s, "2026-11-01", "2026-11-30")).toHaveLength(0);
    await setVehicleAccess(david, vid, { userId: sharon.id, level: "VIEWER", canViewFinancials: false } as never);
    const theirs = (await vehicleObligations(s, "2026-11-01", "2026-11-30")).map((o) => o.title).join("|");
    expect(theirs).toContain("Registration slip expires");
    expect(theirs).not.toContain("Insurance slip");
  });
});
void createActor;
