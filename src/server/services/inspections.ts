import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz } from "@/lib/dates";
import { inspectionSchema, providerSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { num, iso } from "../serialize";
import { accessibleVehicles, requireHouseholdAdmin, requireHouseholdMember, requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { recordReading, syncVehicleOdometer } from "./odometer";
import { refreshVehicleSchedules } from "./schedules";

type InspItems = { assignmentId?: string | null; componentKey?: string | null; name: string; condition: string; notes?: string | null }[];

export function inspectionView(i: Prisma.InspectionGetPayload<object>) {
  return { id: i.id, vehicleId: i.vehicleId, type: i.type, date: iso(i.date), odometerKm: num(i.odometerKm), inspector: i.inspector, providerId: i.providerId, items: i.items as unknown as InspItems, overallCondition: i.overallCondition, nextDueDate: iso(i.nextDueDate), notes: i.notes };
}

export async function createInspection(actor: Actor, input: z.infer<typeof inspectionSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  const aIds = input.items.map((i) => i.assignmentId).filter(Boolean) as string[];
  if (aIds.length && (await db.maintenanceScheduleAssignment.count({ where: { id: { in: aIds }, vehicleId: vehicle.id, deletedAt: null } })) !== new Set(aIds).size) throw new AppError("VALIDATION_ERROR", "An inspected item refers to a schedule from another vehicle");
  const id = await db.$transaction(async (tx) => {
    const ins = await tx.inspection.create({ data: { vehicleId: vehicle.id, type: input.type, date: isoToDate(input.date), odometerKm: input.odometerKm ?? null, inspector: input.inspector ?? null, providerId: input.providerId ?? null, items: input.items as any, overallCondition: input.overallCondition ?? null, nextDueDate: input.nextDueDate ? isoToDate(input.nextDueDate) : null, notes: input.notes ?? null, createdById: actor.id } });
    if (input.odometerKm != null) await recordReading(tx, actor, vehicle, { date: input.date, valueKm: input.odometerKm, source: "INSPECTION", note: "Inspection", inspectionId: ins.id, confirmCorrection: input.confirmOdometerCorrection }, { skipRefresh: true });
    if (input.nextDueDate) await tx.vehicle.update({ where: { id: vehicle.id }, data: { nextInspectionDate: isoToDate(input.nextDueDate) } });
    await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
    await audit(tx, actor, { entity: "Inspection", entityId: ins.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { items: input.items.length } });
    return ins.id;
  });
  return { id };
}

export async function deleteInspection(actor: Actor, id: string) {
  const i = await db.inspection.findFirst({ where: { id, deletedAt: null } });
  if (!i) throw notFound("Inspection");
  const { vehicle } = await requireVehicle(actor, i.vehicleId, "write");
  await db.$transaction(async (tx) => {
    await tx.inspection.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.odometerEntry.updateMany({ where: { inspectionId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    await syncVehicleOdometer(tx, vehicle.id);
    await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
    await audit(tx, actor, { entity: "Inspection", entityId: id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId });
  });
  return { ok: true };
}

export async function listInspections(actor: Actor, vehicleId?: string) {
  const scope = await scopeVehicles(actor, vehicleId, "view");
  const rows = await db.inspection.findMany({ where: { vehicleId: { in: scope.map((s) => s.vehicle.id) }, deletedAt: null }, orderBy: { date: "desc" } });
  return rows.map(inspectionView);
}

// ───────── service providers

export async function listProviders(actor: Actor, householdId?: string) {
  const scope = await accessibleVehicles(actor, "view", householdId ? { householdId } : {});
  const members = await db.householdMember.findMany({ where: { userId: actor.id, ...(householdId ? { householdId } : {}) } });
  const hh = [...new Set([...members.map((m) => m.householdId), ...scope.map((s) => s.vehicle.householdId)])];
  const rows = await db.serviceProvider.findMany({ where: { householdId: { in: hh }, deletedAt: null }, orderBy: { name: "asc" } });
  return rows.map((p) => ({ id: p.id, householdId: p.householdId, name: p.name, type: p.type, phone: p.phone, email: p.email, address: p.address, website: p.website, notes: p.notes }));
}

export async function createProvider(actor: Actor, input: z.infer<typeof providerSchema>) {
  const householdId = input.householdId ?? (await db.householdMember.findFirst({ where: { userId: actor.id, role: "ADMIN" } }))?.householdId;
  if (!householdId) throw new AppError("FORBIDDEN", "No household available");
  await requireHouseholdMember(actor, householdId);
  const exists = await db.serviceProvider.findUnique({ where: { householdId_name: { householdId, name: input.name } } });
  if (exists && !exists.deletedAt) throw new AppError("CONFLICT", "A provider with this name already exists");
  const data = { householdId, name: input.name, type: input.type, phone: input.phone ?? null, email: input.email ?? null, address: input.address ?? null, website: input.website ?? null, notes: input.notes ?? null, deletedAt: null };
  const p = exists ? await db.serviceProvider.update({ where: { id: exists.id }, data }) : await db.serviceProvider.create({ data });
  return { id: p.id };
}

export async function updateProvider(actor: Actor, id: string, input: Partial<z.infer<typeof providerSchema>>) {
  const p = await db.serviceProvider.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw notFound("Provider");
  await requireHouseholdMember(actor, p.householdId);
  const { householdId: _h, ...rest } = input;
  await db.serviceProvider.update({ where: { id }, data: rest as any });
  return { id };
}

export async function deleteProvider(actor: Actor, id: string) {
  const p = await db.serviceProvider.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw notFound("Provider");
  await requireHouseholdAdmin(actor, p.householdId);
  await db.serviceProvider.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
export { dateToIso };
