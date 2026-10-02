import type { OdometerSource, Vehicle } from "@prisma/client";
import { db, type Db } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz, type IsoDate } from "@/lib/dates";
import { odometerSchema, odometerUpdateSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { computeUsage, monthlyDistance, projectKm, validateReading, type Reading } from "../engine/mileage";
import { num } from "../serialize";
import { requireVehicle } from "./access";
import { audit } from "./audit";
import { loadReadings, refreshVehicleSchedules } from "./schedules";

export interface ReadingInput {
  date: IsoDate;
  valueKm: number;
  source: OdometerSource;
  note?: string | null;
  confirmCorrection?: boolean;
  maintenanceRecordId?: string | null;
  fuelEntryId?: string | null;
  inspectionId?: string | null;
}

export async function syncVehicleOdometer(client: Db, vehicleId: string) {
  const latest = await client.odometerEntry.findFirst({ where: { vehicleId, deletedAt: null }, orderBy: [{ date: "desc" }, { valueKm: "desc" }] });
  await client.vehicle.update({ where: { id: vehicleId }, data: { currentOdometerKm: latest?.valueKm ?? null, currentOdometerAt: latest?.date ?? null } });
}

/**
 * Records an odometer reading inside the caller's transaction. Rejects regressions unless the caller explicitly
 * confirms a correction. Returns warnings (e.g. implausible daily distance) and whether a correction was applied.
 */
export async function recordReading(client: Db, actor: Pick<Actor, "id" | "ip"> | null, vehicle: Pick<Vehicle, "id" | "householdId">, input: ReadingInput, opts: { skipRefresh?: boolean; excludeEntryId?: string } = {}) {
  const existingRows = await client.odometerEntry.findMany({ where: { vehicleId: vehicle.id, deletedAt: null, ...(opts.excludeEntryId ? { id: { not: opts.excludeEntryId } } : {}) }, select: { id: true, date: true, valueKm: true, source: true } });
  const existing: Reading[] = existingRows.map((r) => ({ date: dateToIso(r.date) as string, valueKm: Number(r.valueKm) }));
  const dup = existingRows.find((r) => dateToIso(r.date) === input.date && Number(r.valueKm) === input.valueKm);
  if (dup) return { entryId: dup.id, warnings: [] as string[], corrected: false, duplicate: true };

  const check = validateReading(existing, { date: input.date, valueKm: input.valueKm });
  let isCorrection = false;
  const warnings: string[] = [];
  if (!check.ok) {
    if (!input.confirmCorrection) {
      throw new AppError("ODOMETER_REGRESSION", check.message, { code: check.code, conflict: check.conflict, requiresConfirmation: true });
    }
    isCorrection = true;
  } else warnings.push(...check.warnings);

  const entry = await client.odometerEntry.create({
    data: {
      vehicleId: vehicle.id,
      date: isoToDate(input.date),
      valueKm: input.valueKm,
      source: input.source,
      note: input.note ?? (isCorrection ? "Correction confirmed by user" : null),
      isCorrection,
      maintenanceRecordId: input.maintenanceRecordId ?? null,
      fuelEntryId: input.fuelEntryId ?? null,
      inspectionId: input.inspectionId ?? null,
      createdById: actor?.id ?? null,
    },
  });
  await syncVehicleOdometer(client, vehicle.id);
  if (isCorrection) await audit(client, actor, { entity: "OdometerEntry", entityId: entry.id, action: "correction", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { date: input.date, valueKm: input.valueKm, conflict: !check.ok ? check.conflict : null } });
  if (!opts.skipRefresh) await refreshVehicleSchedules(client, vehicle.id);
  return { entryId: entry.id, warnings, corrected: isCorrection, duplicate: false };
}

export async function addReading(actor: Actor, vehicleId: string, input: z.infer<typeof odometerSchema>) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "write");
  const res = await db.$transaction((tx) => recordReading(tx, actor, vehicle, { ...input, source: input.source }));
  return res;
}

export async function updateReading(actor: Actor, entryId: string, input: z.infer<typeof odometerUpdateSchema>) {
  const e = await db.odometerEntry.findFirst({ where: { id: entryId, deletedAt: null } });
  if (!e) throw notFound("Odometer entry");
  const { vehicle } = await requireVehicle(actor, e.vehicleId, "write");
  if (e.maintenanceRecordId || e.fuelEntryId || e.inspectionId) throw conflict("This reading belongs to a service/fuel/inspection record — edit that record instead.");
  const date = input.date ?? (dateToIso(e.date) as string);
  const value = input.valueKm ?? Number(e.valueKm);
  return db.$transaction(async (tx) => {
    const others = (await loadReadings(tx, vehicle.id)).filter((r) => !(r.date === dateToIso(e.date) && r.valueKm === Number(e.valueKm)));
    const check = validateReading(others, { date, valueKm: value });
    if (!check.ok && !input.confirmCorrection) throw new AppError("ODOMETER_REGRESSION", check.message, { code: check.code, conflict: check.conflict, requiresConfirmation: true });
    await tx.odometerEntry.update({ where: { id: e.id }, data: { date: isoToDate(date), valueKm: value, note: input.note !== undefined ? input.note : e.note, isCorrection: !check.ok || e.isCorrection } });
    await audit(tx, actor, { entity: "OdometerEntry", entityId: e.id, action: "update", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { date: dateToIso(e.date), valueKm: Number(e.valueKm) }, after: { date, valueKm: value } });
    await syncVehicleOdometer(tx, vehicle.id);
    await refreshVehicleSchedules(tx, vehicle.id);
    return { ok: true, warnings: check.ok ? check.warnings : [] };
  });
}

export async function deleteReading(actor: Actor, entryId: string) {
  const e = await db.odometerEntry.findFirst({ where: { id: entryId, deletedAt: null } });
  if (!e) throw notFound("Odometer entry");
  const { vehicle } = await requireVehicle(actor, e.vehicleId, "write");
  if (e.maintenanceRecordId || e.fuelEntryId || e.inspectionId) throw conflict("This reading belongs to a service/fuel/inspection record — edit that record instead.");
  await db.$transaction(async (tx) => {
    await tx.odometerEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, { entity: "OdometerEntry", entityId: e.id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { date: dateToIso(e.date), valueKm: Number(e.valueKm) } });
    await syncVehicleOdometer(tx, vehicle.id);
    await refreshVehicleSchedules(tx, vehicle.id);
  });
  return { ok: true };
}

export async function importReadings(actor: Actor, vehicleId: string, rows: { date: string; valueKm: number; note?: string | null }[], source: OdometerSource = "IMPORT") {
  const { vehicle } = await requireVehicle(actor, vehicleId, "write");
  if (rows.length > 1000) throw new AppError("BAD_REQUEST", "Import at most 1000 readings at a time");
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.valueKm - b.valueKm));
  const result = await db.$transaction(async (tx) => {
    let created = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [i, r] of sorted.entries()) {
      try {
        const out = await recordReading(tx, actor, vehicle, { date: r.date, valueKm: r.valueKm, source, note: r.note ?? null }, { skipRefresh: true });
        out.duplicate ? skipped++ : created++;
      } catch (e) {
        if (e instanceof AppError) errors.push({ row: i + 1, message: e.message });
        else throw e;
      }
    }
    if (errors.length) throw new AppError("VALIDATION_ERROR", `${errors.length} reading(s) were rejected; nothing was imported.`, { errors });
    await refreshVehicleSchedules(tx, vehicle.id);
    return { created, skipped };
  });
  return result;
}

export async function getOdometerOverview(actor: Actor, vehicleId: string) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "view");
  const entries = await db.odometerEntry.findMany({ where: { vehicleId, deletedAt: null }, orderBy: [{ date: "desc" }, { valueKm: "desc" }] });
  const readings: Reading[] = [...entries].reverse().map((e) => ({ date: dateToIso(e.date) as string, valueKm: Number(e.valueKm) }));
  const usage = computeUsage(readings);
  const today = todayInTz(actor.prefs.timezone);
  const last = readings.at(-1) ?? null;
  const proj = (days: number) => {
    const d = new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
    const km = projectKm(last, d, usage.avgDailyKm);
    return km === null ? null : { date: d, km: Math.round(km) };
  };
  return {
    vehicleId,
    currentKm: num(vehicle.currentOdometerKm),
    currentAt: dateToIso(vehicle.currentOdometerAt),
    entries: entries.map((e) => ({ id: e.id, date: dateToIso(e.date), valueKm: Number(e.valueKm), source: e.source, note: e.note, isCorrection: e.isCorrection, linked: !!(e.maintenanceRecordId || e.fuelEntryId || e.inspectionId) })),
    usage,
    monthly: monthlyDistance(readings),
    projections: { in30Days: proj(30), in90Days: proj(90), in365Days: proj(365) },
  };
}
