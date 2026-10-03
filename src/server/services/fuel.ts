import type { Prisma } from "@prisma/client";
import { db, type Db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz } from "@/lib/dates";
import { fuelSchema, fuelUpdateSchema } from "@/lib/validation";
import { fuelEconomyLabel, litresPer100kmToUnit, litresToUnit, unitToLitres, volumeLabel } from "@/lib/units";
import type { z } from "zod";
import type { Actor } from "../context";
import { computeFuelStats } from "../engine/fuel";
import { num, iso } from "../serialize";
import { requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { recordReading, syncVehicleOdometer } from "./odometer";
import { refreshVehicleSchedules } from "./schedules";
import { checkLedgerAccount, postFuelToLedger, removeFuelLedger, syncFuelLedger } from "../finance/fuelpost";

async function applyDerived(tx: Db, actor: Actor, vehicle: { id: string; householdId: string; currency: string }, fuelId: string, confirm: boolean) {
  const f = await tx.fuelEntry.findUniqueOrThrow({ where: { id: fuelId } });
  await recordReading(tx, actor, vehicle, { date: dateToIso(f.date) as string, valueKm: Number(f.odometerKm), source: "FUEL", note: "Fuel fill-up", fuelEntryId: f.id, confirmCorrection: confirm }, { skipRefresh: true });
  const existing = await tx.expense.findUnique({ where: { fuelEntryId: f.id } });
  const data = { vehicleId: vehicle.id, date: f.date, amount: f.totalCost, currency: f.currency, category: "FUEL" as const, vendor: f.station, description: "Fuel", fuelEntryId: f.id, deletedAt: null };
  if (Number(f.totalCost) > 0) {
    if (existing) await tx.expense.update({ where: { id: existing.id }, data });
    else await tx.expense.create({ data: { ...data, createdById: actor.id } });
  } else if (existing) await tx.expense.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await syncVehicleOdometer(tx, vehicle.id);
  await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
}

export async function createFuel(actor: Actor, input: z.infer<typeof fuelSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (input.idempotencyKey) {
    const dup = await db.fuelEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) {
      if (dup.vehicleId !== vehicle.id) throw new AppError("CONFLICT", "Idempotency key already used");
      return { id: dup.id, idempotentReplay: true };
    }
  }
  if (input.ledgerAccountId) await checkLedgerAccount(actor, vehicle.householdId, input.ledgerAccountId, input.currency ?? vehicle.currency);
  const litres = unitToLitres(input.quantity, input.unit);
  const total = input.totalCost > 0 ? input.totalCost : input.pricePerUnit ? Math.round(input.pricePerUnit * input.quantity * 100) / 100 : 0;
  const id = await db.$transaction(async (tx) => {
    const f = await tx.fuelEntry.create({
      data: { vehicleId: vehicle.id, date: isoToDate(input.date), odometerKm: input.odometerKm, quantityL: litres, enteredQuantity: input.quantity, enteredUnit: input.unit, pricePerL: litres > 0 && total > 0 ? total / litres : null, totalCost: total, currency: input.currency ?? vehicle.currency, fuelType: input.fuelType, station: input.station ?? null, fullTank: input.fullTank, missedPrevious: input.missedPrevious, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey ?? null, createdById: actor.id },
    });
    await applyDerived(tx, actor, vehicle, f.id, input.confirmOdometerCorrection);
    await audit(tx, actor, { entity: "FuelEntry", entityId: f.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { litres, total } });
    return f.id;
  });
  let ledgerTransactionId: string | null = null;
  if (input.ledgerAccountId) ledgerTransactionId = (await postFuelToLedger(actor, id, input.ledgerAccountId)).transactionId;
  return { id, idempotentReplay: false, ledgerTransactionId };
}

export async function updateFuel(actor: Actor, id: string, input: z.infer<typeof fuelUpdateSchema>) {
  const f = await db.fuelEntry.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw notFound("Fuel entry");
  const { vehicle } = await requireVehicle(actor, f.vehicleId, "write");
  await db.$transaction(async (tx) => {
    await tx.odometerEntry.updateMany({ where: { fuelEntryId: f.id, deletedAt: null }, data: { deletedAt: new Date() } });
    const unit = input.unit ?? f.enteredUnit;
    const qty = input.quantity ?? Number(f.enteredQuantity);
    const litres = unitToLitres(qty, unit);
    const total = input.totalCost ?? Number(f.totalCost);
    await tx.fuelEntry.update({
      where: { id },
      data: {
        ...(input.date ? { date: isoToDate(input.date) } : {}),
        ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
        quantityL: litres,
        enteredQuantity: qty,
        enteredUnit: unit,
        totalCost: total,
        pricePerL: litres > 0 && total > 0 ? total / litres : null,
        ...(input.fuelType ? { fuelType: input.fuelType } : {}),
        ...(input.station !== undefined ? { station: input.station } : {}),
        ...(input.fullTank !== undefined ? { fullTank: input.fullTank } : {}),
        ...(input.missedPrevious !== undefined ? { missedPrevious: input.missedPrevious } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    await applyDerived(tx, actor, vehicle, id, !!input.confirmOdometerCorrection);
    await audit(tx, actor, { entity: "FuelEntry", entityId: id, action: "update", vehicleId: vehicle.id, householdId: vehicle.householdId });
  });
  await syncFuelLedger(actor, id);
  return { id };
}

export async function deleteFuel(actor: Actor, id: string) {
  const f = await db.fuelEntry.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw notFound("Fuel entry");
  const { vehicle } = await requireVehicle(actor, f.vehicleId, "write");
  await removeFuelLedger(actor, id);
  await db.$transaction(async (tx) => {
    await tx.odometerEntry.updateMany({ where: { fuelEntryId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.expense.updateMany({ where: { fuelEntryId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.fuelEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await syncVehicleOdometer(tx, vehicle.id);
    await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
    await audit(tx, actor, { entity: "FuelEntry", entityId: id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId });
  });
  return { ok: true };
}

type FuelRow = Prisma.FuelEntryGetPayload<{ include: { vehicle: { select: { id: true; nickname: true; make: true; model: true; year: true } } } }>;

export async function listFuel(actor: Actor, q: { vehicleId?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const fin = new Set(scope.filter((s) => s.fin).map((s) => s.vehicle.id));
  const where: Prisma.FuelEntryWhereInput = { vehicleId: { in: scope.map((s) => s.vehicle.id) }, deletedAt: null, ...(q.from || q.to ? { date: { ...(q.from ? { gte: isoToDate(q.from) } : {}), ...(q.to ? { lte: isoToDate(q.to) } : {}) } } : {}) };
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(500, q.pageSize ?? 25);
  const [total, rows] = await Promise.all([db.fuelEntry.count({ where }), db.fuelEntry.findMany({ where, include: { vehicle: { select: { id: true, nickname: true, make: true, model: true, year: true } } }, orderBy: [{ date: "desc" }, { odometerKm: "desc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  const view = (r: FuelRow) => ({
    id: r.id,
    vehicleId: r.vehicleId,
    vehicleName: r.vehicle.nickname || `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
    date: iso(r.date),
    odometerKm: Number(r.odometerKm),
    quantityL: Number(r.quantityL),
    displayQuantity: litresToUnit(Number(r.quantityL), actor.prefs.volumeUnit),
    displayUnit: volumeLabel(actor.prefs.volumeUnit),
    totalCost: fin.has(r.vehicleId) ? Number(r.totalCost) : null,
    pricePerL: fin.has(r.vehicleId) ? num(r.pricePerL) : null,
    currency: r.currency,
    fuelType: r.fuelType,
    station: r.station,
    fullTank: r.fullTank,
    missedPrevious: r.missedPrevious,
    notes: r.notes,
  });
  return { items: rows.map(view), page, pageSize, total };
}

export async function fuelStats(actor: Actor, vehicleId: string, range: { from?: string; to?: string } = {}) {
  const { fin, vehicle } = await requireVehicle(actor, vehicleId, "view");
  const rows = await db.fuelEntry.findMany({ where: { vehicleId, deletedAt: null, ...(range.from || range.to ? { date: { ...(range.from ? { gte: isoToDate(range.from) } : {}), ...(range.to ? { lte: isoToDate(range.to) } : {}) } } : {}) } });
  const stats = computeFuelStats(rows.map((r) => ({ id: r.id, date: dateToIso(r.date) as string, odometerKm: Number(r.odometerKm), litres: Number(r.quantityL), totalCost: Number(r.totalCost), fullTank: r.fullTank, missedPrevious: r.missedPrevious })));
  const u = actor.prefs.fuelEconomyUnit;
  const conv = (l100: number | null) => (l100 === null ? null : litresPer100kmToUnit(l100, u));
  return {
    vehicleId,
    currency: vehicle.currency,
    economyUnit: fuelEconomyLabel(u),
    fuelEconomyUnit: u,
    volumeUnit: volumeLabel(actor.prefs.volumeUnit),
    avgEconomy: conv(stats.avgLitresPer100Km),
    bestEconomy: u === "L_PER_100KM" ? conv(stats.bestLitresPer100Km) : conv(stats.worstLitresPer100Km),
    worstEconomy: u === "L_PER_100KM" ? conv(stats.worstLitresPer100Km) : conv(stats.bestLitresPer100Km),
    avgLitresPer100Km: stats.avgLitresPer100Km,
    avgDistanceBetweenFills: stats.avgDistanceBetweenFills,
    totalLitres: stats.totalLitres,
    displayTotalVolume: litresToUnit(stats.totalLitres, actor.prefs.volumeUnit),
    fillCount: stats.fillCount,
    totalCost: fin ? stats.totalCost : null,
    avgCostPerKm: fin ? stats.avgCostPerKm : null,
    avgPricePerLitre: fin ? stats.avgPricePerLitre : null,
    segments: stats.segments.map((s) => ({ date: s.date, distanceKm: s.distanceKm, litres: s.litres, economy: conv(s.litresPer100Km), litresPer100Km: s.litresPer100Km, costPerKm: fin ? s.costPerKm : null })),
    monthly: stats.monthlyCost.map((m) => ({ month: m.month, total: fin ? m.total : null, litres: m.litres })),
    priceTrend: fin ? stats.priceTrend : [],
    note: stats.note,
  };
}
