import type { Prisma, Vehicle } from "@prisma/client";
import { db, type Db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { addMonths, dateToIso, isoToDate, todayInTz } from "@/lib/dates";
import { computeTotal, fromCents, toCents } from "@/lib/money";
import { recordCreateSchema, recordUpdateSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { canTransitionRecord } from "../engine/status";
import { num, iso, ts } from "../serialize";
import { accessibleVehicles, requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { recordReading, syncVehicleOdometer } from "./odometer";
import { refreshVehicleSchedules } from "./schedules";
import { slugify } from "../reference/library";

type CreateInput = z.infer<typeof recordCreateSchema>;
type UpdateInput = z.infer<typeof recordUpdateSchema>;
type ItemInput = CreateInput["items"][number];

// ───────────────── helpers

async function resolveProvider(client: Db, householdId: string, providerId?: string | null, providerName?: string | null) {
  if (providerId) {
    const p = await client.serviceProvider.findFirst({ where: { id: providerId, householdId, deletedAt: null } });
    if (!p) throw new AppError("VALIDATION_ERROR", "Unknown service provider");
    return p;
  }
  if (providerName) {
    const existing = await client.serviceProvider.findUnique({ where: { householdId_name: { householdId, name: providerName } } });
    if (existing) return existing.deletedAt ? client.serviceProvider.update({ where: { id: existing.id }, data: { deletedAt: null } }) : existing;
    return client.serviceProvider.create({ data: { householdId, name: providerName } });
  }
  return null;
}

async function validateItemRefs(client: Db, vehicleId: string, items: ItemInput[]) {
  const ids = items.map((i) => i.assignmentId).filter(Boolean) as string[];
  if (ids.length) {
    const found = await client.maintenanceScheduleAssignment.count({ where: { id: { in: ids }, vehicleId, deletedAt: null } });
    if (found !== new Set(ids).size) throw new AppError("VALIDATION_ERROR", "A service item refers to a schedule that does not belong to this vehicle");
  }
  const cats = items.map((i) => i.categoryId).filter(Boolean) as string[];
  if (cats.length) {
    const found = await client.maintenanceCategory.count({ where: { id: { in: cats } } });
    if (found !== new Set(cats).size) throw new AppError("VALIDATION_ERROR", "Unknown maintenance category");
  }
}

export function computeRecordCosts(p: { partsCost?: number | null; laborCost?: number | null; tax?: number | null; discount?: number | null; items: Pick<ItemInput, "quantity" | "unitCost" | "laborCost">[] }) {
  const itemParts = fromCents(p.items.reduce((a, i) => a + Math.round(toCents(i.unitCost) * i.quantity), 0));
  const itemLabor = fromCents(p.items.reduce((a, i) => a + toCents(i.laborCost), 0));
  const partsCost = p.partsCost ?? itemParts;
  const laborCost = p.laborCost ?? itemLabor;
  const tax = p.tax ?? 0;
  const discount = p.discount ?? 0;
  return { partsCost, laborCost, tax, discount, totalCost: computeTotal({ partsCost, laborCost, tax, discount }) };
}

async function findDuplicate(client: Db, vehicleId: string, kind: string, serviceDate: string, title: string, odometerKm: number | null | undefined, excludeId?: string) {
  const rows = await client.maintenanceRecord.findMany({
    where: { vehicleId, kind: kind as any, serviceDate: isoToDate(serviceDate), deletedAt: null, status: { not: "CANCELLED" }, title: { equals: title, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, odometerKm: true },
  });
  return rows.find((r) => odometerKm == null || r.odometerKm === null || Number(r.odometerKm) === odometerKm) ?? null;
}

// ───────────────── parts installed through service items

export async function rebuildComponentChain(client: Db, vehicleId: string, componentKey: string) {
  const inst = await client.installedPart.findMany({ where: { vehicleId, componentKey }, include: { part: true }, orderBy: [{ installedAt: "asc" }, { createdAt: "asc" }] });
  for (let i = 0; i < inst.length; i++) {
    const cur = inst[i];
    const next = inst[i + 1];
    if (next) {
      await client.installedPart.update({ where: { id: cur.id }, data: { removedAt: next.installedAt, removedKm: next.installedKm, removalRecordId: next.installRecordId, removalReason: cur.removalReason ?? "Replaced" } });
      if (cur.part.status !== "REPLACED") await client.part.update({ where: { id: cur.partId }, data: { status: "REPLACED" } });
    } else {
      const manual = cur.part.status === "REMOVED" || cur.part.status === "RETURNED";
      if (!manual) {
        await client.installedPart.update({ where: { id: cur.id }, data: { removedAt: null, removedKm: null, removalRecordId: null, removalReason: null } });
        if (cur.part.status === "REPLACED" || cur.part.status === "IN_STORAGE") await client.part.update({ where: { id: cur.partId }, data: { status: "INSTALLED" } });
      }
    }
  }
}

async function installTrackedParts(tx: Db, vehicle: Vehicle, record: { id: string; serviceDate: Date; odometerKm: Prisma.Decimal | null }, items: Prisma.MaintenanceRecordItemGetPayload<{ include: { assignment: true } }>[]) {
  const touched = new Set<string>();
  for (const it of items) {
    if (!it.trackAsPart || !it.completed || !it.partName) continue;
    const componentKey = it.componentKey ?? it.assignment?.componentKey ?? slugify(it.name);
    const serviceIso = dateToIso(record.serviceDate) as string;
    const part = await tx.part.create({
      data: {
        vehicleId: vehicle.id,
        name: it.partName,
        categoryId: it.categoryId ?? it.assignment?.categoryId ?? null,
        componentKey,
        manufacturer: it.partManufacturer,
        origin: it.partOrigin ?? "UNKNOWN",
        partNumber: it.partNumber,
        purchaseDate: record.serviceDate,
        purchasePrice: fromCents(Math.round(toCents(Number(it.unitCost)) * Number(it.quantity))),
        currency: vehicle.currency,
        warrantyStart: it.warrantyMonths ? record.serviceDate : null,
        warrantyEnd: it.warrantyMonths ? isoToDate(addMonths(serviceIso, it.warrantyMonths)) : null,
        status: "INSTALLED",
      },
    });
    await tx.installedPart.create({
      data: { vehicleId: vehicle.id, partId: part.id, componentKey, installedAt: record.serviceDate, installedKm: record.odometerKm, installLaborCost: it.laborCost, installRecordId: record.id },
    });
    touched.add(componentKey);
  }
  for (const k of touched) await rebuildComponentChain(tx, vehicle.id, k);
}

async function rollbackTrackedParts(tx: Db, vehicleId: string, recordId: string) {
  const inst = await tx.installedPart.findMany({ where: { installRecordId: recordId } });
  const comps = new Set(inst.map((i) => i.componentKey));
  for (const i of inst) {
    await tx.installedPart.delete({ where: { id: i.id } });
    const left = await tx.installedPart.count({ where: { partId: i.partId } });
    if (left === 0) await tx.part.update({ where: { id: i.partId }, data: { deletedAt: new Date() } });
  }
  await tx.installedPart.updateMany({ where: { removalRecordId: recordId }, data: { removalRecordId: null } });
  for (const k of comps) await rebuildComponentChain(tx, vehicleId, k);
}

// ───────────────── derived data (odometer, expense, parts, schedules)

async function applyDerived(tx: Db, actor: Actor, vehicle: Vehicle, recordId: string, confirmCorrection: boolean) {
  const rec = await tx.maintenanceRecord.findUniqueOrThrow({ where: { id: recordId }, include: { items: { include: { assignment: true }, orderBy: { sortOrder: "asc" } }, provider: true } });
  if (rec.status === "COMPLETED") {
    if (rec.odometerKm !== null) {
      await recordReading(tx, actor, vehicle, { date: dateToIso(rec.serviceDate) as string, valueKm: Number(rec.odometerKm), source: rec.kind === "REPAIR" ? "REPAIR" : "MAINTENANCE", note: rec.title, maintenanceRecordId: rec.id, confirmCorrection }, { skipRefresh: true });
    }
    const total = Number(rec.totalCost);
    const existing = await tx.expense.findFirst({ where: { maintenanceRecordId: rec.id } });
    if (total > 0) {
      const data = {
        vehicleId: vehicle.id,
        date: rec.serviceDate,
        amount: total,
        tax: rec.tax,
        currency: rec.currency,
        category: rec.kind === "REPAIR" ? ("REPAIRS" as const) : ("MAINTENANCE" as const),
        vendor: rec.provider?.name ?? rec.mechanicName ?? (rec.workPerformedBy === "OWNER_DIY" ? "DIY" : null),
        providerId: rec.providerId,
        description: rec.title,
        maintenanceRecordId: rec.id,
        repairIssueId: rec.repairIssueId,
        deletedAt: null,
      };
      if (existing) await tx.expense.update({ where: { id: existing.id }, data });
      else await tx.expense.create({ data: { ...data, createdById: actor.id } });
    } else if (existing) {
      await tx.expense.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    }
    await installTrackedParts(tx, vehicle, rec, rec.items);
    // Reminders for the completed schedules are now actioned
    const aIds = rec.items.filter((i) => i.completed && i.assignmentId).map((i) => i.assignmentId as string);
    if (aIds.length) {
      await tx.notification.updateMany({ where: { vehicleId: vehicle.id, actionedAt: null, OR: aIds.map((id) => ({ dedupeKey: { startsWith: `maint:${id}:` } })) }, data: { actionedAt: new Date(), readAt: new Date() } });
    }
  } else {
    await tx.expense.updateMany({ where: { maintenanceRecordId: rec.id, deletedAt: null }, data: { deletedAt: new Date() } });
  }
  await syncVehicleOdometer(tx, vehicle.id);
  await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
}

async function rollbackDerived(tx: Db, vehicleId: string, recordId: string) {
  await tx.odometerEntry.updateMany({ where: { maintenanceRecordId: recordId, deletedAt: null }, data: { deletedAt: new Date() } });
  await rollbackTrackedParts(tx, vehicleId, recordId);
}

// ───────────────── CRUD

const itemData = (recordId: string, i: ItemInput, idx: number): Prisma.MaintenanceRecordItemCreateManyInput => ({
  recordId,
  assignmentId: i.assignmentId ?? null,
  categoryId: i.categoryId ?? null,
  componentKey: i.componentKey ?? null,
  name: i.name,
  description: i.description ?? null,
  completed: i.completed,
  partName: i.partName ?? null,
  partManufacturer: i.partManufacturer ?? null,
  partNumber: i.partNumber ?? null,
  partOrigin: i.partOrigin ?? null,
  quantity: i.quantity,
  unitCost: i.unitCost,
  laborCost: i.laborCost,
  trackAsPart: i.trackAsPart,
  warrantyMonths: i.warrantyMonths ?? null,
  sortOrder: idx,
});

export async function createRecord(actor: Actor, input: CreateInput) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (input.idempotencyKey) {
    const dup = await db.maintenanceRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) {
      if (dup.vehicleId !== vehicle.id) throw new AppError("CONFLICT", "Idempotency key already used");
      return { id: dup.id, idempotentReplay: true };
    }
  }
  const id = await db.$transaction((tx) => createRecordInTx(tx, actor, vehicle, input));
  return { id, idempotentReplay: false };
}

/** Creates a record plus all derived data (odometer, expense, parts, schedule refresh) inside the caller's transaction. */
export async function createRecordInTx(tx: Db, actor: Actor, vehicle: Vehicle, input: CreateInput): Promise<string> {
  if (input.repairIssueId) {
    const issue = await tx.repairIssue.findFirst({ where: { id: input.repairIssueId, vehicleId: vehicle.id, deletedAt: null } });
    if (!issue) throw new AppError("VALIDATION_ERROR", "Unknown repair issue for this vehicle");
  }
  const provider = await resolveProvider(tx, vehicle.householdId, input.providerId, input.providerName);
  await validateItemRefs(tx, vehicle.id, input.items);
  if (!input.allowDuplicate) {
    const dup = await findDuplicate(tx, vehicle.id, input.kind, input.serviceDate, input.title, input.odometerKm);
    if (dup) throw new AppError("DUPLICATE_RECORD", "A record with the same title, date and odometer already exists for this vehicle.", { existingId: dup.id });
  }
  const costs = computeRecordCosts({ ...input, items: input.items });
  const rec = await tx.maintenanceRecord.create({
    data: {
      vehicleId: vehicle.id,
      kind: input.kind,
      status: input.status,
      title: input.title,
      description: input.description ?? null,
      serviceDate: isoToDate(input.serviceDate),
      odometerKm: input.odometerKm ?? null,
      workPerformedBy: input.workPerformedBy,
      providerId: provider?.id ?? null,
      mechanicName: input.mechanicName ?? null,
      location: input.location ?? null,
      ...costs,
      currency: input.currency ?? vehicle.currency,
      warrantyInfo: input.warrantyInfo ?? null,
      notes: input.notes ?? null,
      repairIssueId: input.repairIssueId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdById: actor.id,
    },
  });
  if (input.items.length) await tx.maintenanceRecordItem.createMany({ data: input.items.map((i, idx) => itemData(rec.id, i, idx)) });
  await applyDerived(tx, actor, vehicle, rec.id, input.confirmOdometerCorrection);
  await audit(tx, actor, { entity: "MaintenanceRecord", entityId: rec.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { title: rec.title, status: rec.status, serviceDate: input.serviceDate, totalCost: costs.totalCost } });
  return rec.id;
}

export async function updateRecord(actor: Actor, recordId: string, input: UpdateInput & { confirmOdometerCorrection?: boolean }) {
  const rec = await db.maintenanceRecord.findFirst({ where: { id: recordId, deletedAt: null }, include: { items: true } });
  if (!rec) throw notFound("Record");
  const { vehicle } = await requireVehicle(actor, rec.vehicleId, "write");
  if (input.status && !canTransitionRecord(rec.status, input.status)) throw new AppError("CONFLICT", `A ${rec.status.toLowerCase().replace("_", " ")} record cannot move to ${input.status.toLowerCase().replace("_", " ")}`);
  await db.$transaction(async (tx) => {
    const provider = input.providerId !== undefined || input.providerName !== undefined ? await resolveProvider(tx, vehicle.householdId, input.providerId, input.providerName) : undefined;
    const items = input.items;
    if (items) await validateItemRefs(tx, vehicle.id, items);
    const title = input.title ?? rec.title;
    const date = input.serviceDate ?? (dateToIso(rec.serviceDate) as string);
    const odo = input.odometerKm !== undefined ? input.odometerKm : num(rec.odometerKm);
    if (!input.allowDuplicate) {
      const dup = await findDuplicate(tx, vehicle.id, rec.kind, date, title, odo, rec.id);
      if (dup) throw new AppError("DUPLICATE_RECORD", "Another record with the same title, date and odometer already exists.", { existingId: dup.id });
    }
    await rollbackDerived(tx, vehicle.id, rec.id);
    let costs: Record<string, number> = {};
    const costTouched = ["partsCost", "laborCost", "tax", "discount"].some((k) => (input as any)[k] !== undefined) || items;
    if (costTouched) {
      const effItems = items ?? rec.items.map((i) => ({ quantity: Number(i.quantity), unitCost: Number(i.unitCost), laborCost: Number(i.laborCost) }));
      costs = computeRecordCosts({
        partsCost: input.partsCost !== undefined ? input.partsCost : items ? null : num(rec.partsCost),
        laborCost: input.laborCost !== undefined ? input.laborCost : items ? null : num(rec.laborCost),
        tax: input.tax !== undefined ? input.tax : num(rec.tax),
        discount: input.discount !== undefined ? input.discount : num(rec.discount),
        items: effItems,
      });
    }
    await tx.maintenanceRecord.update({
      where: { id: rec.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        serviceDate: isoToDate(date),
        odometerKm: odo,
        ...(input.workPerformedBy ? { workPerformedBy: input.workPerformedBy } : {}),
        ...(provider !== undefined ? { providerId: provider?.id ?? null } : {}),
        ...(input.mechanicName !== undefined ? { mechanicName: input.mechanicName } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...costs,
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.warrantyInfo !== undefined ? { warrantyInfo: input.warrantyInfo } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    if (items) {
      await tx.maintenanceRecordItem.deleteMany({ where: { recordId: rec.id } });
      if (items.length) await tx.maintenanceRecordItem.createMany({ data: items.map((i, idx) => itemData(rec.id, i, idx)) });
    }
    await applyDerived(tx, actor, vehicle, rec.id, !!input.confirmOdometerCorrection);
    await audit(tx, actor, { entity: "MaintenanceRecord", entityId: rec.id, action: "update", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { title: rec.title, status: rec.status, serviceDate: dateToIso(rec.serviceDate), totalCost: num(rec.totalCost) }, after: { title, status: input.status ?? rec.status, serviceDate: date, ...costs } });
  });
  return { id: rec.id };
}

export async function deleteRecord(actor: Actor, recordId: string) {
  const rec = await db.maintenanceRecord.findFirst({ where: { id: recordId, deletedAt: null } });
  if (!rec) throw notFound("Record");
  const { vehicle } = await requireVehicle(actor, rec.vehicleId, "write");
  await db.$transaction(async (tx) => {
    await rollbackDerived(tx, vehicle.id, rec.id);
    await tx.expense.updateMany({ where: { maintenanceRecordId: rec.id, deletedAt: null }, data: { deletedAt: new Date() } });
    await tx.maintenanceRecord.update({ where: { id: rec.id }, data: { deletedAt: new Date() } });
    await tx.document.updateMany({ where: { maintenanceRecordId: rec.id }, data: { maintenanceRecordId: null } });
    await syncVehicleOdometer(tx, vehicle.id);
    await refreshVehicleSchedules(tx, vehicle.id, todayInTz(actor.prefs.timezone));
    await audit(tx, actor, { entity: "MaintenanceRecord", entityId: rec.id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { title: rec.title, serviceDate: dateToIso(rec.serviceDate), totalCost: num(rec.totalCost) } });
  });
  return { ok: true };
}

// ───────────────── queries

const include = { items: { orderBy: { sortOrder: "asc" as const }, include: { assignment: { select: { id: true, name: true } }, category: { select: { name: true } } } }, provider: true, vehicle: { select: { id: true, nickname: true, make: true, model: true, year: true } }, documents: { where: { deletedAt: null }, select: { id: true, title: true, mimeType: true, category: true } } } satisfies Prisma.MaintenanceRecordInclude;
type RecordFull = Prisma.MaintenanceRecordGetPayload<{ include: typeof include }>;

export function recordView(r: RecordFull, fin: boolean) {
  const money = (n: Prisma.Decimal | number | null) => (fin ? num(n as any) : null);
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    vehicleName: r.vehicle.nickname || `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
    kind: r.kind,
    status: r.status,
    title: r.title,
    description: r.description,
    serviceDate: iso(r.serviceDate),
    odometerKm: num(r.odometerKm),
    workPerformedBy: r.workPerformedBy,
    providerId: r.providerId,
    providerName: r.provider?.name ?? null,
    mechanicName: r.mechanicName,
    location: r.location,
    laborCost: money(r.laborCost),
    partsCost: money(r.partsCost),
    tax: money(r.tax),
    discount: money(r.discount),
    totalCost: money(r.totalCost),
    currency: r.currency,
    warrantyInfo: r.warrantyInfo,
    notes: r.notes,
    repairIssueId: r.repairIssueId,
    createdAt: ts(r.createdAt),
    items: r.items.map((i) => ({
      id: i.id,
      assignmentId: i.assignmentId,
      assignmentName: i.assignment?.name ?? null,
      categoryId: i.categoryId,
      categoryName: i.category?.name ?? null,
      componentKey: i.componentKey,
      name: i.name,
      description: i.description,
      completed: i.completed,
      partName: i.partName,
      partManufacturer: i.partManufacturer,
      partNumber: i.partNumber,
      partOrigin: i.partOrigin,
      quantity: Number(i.quantity),
      unitCost: money(i.unitCost),
      laborCost: money(i.laborCost),
      trackAsPart: i.trackAsPart,
      warrantyMonths: i.warrantyMonths,
    })),
    documents: r.documents,
  };
}
export type RecordView = ReturnType<typeof recordView>;

export interface RecordQuery {
  vehicleId?: string;
  kind?: "MAINTENANCE" | "REPAIR";
  status?: string;
  q?: string;
  category?: string;
  from?: string;
  to?: string;
  minKm?: number;
  maxKm?: number;
  minCost?: number;
  maxCost?: number;
  providerId?: string;
  workPerformedBy?: string;
  sort?: "date_desc" | "date_asc" | "cost_desc" | "cost_asc" | "km_desc" | "km_asc";
  page?: number;
  pageSize?: number;
}

export async function listRecords(actor: Actor, q: RecordQuery) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const finIds = new Set(scope.filter((s) => s.fin).map((s) => s.vehicle.id));
  const ids = scope.map((s) => s.vehicle.id);
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
  const and: Prisma.MaintenanceRecordWhereInput[] = [];
  if (q.q) {
    const t = q.q.trim();
    and.push({ OR: [{ title: { contains: t, mode: "insensitive" } }, { description: { contains: t, mode: "insensitive" } }, { notes: { contains: t, mode: "insensitive" } }, { mechanicName: { contains: t, mode: "insensitive" } }, { provider: { name: { contains: t, mode: "insensitive" } } }, { items: { some: { OR: [{ name: { contains: t, mode: "insensitive" } }, { partName: { contains: t, mode: "insensitive" } }, { partNumber: { contains: t, mode: "insensitive" } }] } } }] });
  }
  if (q.category) and.push({ items: { some: { OR: [{ category: { key: q.category } }, { categoryId: q.category }, { assignment: { category: { key: q.category } } }] } } });
  // Cost filters only apply to vehicles where the actor may see costs
  const costFilter: Prisma.DecimalFilter = {};
  if (q.minCost !== undefined) costFilter.gte = q.minCost;
  if (q.maxCost !== undefined) costFilter.lte = q.maxCost;
  if (Object.keys(costFilter).length) and.push({ vehicleId: { in: [...finIds] }, totalCost: costFilter });
  const where: Prisma.MaintenanceRecordWhereInput = {
    vehicleId: { in: ids },
    deletedAt: null,
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.status ? { status: q.status as any } : {}),
    ...(q.providerId ? { providerId: q.providerId } : {}),
    ...(q.workPerformedBy ? { workPerformedBy: q.workPerformedBy as any } : {}),
    ...(q.from || q.to ? { serviceDate: { ...(q.from ? { gte: isoToDate(q.from) } : {}), ...(q.to ? { lte: isoToDate(q.to) } : {}) } } : {}),
    ...(q.minKm !== undefined || q.maxKm !== undefined ? { odometerKm: { ...(q.minKm !== undefined ? { gte: q.minKm } : {}), ...(q.maxKm !== undefined ? { lte: q.maxKm } : {}) } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
  const sortKey = q.sort ?? "date_desc";
  const orderBy: Prisma.MaintenanceRecordOrderByWithRelationInput[] =
    sortKey === "date_asc" ? [{ serviceDate: "asc" }, { createdAt: "asc" }] : sortKey === "cost_desc" ? [{ totalCost: "desc" }] : sortKey === "cost_asc" ? [{ totalCost: "asc" }] : sortKey === "km_desc" ? [{ odometerKm: { sort: "desc", nulls: "last" } }] : sortKey === "km_asc" ? [{ odometerKm: { sort: "asc", nulls: "last" } }] : [{ serviceDate: "desc" }, { createdAt: "desc" }];
  const [total, rows] = await Promise.all([db.maintenanceRecord.count({ where }), db.maintenanceRecord.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize })]);
  return { items: rows.map((r) => recordView(r, finIds.has(r.vehicleId))), page, pageSize, total };
}

export async function getRecord(actor: Actor, recordId: string) {
  const r = await db.maintenanceRecord.findFirst({ where: { id: recordId, deletedAt: null }, include });
  if (!r) throw notFound("Record");
  const { fin } = await requireVehicle(actor, r.vehicleId, "view");
  return recordView(r, fin);
}

const BUNDLES: string[][] = [["engine_oil", "oil_filter"]];

/** Pre-populates a service form from a schedule/reminder so the user only confirms and adjusts. */
export async function prefillFromAssignment(actor: Actor, assignmentId: string) {
  const a = await db.maintenanceScheduleAssignment.findFirst({ where: { id: assignmentId, deletedAt: null }, include: { category: true } });
  if (!a) throw notFound("Schedule");
  const { vehicle, fin } = await requireVehicle(actor, a.vehicleId, "write");
  const bundleKeys = BUNDLES.find((b) => b.includes(a.componentKey)) ?? [a.componentKey];
  const related = await db.maintenanceScheduleAssignment.findMany({ where: { vehicleId: vehicle.id, deletedAt: null, enabled: true, componentKey: { in: bundleKeys } }, include: { category: true } });
  const chosen = related.length ? related : [a];
  return {
    vehicleId: vehicle.id,
    title: a.name,
    serviceDate: todayInTz(actor.prefs.timezone),
    odometerKm: num(vehicle.currentOdometerKm),
    currency: vehicle.currency,
    estimatedCost: fin ? { min: num(a.estCostMin), max: num(a.estCostMax) } : null,
    items: chosen.map((x) => ({ assignmentId: x.id, categoryId: x.categoryId, componentKey: x.componentKey, name: x.name, completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false })),
    note: chosen.length > 1 ? "Related items from the same service were pre-selected - untick anything you did not do." : undefined,
  };
}

/** Vehicles' completed records for analytics */
export async function costByComponent(actor: Actor, vehicleId?: string) {
  const scope = (await accessibleVehicles(actor, "viewFinancials", vehicleId && vehicleId !== "all" ? { vehicleId } : {})).map((s) => s.vehicle.id);
  const recs = await db.maintenanceRecord.findMany({ where: { vehicleId: { in: scope }, deletedAt: null, status: "COMPLETED" }, include: { items: { include: { category: true } }, repairIssue: true } });
  const m = new Map<string, { component: string; total: number; count: number; kind: string }>();
  for (const r of recs) {
    const key = r.repairIssue?.componentKey ?? r.items.find((i) => i.componentKey)?.componentKey ?? r.items[0]?.category?.name ?? r.title;
    const k = `${r.kind}:${key}`;
    const cur = m.get(k) ?? { component: key, total: 0, count: 0, kind: r.kind };
    cur.total = fromCents(toCents(cur.total) + toCents(Number(r.totalCost)));
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
