// Mileage log for tax, and the keep-or-replace planner. Both rest on vehicle access: you only see and change vehicles you may.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { accessibleVehicles, requireVehicle } from "../services/access";
import { audit } from "../services/audit";
import { D, ZERO, money } from "./engine/decimal";
import { MILEAGE_RATES, MILEAGE_SOURCE, mileageClaim } from "./engine/mileage";
import { keepOrReplace } from "./engine/keepreplace";
import { netExpense } from "./analytics";
import { loadReportTxs } from "./load";
import { id, isoDate, nonNegMoney, optText, toDate } from "./common";
import type { FinCtx } from "./access";

const km = z.number().positive().max(100000).transform((n) => Math.round(n * 10) / 10);
export const tripSchema = z.object({ vehicleId: id, date: isoDate, km, business: z.boolean().default(true), purpose: optText(200), fromPlace: optText(100), toPlace: optText(100) });
export const tripQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), vehicleId: id.optional() });
const yearOf = (ctx: FinCtx, y?: number) => y ?? Number(ctx.today.slice(0, 4));
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function inHousehold(ctx: FinCtx, vehicleId: string, cap: "view" | "write") {
  const { vehicle, fin } = await requireVehicle(ctx.actor, vehicleId, cap);
  if (vehicle.householdId !== ctx.householdId) throw notFound("Vehicle");
  return { vehicle, fin };
}

export async function listTrips(ctx: FinCtx, q: z.infer<typeof tripQuery>) {
  const year = yearOf(ctx, q.year);
  const scope = (await accessibleVehicles(ctx.actor, "view", { householdId: ctx.householdId })).filter((s) => !q.vehicleId || s.vehicle.id === q.vehicleId);
  const rows = await db.mileageTrip.findMany({ where: { vehicleId: { in: scope.map((s) => s.vehicle.id) }, deletedAt: null, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const name = new Map(scope.map((s) => [s.vehicle.id, s.vehicle.nickname || `${s.vehicle.year} ${s.vehicle.make} ${s.vehicle.model}`]));
  return { year, items: rows.map((r) => ({ id: r.id, vehicleId: r.vehicleId, vehicle: name.get(r.vehicleId) ?? "", date: iso(r.date), km: Number(r.km), business: r.business, purpose: r.purpose, fromPlace: r.fromPlace, toPlace: r.toPlace })) };
}

export async function createTrip(ctx: FinCtx, input: z.infer<typeof tripSchema>) {
  await inHousehold(ctx, input.vehicleId, "write");
  const t = await db.mileageTrip.create({ data: { vehicleId: input.vehicleId, date: toDate(input.date), km: input.km, business: input.business, purpose: input.purpose ?? null, fromPlace: input.fromPlace ?? null, toPlace: input.toPlace ?? null, createdById: ctx.actor.id } });
  await audit(null, ctx.actor, { entity: "MileageTrip", entityId: t.id, action: "create", vehicleId: input.vehicleId, householdId: ctx.householdId, after: { km: input.km, business: input.business } });
  return { id: t.id };
}

export async function deleteTrip(ctx: FinCtx, tripId: string) {
  const t = await db.mileageTrip.findFirst({ where: { id: tripId, deletedAt: null } });
  if (!t) throw notFound("Trip");
  await inHousehold(ctx, t.vehicleId, "write");
  await db.mileageTrip.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

/** Business kilometres, total kilometres from odometer readings, the business share and the two claim methods. */
export async function mileageReport(ctx: FinCtx, q: z.infer<typeof tripQuery>) {
  const year = yearOf(ctx, q.year);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const scope = (await accessibleVehicles(ctx.actor, "view", { householdId: ctx.householdId })).filter((s) => !q.vehicleId || s.vehicle.id === q.vehicleId);
  const withCosts = scope.filter((s) => s.fin).map((s) => s.vehicle.id);
  const { txs } = withCosts.length ? await loadReportTxs(ctx, from, to, "my", { vehicleId: { in: withCosts } }) : { txs: [] };
  const out = [];
  for (const s of scope) {
    const v = s.vehicle;
    const trips = await db.mileageTrip.findMany({ where: { vehicleId: v.id, deletedAt: null, date: { gte: toDate(from), lte: toDate(to) } } });
    const business = trips.filter((t) => t.business).reduce((a, t) => a.plus(D(t.km)), ZERO);
    const readings = await db.odometerEntry.findMany({ where: { vehicleId: v.id, deletedAt: null, date: { gte: toDate(from), lte: toDate(to) } }, orderBy: { date: "asc" }, select: { valueKm: true } });
    const total = readings.length >= 2 ? D(readings[readings.length - 1].valueKm).minus(readings[0].valueKm) : null;
    let costs = null as ReturnType<typeof D> | null;
    if (s.fin) { costs = ZERO; for (const t of txs.filter((x) => x.vehicleId === v.id)) { const ne = netExpense(t); if (ne) costs = costs.plus(ne); } }
    const claim = mileageClaim({ year, businessKm: business, totalKm: total, runningCosts: costs });
    out.push({ vehicleId: v.id, name: v.nickname || `${v.year} ${v.make} ${v.model}`, trips: trips.length, businessKm: business.toDecimalPlaces(1).toString(), totalKm: total ? total.toDecimalPlaces(1).toString() : null, runningCosts: costs ? money(costs) : null, canViewCosts: s.fin, ...claim });
  }
  return { year, currency: ctx.base, vehicles: out, rates: MILEAGE_RATES[year] ?? null, source: MILEAGE_SOURCE, note: "Only vehicles you can see are listed. Running costs are the ledger expenses you can see that are tagged with the vehicle." };
}

// ───────────── keep or replace
const pctN = z.number().min(0).max(60);
export const keepReplaceSchema = z.object({
  years: z.number().int().min(1).max(15).default(5),
  keep: z.object({ value: nonNegMoney, annualRepairs: nonNegMoney, repairGrowthPct: z.number().min(0).max(50).default(10), annualFuel: nonNegMoney, annualInsurance: nonNegMoney, depreciationPct: pctN.default(10) }),
  replace: z.object({ price: nonNegMoney, annualRepairs: nonNegMoney, annualFuel: nonNegMoney, annualInsurance: nonNegMoney, firstYearDepreciationPct: pctN.default(20), depreciationPct: pctN.default(12), downPayment: nonNegMoney.default("0.00"), loanRatePct: z.number().min(0).max(40).default(7), loanMonths: z.number().int().min(0).max(120).default(60) }),
});
export async function keepReplace(_ctx: FinCtx, i: z.infer<typeof keepReplaceSchema>) { return keepOrReplace(i as never); }

/** Starting numbers from what the vehicle really cost over the last twelve months (only when the member may see its costs). */
export async function keepReplaceDefaults(ctx: FinCtx, vehicleId: string) {
  const { vehicle, fin } = await inHousehold(ctx, vehicleId, "view");
  if (!fin) throw new AppError("FORBIDDEN", "You do not have financial access to this vehicle");
  const since = toDate(new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10));
  const exp = await db.expense.findMany({ where: { vehicleId, deletedAt: null, date: { gte: since } }, select: { category: true, amount: true } });
  const sum = (cats: string[]) => exp.filter((e) => cats.includes(e.category)).reduce((a, e) => a.plus(D(e.amount)), ZERO);
  return {
    vehicleId, name: vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`, currency: vehicle.currency,
    annualRepairs: money(sum(["MAINTENANCE", "REPAIRS", "TIRES"])), annualFuel: money(sum(["FUEL"])), annualInsurance: money(sum(["INSURANCE"])),
    purchasePrice: vehicle.purchasePrice ? money(vehicle.purchasePrice) : null,
    basis: "The last twelve months of expenses recorded in the vehicle module. Adjust anything that does not look right.",
  };
}
