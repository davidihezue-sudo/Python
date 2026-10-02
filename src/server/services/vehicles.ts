import type { Prisma, Vehicle } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz } from "@/lib/dates";
import { vehicleAccessSchema, vehicleCreateSchema, vehicleUpdateSchema, ownershipSchema } from "@/lib/validation";
import { checkVin } from "@/lib/vin";
import type { z } from "zod";
import type { Actor } from "../context";
import { TEMPLATES } from "../reference/library";
import { num, iso } from "../serialize";
import { accessibleVehicles, primaryHouseholdId, requireHouseholdAdmin, requireVehicle } from "./access";
import { audit } from "./audit";
import { assertVehicleLimit } from "./entitlements";
import { recordReading } from "./odometer";
import { applyLibrary, applyTemplateSchedules, evaluateVehicleSchedules } from "./schedules";

export const SPEC_FIELDS = ["make", "model", "year", "trim", "generation", "engineType", "engineDisplacementL", "engineCode", "fuelType", "transmission", "drivetrain", "bodyType", "vin", "colour"] as const;

export const vehicleDisplayName = (v: Pick<Vehicle, "nickname" | "year" | "make" | "model">) => v.nickname || `${v.year} ${v.make} ${v.model}`;

function vehicleBase(v: Vehicle, fin: boolean) {
  return {
    id: v.id,
    householdId: v.householdId,
    nickname: v.nickname,
    displayName: vehicleDisplayName(v),
    make: v.make,
    model: v.model,
    year: v.year,
    trim: v.trim,
    generation: v.generation,
    engineType: v.engineType,
    engineDisplacementL: num(v.engineDisplacementL),
    engineCode: v.engineCode,
    fuelType: v.fuelType,
    transmission: v.transmission,
    drivetrain: v.drivetrain,
    vin: v.vin,
    registrationNumber: v.registrationNumber,
    colour: v.colour,
    bodyType: v.bodyType,
    market: v.market,
    purchaseDate: iso(v.purchaseDate),
    purchasePrice: fin ? num(v.purchasePrice) : null,
    purchaseOdometerKm: num(v.purchaseOdometerKm),
    currentOdometerKm: num(v.currentOdometerKm),
    currentOdometerAt: iso(v.currentOdometerAt),
    ownershipStatus: v.ownershipStatus,
    currency: v.currency,
    insuranceProvider: v.insuranceProvider,
    insurancePolicyNumber: fin ? v.insurancePolicyNumber : null,
    insuranceRenewalDate: iso(v.insuranceRenewalDate),
    registrationExpiryDate: iso(v.registrationExpiryDate),
    nextInspectionDate: iso(v.nextInspectionDate),
    photoDocumentId: v.photoDocumentId,
    photoUrl: v.photoDocumentId ? `/api/documents/${v.photoDocumentId}/file` : null,
    notes: v.notes,
    isDemo: v.isDemo,
    templateKey: v.templateKey,
  };
}

export async function listVehicles(actor: Actor, opts: { householdId?: string } = {}) {
  const scope = await accessibleVehicles(actor, "view", opts);
  const out = [];
  for (const s of scope) {
    const bundle = await evaluateVehicleSchedules(s.vehicle.id, actor.prefs, s.fin);
    const open = await db.repairIssue.count({ where: { vehicleId: s.vehicle.id, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } });
    const enabled = bundle.items.filter((i) => i.enabled);
    const next = enabled.find((i) => i.status !== "UNKNOWN_HISTORY" && i.status !== "UP_TO_DATE" || i.effectiveDueDate) ?? null;
    const worst = enabled.find((i) => i.status !== "UNKNOWN_HISTORY") ?? null;
    out.push({
      ...vehicleBase(s.vehicle, s.fin),
      accessLevel: s.access.householdRole === "ADMIN" ? "ADMIN" : (s.access.vehicleLevel ?? "NONE"),
      canWrite: s.access.householdRole === "ADMIN" || ["OWNER", "CO_OWNER", "MAINTENANCE_MANAGER"].includes(s.access.vehicleLevel ?? ""),
      canViewFinancials: s.fin,
      health: bundle.health,
      overdueCount: enabled.filter((i) => i.status === "OVERDUE").length,
      dueCount: enabled.filter((i) => ["DUE_NOW", "DUE_SOON"].includes(i.status)).length,
      openIssues: open,
      nextService: next ? { id: next.id, name: next.name, status: next.status, summary: next.summary, dueDate: next.effectiveDueDate, nextDueKm: next.nextDueKm } : null,
      worstStatus: worst?.status ?? null,
    });
  }
  return out;
}

export async function getVehicle(actor: Actor, vehicleId: string) {
  const { vehicle, access, fin } = await requireVehicle(actor, vehicleId, "view");
  const [spec, ownerships, grants, counts] = await Promise.all([
    db.vehicleSpecification.findUnique({ where: { vehicleId } }),
    db.vehicleOwnership.findMany({ where: { vehicleId }, orderBy: { fromDate: "desc" } }),
    access.householdRole === "ADMIN" || access.vehicleLevel === "OWNER"
      ? db.vehicleAccess.findMany({ where: { vehicleId }, include: { user: { select: { id: true, name: true, email: true } } } })
      : Promise.resolve([]),
    Promise.all([
      db.maintenanceRecord.count({ where: { vehicleId, deletedAt: null, kind: "MAINTENANCE", status: "COMPLETED" } }),
      db.repairIssue.count({ where: { vehicleId, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      db.document.count({ where: { vehicleId, deletedAt: null } }),
    ]),
  ]);
  const bundle = await evaluateVehicleSchedules(vehicleId, actor.prefs, fin);
  const lastService = await db.maintenanceRecord.findFirst({ where: { vehicleId, deletedAt: null, status: "COMPLETED" }, orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }] });
  const [maintSum, repairSum] = fin
    ? await Promise.all([
        db.expense.aggregate({ where: { vehicleId, deletedAt: null, category: "MAINTENANCE" }, _sum: { amount: true } }),
        db.expense.aggregate({ where: { vehicleId, deletedAt: null, category: "REPAIRS" }, _sum: { amount: true } }),
      ])
    : [null, null];
  const lifetime = fin ? await db.expense.aggregate({ where: { vehicleId, deletedAt: null }, _sum: { amount: true } }) : null;
  return {
    ...vehicleBase(vehicle, fin),
    accessLevel: access.householdRole === "ADMIN" ? "ADMIN" : (access.vehicleLevel ?? "NONE"),
    permissions: {
      write: access.householdRole === "ADMIN" || ["OWNER", "CO_OWNER", "MAINTENANCE_MANAGER"].includes(access.vehicleLevel ?? ""),
      edit: access.householdRole === "ADMIN" || ["OWNER", "CO_OWNER"].includes(access.vehicleLevel ?? ""),
      manageAccess: access.householdRole === "ADMIN" || access.vehicleLevel === "OWNER",
      financials: fin,
    },
    specification: spec ? { decoder: spec.decoder, decodedAt: spec.decodedAt?.toISOString() ?? null, decoded: spec.decoded, confirmedFields: spec.confirmedFields } : null,
    ownerships: ownerships.map((o) => ({ id: o.id, ownerName: o.ownerName, fromDate: iso(o.fromDate), toDate: iso(o.toDate), fromOdometerKm: num(o.fromOdometerKm), toOdometerKm: num(o.toOdometerKm), notes: o.notes })),
    access: grants.map((g) => ({ id: g.id, userId: g.userId, name: g.user.name, email: g.user.email, level: g.level, canViewFinancials: g.canViewFinancials })),
    health: bundle.health,
    usage: bundle.usage,
    stats: {
      completedServices: counts[0],
      openIssues: counts[1],
      documents: counts[2],
      lastServiceDate: iso(lastService?.serviceDate),
      lastServiceTitle: lastService?.title ?? null,
      lastServiceKm: num(lastService?.odometerKm),
      maintenanceSpend: fin ? num(maintSum?._sum.amount) ?? 0 : null,
      repairSpend: fin ? num(repairSum?._sum.amount) ?? 0 : null,
      lifetimeSpend: fin ? num(lifetime?._sum.amount) ?? 0 : null,
    },
  };
}

type CreateInput = z.infer<typeof vehicleCreateSchema>;

export async function createVehicle(actor: Actor, input: CreateInput) {
  const householdId = input.householdId ?? (await primaryHouseholdId(actor));
  await requireHouseholdAdmin(actor, householdId);
  await assertVehicleLimit(householdId);
  if (input.vin) {
    const dup = await db.vehicle.findFirst({ where: { householdId, vin: input.vin, deletedAt: null } });
    if (dup) throw new AppError("CONFLICT", "A vehicle with this VIN already exists in this household", { existingId: dup.id });
  }
  const template = input.templateKey ? TEMPLATES.find((t) => t.key === input.templateKey) : undefined;
  if (input.templateKey && !template) throw new AppError("VALIDATION_ERROR", "Unknown vehicle template");
  const hh = await db.household.findUniqueOrThrow({ where: { id: householdId } });
  const created = await db.$transaction(async (tx) => {
    const v = await tx.vehicle.create({
      data: {
        householdId,
        nickname: input.nickname || `${input.year} ${input.make} ${input.model}`,
        make: input.make,
        model: input.model,
        year: input.year,
        trim: input.trim ?? null,
        generation: input.generation ?? null,
        engineType: input.engineType ?? null,
        engineDisplacementL: input.engineDisplacementL ?? null,
        engineCode: input.engineCode ?? null,
        fuelType: input.fuelType,
        transmission: input.transmission ?? null,
        drivetrain: input.drivetrain ?? null,
        vin: input.vin ?? null,
        registrationNumber: input.registrationNumber ?? null,
        colour: input.colour ?? null,
        bodyType: input.bodyType ?? null,
        market: input.market ?? null,
        purchaseDate: input.purchaseDate ? isoToDate(input.purchaseDate) : null,
        purchasePrice: input.purchasePrice ?? null,
        purchaseOdometerKm: input.purchaseOdometerKm ?? null,
        ownershipStatus: input.ownershipStatus,
        currency: input.currency ?? hh.currency ?? actor.prefs.currency,
        insuranceProvider: input.insuranceProvider ?? null,
        insurancePolicyNumber: input.insurancePolicyNumber ?? null,
        insuranceRenewalDate: input.insuranceRenewalDate ? isoToDate(input.insuranceRenewalDate) : null,
        registrationExpiryDate: input.registrationExpiryDate ? isoToDate(input.registrationExpiryDate) : null,
        nextInspectionDate: input.nextInspectionDate ? isoToDate(input.nextInspectionDate) : null,
        notes: input.notes ?? null,
        templateKey: template?.key ?? null,
        createdById: actor.id,
      },
    });
    // Spec fields typed by the user are confirmed; never overwritten by later VIN decoding.
    const confirmed = SPEC_FIELDS.filter((f) => (input as any)[f] !== undefined && (input as any)[f] !== null && (input as any)[f] !== "");
    await tx.vehicleSpecification.create({ data: { vehicleId: v.id, confirmedFields: confirmed as unknown as string[] } });
    await tx.vehicleAccess.create({ data: { vehicleId: v.id, userId: actor.id, level: "OWNER", canViewFinancials: true } });
    if (input.purchaseDate) {
      await tx.vehicleOwnership.create({ data: { vehicleId: v.id, ownerName: actor.name, fromDate: isoToDate(input.purchaseDate), fromOdometerKm: input.purchaseOdometerKm ?? null } });
    }
    const today = todayInTz(actor.prefs.timezone);
    if (input.purchaseOdometerKm != null && input.purchaseDate) {
      await recordReading(tx, actor, v, { date: input.purchaseDate, valueKm: input.purchaseOdometerKm, source: "PURCHASE", note: "Odometer at purchase" }, { skipRefresh: true });
    }
    if (input.currentOdometerKm != null) {
      await recordReading(tx, actor, v, { date: input.odometerDate ?? today, valueKm: input.currentOdometerKm, source: "MANUAL", note: "Initial reading", confirmCorrection: false }, { skipRefresh: true });
    }
    if (template) await applyTemplateSchedules(tx, actor, v.id, template.key);
    else if (input.applySuggestedSchedules) await applyLibrary(tx, actor, v.id);
    await audit(tx, actor, { entity: "Vehicle", entityId: v.id, action: "create", vehicleId: v.id, householdId, after: { make: v.make, model: v.model, year: v.year } });
    return v;
  });
  return { id: created.id };
}

export async function updateVehicle(actor: Actor, vehicleId: string, input: z.infer<typeof vehicleUpdateSchema>) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "editVehicle");
  if (input.vin && input.vin !== vehicle.vin) {
    const dup = await db.vehicle.findFirst({ where: { householdId: vehicle.householdId, vin: input.vin, deletedAt: null, id: { not: vehicle.id } } });
    if (dup) throw new AppError("CONFLICT", "Another vehicle in this household already uses this VIN");
  }
  if (input.photoDocumentId) {
    const doc = await db.document.findFirst({ where: { id: input.photoDocumentId, householdId: vehicle.householdId, deletedAt: null } });
    if (!doc) throw new AppError("VALIDATION_ERROR", "Unknown photo document");
  }
  const data: Prisma.VehicleUpdateInput = {};
  const dateFields = ["purchaseDate", "insuranceRenewalDate", "registrationExpiryDate", "nextInspectionDate"];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    (data as any)[k] = dateFields.includes(k) ? (v ? isoToDate(v as string) : null) : v;
  }
  const changedSpec = SPEC_FIELDS.filter((f) => (input as any)[f] !== undefined);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.vehicle.update({ where: { id: vehicleId }, data });
    if (changedSpec.length) {
      const spec = await tx.vehicleSpecification.upsert({ where: { vehicleId }, create: { vehicleId, confirmedFields: [] }, update: {} });
      await tx.vehicleSpecification.update({ where: { vehicleId }, data: { confirmedFields: [...new Set([...spec.confirmedFields, ...changedSpec])] } });
    }
    await audit(tx, actor, { entity: "Vehicle", entityId: vehicleId, action: "update", vehicleId, householdId: vehicle.householdId, before: vehicle, after: u });
    return u;
  });
  return { id: updated.id };
}

export async function deleteVehicle(actor: Actor, vehicleId: string) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "delete");
  await db.vehicle.update({ where: { id: vehicleId }, data: { deletedAt: new Date() } });
  await audit(null, actor, { entity: "Vehicle", entityId: vehicleId, action: "delete", vehicleId, householdId: vehicle.householdId, before: { make: vehicle.make, model: vehicle.model, year: vehicle.year } });
  return { ok: true };
}

export async function setVehicleAccess(actor: Actor, vehicleId: string, input: z.infer<typeof vehicleAccessSchema>) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "manageAccess");
  const member = await db.householdMember.findUnique({ where: { householdId_userId: { householdId: vehicle.householdId, userId: input.userId } } });
  if (!member) throw new AppError("VALIDATION_ERROR", "That person is not a member of this household");
  const defaultFin = input.level === "OWNER" || input.level === "CO_OWNER";
  const existing = await db.vehicleAccess.findUnique({ where: { vehicleId_userId: { vehicleId, userId: input.userId } } });
  if (existing?.level === "OWNER" && input.level !== "OWNER") {
    const owners = await db.vehicleAccess.count({ where: { vehicleId, level: "OWNER" } });
    if (owners <= 1 && member.role !== "ADMIN") throw new AppError("CONFLICT", "A vehicle must keep at least one owner");
  }
  const row = await db.vehicleAccess.upsert({
    where: { vehicleId_userId: { vehicleId, userId: input.userId } },
    create: { vehicleId, userId: input.userId, level: input.level, canViewFinancials: input.canViewFinancials ?? defaultFin },
    update: { level: input.level, canViewFinancials: input.canViewFinancials ?? defaultFin },
  });
  await audit(null, actor, { entity: "VehicleAccess", entityId: row.id, action: existing ? "update" : "grant", vehicleId, householdId: vehicle.householdId, before: existing, after: row });
  return { id: row.id };
}

export async function removeVehicleAccess(actor: Actor, vehicleId: string, userId: string) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "manageAccess");
  const existing = await db.vehicleAccess.findUnique({ where: { vehicleId_userId: { vehicleId, userId } } });
  if (!existing) throw notFound("Access grant");
  if (existing.level === "OWNER") {
    const owners = await db.vehicleAccess.count({ where: { vehicleId, level: "OWNER" } });
    if (owners <= 1) throw new AppError("CONFLICT", "A vehicle must keep at least one owner");
  }
  await db.vehicleAccess.delete({ where: { id: existing.id } });
  await audit(null, actor, { entity: "VehicleAccess", entityId: existing.id, action: "revoke", vehicleId, householdId: vehicle.householdId, before: existing });
  return { ok: true };
}

export async function addOwnership(actor: Actor, vehicleId: string, input: z.infer<typeof ownershipSchema>) {
  await requireVehicle(actor, vehicleId, "editVehicle");
  const o = await db.vehicleOwnership.create({ data: { vehicleId, ownerName: input.ownerName, fromDate: isoToDate(input.fromDate), toDate: input.toDate ? isoToDate(input.toDate) : null, fromOdometerKm: input.fromOdometerKm ?? null, toOdometerKm: input.toOdometerKm ?? null, notes: input.notes ?? null } });
  return { id: o.id };
}

/** Unified activity timeline for a vehicle (records, repairs, readings, fuel, parts, documents, ownership). */
export async function vehicleTimeline(actor: Actor, vehicleId: string, limit = 40) {
  const { vehicle, fin } = await requireVehicle(actor, vehicleId, "view");
  const take = Math.min(100, limit);
  const [records, issues, odo, fuel, docs, own, inspections] = await Promise.all([
    db.maintenanceRecord.findMany({ where: { vehicleId, deletedAt: null }, orderBy: { serviceDate: "desc" }, take }),
    db.repairIssue.findMany({ where: { vehicleId, deletedAt: null }, orderBy: { discoveredAt: "desc" }, take }),
    db.odometerEntry.findMany({ where: { vehicleId, deletedAt: null, maintenanceRecordId: null, fuelEntryId: null }, orderBy: { date: "desc" }, take }),
    db.fuelEntry.findMany({ where: { vehicleId, deletedAt: null }, orderBy: { date: "desc" }, take }),
    db.document.findMany({ where: { vehicleId, deletedAt: null, category: { notIn: ["VEHICLE_PHOTO", "PART_PHOTO", "ISSUE_PHOTO", "INSPECTION_PHOTO"] } }, orderBy: { createdAt: "desc" }, take }),
    db.vehicleOwnership.findMany({ where: { vehicleId }, take }),
    db.inspection.findMany({ where: { vehicleId, deletedAt: null }, orderBy: { date: "desc" }, take }),
  ]);
  type Ev = { id: string; date: string; type: string; title: string; detail?: string | null; km?: number | null; amount?: number | null; link?: string };
  const ev: Ev[] = [];
  for (const r of records) ev.push({ id: r.id, date: iso(r.serviceDate) as string, type: r.kind === "REPAIR" ? "repair" : "maintenance", title: r.title, detail: r.status === "COMPLETED" ? null : r.status.toLowerCase().replace("_", " "), km: num(r.odometerKm), amount: fin ? num(r.totalCost) : null, link: `/service-history?record=${r.id}` });
  for (const i of issues) ev.push({ id: i.id, date: iso(i.discoveredAt) as string, type: "issue", title: `Issue: ${i.title}`, detail: i.status.toLowerCase().replace("_", " "), km: num(i.odometerKm), link: `/repairs?issue=${i.id}` });
  for (const o of odo) ev.push({ id: o.id, date: iso(o.date) as string, type: "odometer", title: "Odometer reading", detail: o.source.toLowerCase(), km: Number(o.valueKm) });
  for (const f of fuel) ev.push({ id: f.id, date: iso(f.date) as string, type: "fuel", title: "Fuel fill-up", detail: f.station, km: Number(f.odometerKm), amount: fin ? Number(f.totalCost) : null });
  for (const d of docs) ev.push({ id: d.id, date: dateToIso(d.createdAt) as string, type: "document", title: d.title, detail: d.category.toLowerCase().replace(/_/g, " "), link: `/documents?doc=${d.id}` });
  for (const o of own) ev.push({ id: o.id, date: iso(o.fromDate) as string, type: "ownership", title: `Ownership: ${o.ownerName}`, detail: o.toDate ? `until ${iso(o.toDate)}` : "current owner" });
  for (const i of inspections) ev.push({ id: i.id, date: iso(i.date) as string, type: "inspection", title: `${i.type.toLowerCase().replace("_", " ")} inspection`, detail: i.overallCondition, km: num(i.odometerKm) });
  if (vehicle.purchaseDate) ev.push({ id: "purchase", date: iso(vehicle.purchaseDate) as string, type: "ownership", title: "Vehicle purchased", detail: null, amount: fin ? num(vehicle.purchasePrice) : null });
  ev.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return ev.slice(0, take);
}

export async function summarizeVinCheck(vin: string) {
  return checkVin(vin);
}
