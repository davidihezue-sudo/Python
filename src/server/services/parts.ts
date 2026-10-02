import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { diffDays, isoToDate, todayInTz } from "@/lib/dates";
import { partSchema, partUpdateSchema, replacePartSchema, warrantySchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { slugify } from "../reference/library";
import { num, iso } from "../serialize";
import { requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { rebuildComponentChain } from "./records";

const include = { installations: { orderBy: { installedAt: "desc" as const } }, category: { select: { name: true } }, documents: { where: { deletedAt: null }, select: { id: true, title: true, mimeType: true, category: true } }, vehicle: { select: { id: true, nickname: true, make: true, model: true, year: true } } } satisfies Prisma.PartInclude;
type PartFull = Prisma.PartGetPayload<{ include: typeof include }>;

export function partView(p: PartFull, fin: boolean, today: string) {
  const open = p.installations.find((i) => !i.removedAt) ?? null;
  const warrantyDays = p.warrantyEnd ? diffDays(iso(p.warrantyEnd) as string, today) : null;
  return {
    id: p.id,
    vehicleId: p.vehicleId,
    vehicleName: p.vehicle.nickname || `${p.vehicle.year} ${p.vehicle.make} ${p.vehicle.model}`,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    componentKey: p.componentKey,
    manufacturer: p.manufacturer,
    origin: p.origin,
    partNumber: p.partNumber,
    supplier: p.supplier,
    purchaseDate: iso(p.purchaseDate),
    purchasePrice: fin ? num(p.purchasePrice) : null,
    currency: p.currency,
    warrantyStart: iso(p.warrantyStart),
    warrantyEnd: iso(p.warrantyEnd),
    warrantyStatus: warrantyDays === null ? null : warrantyDays < 0 ? "expired" : warrantyDays <= 60 ? "expiring" : "active",
    warrantyDaysRemaining: warrantyDays,
    expectedLifeKm: num(p.expectedLifeKm),
    expectedLifeMonths: p.expectedLifeMonths,
    status: p.status,
    notes: p.notes,
    installedAt: iso(open?.installedAt),
    installedKm: num(open?.installedKm),
    installations: p.installations.map((i) => ({ id: i.id, installedAt: iso(i.installedAt), installedKm: num(i.installedKm), removedAt: iso(i.removedAt), removedKm: num(i.removedKm), removalReason: i.removalReason, installLaborCost: fin ? num(i.installLaborCost) : null, installRecordId: i.installRecordId, removalRecordId: i.removalRecordId })),
    documents: p.documents,
  };
}
export type PartView = ReturnType<typeof partView>;

export async function createPart(actor: Actor, input: z.infer<typeof partSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  const componentKey = input.componentKey ?? slugify(input.name);
  const id = await db.$transaction(async (tx) => {
    const installed = input.status === "INSTALLED" || input.status === "UNDER_WARRANTY";
    const part = await tx.part.create({
      data: {
        vehicleId: vehicle.id,
        name: input.name,
        categoryId: input.categoryId ?? null,
        componentKey,
        manufacturer: input.manufacturer ?? null,
        origin: input.origin,
        partNumber: input.partNumber ?? null,
        supplier: input.supplier ?? null,
        purchaseDate: input.purchaseDate ? isoToDate(input.purchaseDate) : null,
        purchasePrice: input.purchasePrice ?? null,
        currency: input.currency ?? vehicle.currency,
        warrantyStart: input.warrantyStart ? isoToDate(input.warrantyStart) : null,
        warrantyEnd: input.warrantyEnd ? isoToDate(input.warrantyEnd) : null,
        expectedLifeKm: input.expectedLifeKm ?? null,
        expectedLifeMonths: input.expectedLifeMonths ?? null,
        status: input.status,
        notes: input.notes ?? null,
      },
    });
    if (installed && input.installedAt) {
      await tx.installedPart.create({ data: { vehicleId: vehicle.id, partId: part.id, componentKey, installedAt: isoToDate(input.installedAt), installedKm: input.installedKm ?? null, installLaborCost: input.installLaborCost ?? null } });
      await rebuildComponentChain(tx, vehicle.id, componentKey);
    }
    await audit(tx, actor, { entity: "Part", entityId: part.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { name: part.name, status: part.status } });
    return part.id;
  });
  return { id };
}

export async function updatePart(actor: Actor, partId: string, input: z.infer<typeof partUpdateSchema>) {
  const p = await db.part.findFirst({ where: { id: partId, deletedAt: null } });
  if (!p) throw notFound("Part");
  const { vehicle } = await requireVehicle(actor, p.vehicleId, "write");
  const data: Prisma.PartUpdateInput = {};
  const dates = ["purchaseDate", "warrantyStart", "warrantyEnd"];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || ["installedAt", "installedKm", "installLaborCost", "categoryId"].includes(k)) continue;
    (data as any)[k] = dates.includes(k) ? (v ? isoToDate(v as string) : null) : v;
  }
  if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  await db.$transaction(async (tx) => {
    await tx.part.update({ where: { id: p.id }, data });
    // Manual removal: close the open installation period at the supplied date/odometer
    if (input.status && ["REMOVED", "RETURNED"].includes(input.status)) {
      const open = await tx.installedPart.findFirst({ where: { partId: p.id, removedAt: null } });
      if (open) await tx.installedPart.update({ where: { id: open.id }, data: { removedAt: isoToDate(input.installedAt ?? todayInTz(actor.prefs.timezone)), removedKm: input.installedKm ?? null, removalReason: input.status === "RETURNED" ? "Returned" : "Removed" } });
    }
    await audit(tx, actor, { entity: "Part", entityId: p.id, action: "update", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { status: p.status }, after: { status: input.status ?? p.status } });
  });
  return { id: p.id };
}

export async function deletePart(actor: Actor, partId: string) {
  const p = await db.part.findFirst({ where: { id: partId, deletedAt: null } });
  if (!p) throw notFound("Part");
  const { vehicle } = await requireVehicle(actor, p.vehicleId, "write");
  await db.$transaction(async (tx) => {
    await tx.part.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, { entity: "Part", entityId: p.id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { name: p.name } });
  });
  return { ok: true };
}

export async function listParts(actor: Actor, q: { vehicleId?: string; status?: string; component?: string; q?: string; page?: number; pageSize?: number }) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const fin = new Set(scope.filter((s) => s.fin).map((s) => s.vehicle.id));
  const where: Prisma.PartWhereInput = {
    vehicleId: { in: scope.map((s) => s.vehicle.id) },
    deletedAt: null,
    ...(q.status ? { status: q.status as any } : {}),
    ...(q.component ? { componentKey: q.component } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { manufacturer: { contains: q.q, mode: "insensitive" } }, { partNumber: { contains: q.q, mode: "insensitive" } }, { supplier: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, q.pageSize ?? 50);
  const today = todayInTz(actor.prefs.timezone);
  const [total, rows] = await Promise.all([db.part.count({ where }), db.part.findMany({ where, include, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  return { items: rows.map((r) => partView(r, fin.has(r.vehicleId), today)), page, pageSize, total };
}

export async function getPart(actor: Actor, partId: string) {
  const p = await db.part.findFirst({ where: { id: partId, deletedAt: null }, include });
  if (!p) throw notFound("Part");
  const { fin } = await requireVehicle(actor, p.vehicleId, "view");
  return partView(p, fin, todayInTz(actor.prefs.timezone));
}

/**
 * Replace a component: closes the previous installation period (new install date/odometer become its removal point),
 * creates the new installation, and optionally links to the service record that did the work.
 */
export async function replaceComponent(actor: Actor, input: z.infer<typeof replacePartSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (!input.existingPartId && !input.part) throw new AppError("VALIDATION_ERROR", "Provide a new part or choose a part from storage");
  if (input.maintenanceRecordId) {
    const r = await db.maintenanceRecord.findFirst({ where: { id: input.maintenanceRecordId, vehicleId: vehicle.id, deletedAt: null } });
    if (!r) throw new AppError("VALIDATION_ERROR", "Unknown service record for this vehicle");
  }
  const result = await db.$transaction(async (tx) => {
    let partId = input.existingPartId ?? null;
    if (partId) {
      const existing = await tx.part.findFirst({ where: { id: partId, vehicleId: vehicle.id, deletedAt: null } });
      if (!existing) throw notFound("Part");
      await tx.part.update({ where: { id: partId }, data: { status: "INSTALLED", componentKey: input.componentKey } });
    } else {
      const p = input.part!;
      const created = await tx.part.create({
        data: {
          vehicleId: vehicle.id,
          name: p.name,
          categoryId: p.categoryId ?? null,
          componentKey: input.componentKey,
          manufacturer: p.manufacturer ?? null,
          origin: p.origin,
          partNumber: p.partNumber ?? null,
          supplier: p.supplier ?? null,
          purchaseDate: p.purchaseDate ? isoToDate(p.purchaseDate) : null,
          purchasePrice: p.purchasePrice ?? null,
          currency: p.currency ?? vehicle.currency,
          warrantyStart: p.warrantyStart ? isoToDate(p.warrantyStart) : null,
          warrantyEnd: p.warrantyEnd ? isoToDate(p.warrantyEnd) : null,
          expectedLifeKm: p.expectedLifeKm ?? null,
          expectedLifeMonths: p.expectedLifeMonths ?? null,
          notes: p.notes ?? null,
          status: "INSTALLED",
        },
      });
      partId = created.id;
    }
    const inst = await tx.installedPart.create({
      data: { vehicleId: vehicle.id, partId, componentKey: input.componentKey, installedAt: isoToDate(input.installedAt), installedKm: input.installedKm ?? null, installLaborCost: input.installLaborCost ?? null, installRecordId: input.maintenanceRecordId ?? null },
    });
    await rebuildComponentChain(tx, vehicle.id, input.componentKey);
    if (input.removalReason) {
      const prev = await tx.installedPart.findFirst({ where: { vehicleId: vehicle.id, componentKey: input.componentKey, installedAt: { lt: isoToDate(input.installedAt) } }, orderBy: { installedAt: "desc" } });
      if (prev) await tx.installedPart.update({ where: { id: prev.id }, data: { removalReason: input.removalReason } });
    }
    await audit(tx, actor, { entity: "InstalledPart", entityId: inst.id, action: "replace", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { componentKey: input.componentKey, partId } });
    return { partId, installationId: inst.id };
  });
  return result;
}

export async function componentHistory(actor: Actor, vehicleId: string, componentKey?: string) {
  const { fin } = await requireVehicle(actor, vehicleId, "view");
  const rows = await db.installedPart.findMany({ where: { vehicleId, part: { deletedAt: null }, ...(componentKey ? { componentKey } : {}) }, include: { part: true }, orderBy: [{ componentKey: "asc" }, { installedAt: "desc" }] });
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const arr = groups.get(r.componentKey) ?? [];
    arr.push({
      installationId: r.id,
      partId: r.partId,
      partName: r.part.name,
      manufacturer: r.part.manufacturer,
      partNumber: r.part.partNumber,
      origin: r.part.origin,
      installedAt: iso(r.installedAt),
      installedKm: num(r.installedKm),
      removedAt: iso(r.removedAt),
      removedKm: num(r.removedKm),
      removalReason: r.removalReason,
      kmInService: r.removedKm !== null && r.installedKm !== null ? Number(r.removedKm) - Number(r.installedKm) : null,
      purchasePrice: fin ? num(r.part.purchasePrice) : null,
      warrantyEnd: iso(r.part.warrantyEnd),
      installRecordId: r.installRecordId,
    });
    groups.set(r.componentKey, arr);
  }
  return [...groups.entries()].map(([key, installations]) => ({ componentKey: key, replacements: Math.max(0, installations.length - 1), current: installations.find((i) => !i.removedAt) ?? null, installations }));
}

// ───────── warranties

export async function createWarranty(actor: Actor, input: z.infer<typeof warrantySchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (input.partId) {
    const p = await db.part.findFirst({ where: { id: input.partId, vehicleId: vehicle.id, deletedAt: null } });
    if (!p) throw new AppError("VALIDATION_ERROR", "Unknown part");
  }
  const w = await db.warranty.create({
    data: { vehicleId: vehicle.id, partId: input.partId ?? null, type: input.type, name: input.name, provider: input.provider ?? null, startDate: input.startDate ? isoToDate(input.startDate) : null, endDate: input.endDate ? isoToDate(input.endDate) : null, endKm: input.endKm ?? null, coverage: input.coverage ?? null, notes: input.notes ?? null },
  });
  await audit(null, actor, { entity: "Warranty", entityId: w.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { name: w.name } });
  return { id: w.id };
}

export async function updateWarranty(actor: Actor, id: string, input: Partial<z.infer<typeof warrantySchema>>) {
  const w = await db.warranty.findFirst({ where: { id, deletedAt: null } });
  if (!w) throw notFound("Warranty");
  await requireVehicle(actor, w.vehicleId, "write");
  const data: Prisma.WarrantyUpdateInput = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === "vehicleId" || k === "partId") continue;
    (data as any)[k] = k === "startDate" || k === "endDate" ? (v ? isoToDate(v as string) : null) : v;
  }
  await db.warranty.update({ where: { id }, data });
  return { id };
}

export async function deleteWarranty(actor: Actor, id: string) {
  const w = await db.warranty.findFirst({ where: { id, deletedAt: null } });
  if (!w) throw notFound("Warranty");
  await requireVehicle(actor, w.vehicleId, "write");
  await db.warranty.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

export interface WarrantyItem {
  id: string;
  source: "warranty" | "part";
  vehicleId: string;
  vehicleName: string;
  name: string;
  type: string;
  provider: string | null;
  startDate: string | null;
  endDate: string | null;
  endKm: number | null;
  coverage: string | null;
  status: "active" | "expiring" | "expired" | "no-end-date";
  daysRemaining: number | null;
  kmRemaining: number | null;
}

export async function listWarranties(actor: Actor, vehicleId?: string): Promise<WarrantyItem[]> {
  const scope = await scopeVehicles(actor, vehicleId, "view");
  const ids = scope.map((s) => s.vehicle.id);
  const today = todayInTz(actor.prefs.timezone);
  const [ws, ps] = await Promise.all([
    db.warranty.findMany({ where: { vehicleId: { in: ids }, deletedAt: null }, include: { vehicle: true } }),
    db.part.findMany({ where: { vehicleId: { in: ids }, deletedAt: null, warrantyEnd: { not: null } }, include: { vehicle: true } }),
  ]);
  const name = (v: { nickname: string; make: string; model: string; year: number }) => v.nickname || `${v.year} ${v.make} ${v.model}`;
  const classify = (end: string | null): Pick<WarrantyItem, "status" | "daysRemaining"> => {
    if (!end) return { status: "no-end-date", daysRemaining: null };
    const d = diffDays(end, today);
    return { status: d < 0 ? "expired" : d <= 60 ? "expiring" : "active", daysRemaining: d };
  };
  const out: WarrantyItem[] = [];
  for (const w of ws) {
    const cur = num(w.vehicle.currentOdometerKm);
    out.push({ id: w.id, source: "warranty", vehicleId: w.vehicleId, vehicleName: name(w.vehicle), name: w.name, type: w.type, provider: w.provider, startDate: iso(w.startDate), endDate: iso(w.endDate), endKm: num(w.endKm), coverage: w.coverage, ...classify(iso(w.endDate)), kmRemaining: w.endKm !== null && cur !== null ? Number(w.endKm) - cur : null });
  }
  for (const p of ps) out.push({ id: p.id, source: "part", vehicleId: p.vehicleId, vehicleName: name(p.vehicle), name: `${p.name} (part warranty)`, type: "PART", provider: p.manufacturer, startDate: iso(p.warrantyStart), endDate: iso(p.warrantyEnd), endKm: null, coverage: null, ...classify(iso(p.warrantyEnd)), kmRemaining: null });
  return out.sort((a, b) => (a.endDate ?? "9999") .localeCompare(b.endDate ?? "9999"));
}
