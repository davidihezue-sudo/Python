import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateToIso, isoToDate } from "@/lib/dates";
import { convertIssueSchema, dtcSchema, issueCreateSchema, issueUpdateSchema } from "@/lib/validation";
import { lookupDtc } from "@/lib/dtc";
import type { z } from "zod";
import type { Actor } from "../context";
import { canTransitionIssue, type IssueStatus } from "../engine/status";
import { num, iso, ts } from "../serialize";
import { requireVehicle, scopeVehicles } from "./access";
import { audit } from "./audit";
import { recordReading } from "./odometer";
import { createRecordInTx } from "./records";

const issueInclude = { vehicle: { select: { id: true, nickname: true, make: true, model: true, year: true } }, provider: true, codes: { where: { deletedAt: null } }, records: { where: { deletedAt: null }, select: { id: true, title: true, totalCost: true, serviceDate: true, status: true } }, documents: { where: { deletedAt: null }, select: { id: true, title: true, mimeType: true, category: true } } } satisfies Prisma.RepairIssueInclude;
type IssueFull = Prisma.RepairIssueGetPayload<{ include: typeof issueInclude }>;

export function dtcView(c: Prisma.DiagnosticCodeGetPayload<object>) {
  return {
    id: c.id,
    vehicleId: c.vehicleId,
    repairIssueId: c.repairIssueId,
    code: c.code,
    description: c.description,
    detectedAt: iso(c.detectedAt),
    odometerKm: num(c.odometerKm),
    source: c.source,
    component: c.component,
    severity: c.severity,
    status: c.status,
    symptoms: c.symptoms,
    notes: c.notes,
    resolution: c.resolution,
    resolvedAt: iso(c.resolvedAt),
    // Generic interpretation only - never presented as a confirmed diagnosis.
    reference: lookupDtc(c.code),
  };
}

export function issueView(i: IssueFull, fin: boolean) {
  return {
    id: i.id,
    vehicleId: i.vehicleId,
    vehicleName: i.vehicle.nickname || `${i.vehicle.year} ${i.vehicle.make} ${i.vehicle.model}`,
    title: i.title,
    description: i.description,
    discoveredAt: iso(i.discoveredAt),
    odometerKm: num(i.odometerKm),
    symptoms: i.symptoms,
    severity: i.severity,
    status: i.status,
    componentKey: i.componentKey,
    categoryId: i.categoryId,
    mechanicAssessment: i.mechanicAssessment,
    estimatedCost: fin ? num(i.estimatedCost) : null,
    actualCost: fin ? num(i.actualCost) : null,
    currency: i.currency,
    resolution: i.resolution,
    resolvedAt: iso(i.resolvedAt),
    providerId: i.providerId,
    providerName: i.provider?.name ?? null,
    createdAt: ts(i.createdAt),
    codes: i.codes.map(dtcView),
    repairRecords: i.records.map((r) => ({ id: r.id, title: r.title, serviceDate: iso(r.serviceDate), status: r.status, totalCost: fin ? num(r.totalCost) : null })),
    documents: i.documents,
  };
}
export type IssueView = ReturnType<typeof issueView>;

async function resolveIssueProvider(householdId: string, providerId?: string | null) {
  if (!providerId) return null;
  const p = await db.serviceProvider.findFirst({ where: { id: providerId, householdId, deletedAt: null } });
  if (!p) throw new AppError("VALIDATION_ERROR", "Unknown service provider");
  return p.id;
}

export async function createIssue(actor: Actor, input: z.infer<typeof issueCreateSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  const providerId = await resolveIssueProvider(vehicle.householdId, input.providerId);
  const warnings: string[] = [];
  const id = await db.$transaction(async (tx) => {
    const issue = await tx.repairIssue.create({
      data: {
        vehicleId: vehicle.id,
        title: input.title,
        description: input.description ?? null,
        discoveredAt: isoToDate(input.discoveredAt),
        odometerKm: input.odometerKm ?? null,
        symptoms: input.symptoms ?? null,
        severity: input.severity,
        status: input.status,
        componentKey: input.componentKey ?? null,
        categoryId: input.categoryId ?? null,
        mechanicAssessment: input.mechanicAssessment ?? null,
        estimatedCost: input.estimatedCost ?? null,
        actualCost: input.actualCost ?? null,
        resolution: input.resolution ?? null,
        resolvedAt: ["RESOLVED", "CLOSED"].includes(input.status) ? isoToDate(input.discoveredAt) : null,
        providerId,
        currency: input.currency ?? vehicle.currency,
        createdById: actor.id,
      },
    });
    if (input.odometerKm != null) {
      try {
        await recordReading(tx, actor, vehicle, { date: input.discoveredAt, valueKm: input.odometerKm, source: "REPAIR", note: `Issue: ${input.title}` });
      } catch (e) {
        // An observation must never be blocked by an inconsistent odometer; keep the value on the issue and warn.
        if (e instanceof AppError && e.code === "ODOMETER_REGRESSION") warnings.push("The odometer value on this issue conflicts with existing readings, so it was not added to the odometer history.");
        else throw e;
      }
    }
    await audit(tx, actor, { entity: "RepairIssue", entityId: issue.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { title: issue.title, severity: issue.severity } });
    return issue.id;
  });
  return { id, warnings };
}

export async function updateIssue(actor: Actor, issueId: string, input: z.infer<typeof issueUpdateSchema>) {
  const issue = await db.repairIssue.findFirst({ where: { id: issueId, deletedAt: null } });
  if (!issue) throw notFound("Issue");
  const { vehicle } = await requireVehicle(actor, issue.vehicleId, "write");
  if (input.status && !canTransitionIssue(issue.status as IssueStatus, input.status as IssueStatus)) throw new AppError("CONFLICT", "A closed issue can only be reopened as 'new'");
  const data: Prisma.RepairIssueUpdateInput = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === "discoveredAt") data.discoveredAt = isoToDate(v as string);
    else if (k === "providerId") data.provider = v ? { connect: { id: (await resolveIssueProvider(vehicle.householdId, v as string)) as string } } : { disconnect: true };
    else if (k === "categoryId") continue;
    else (data as any)[k] = v;
  }
  if (input.status && ["RESOLVED", "CLOSED"].includes(input.status) && !issue.resolvedAt) data.resolvedAt = new Date(new Date().toISOString().slice(0, 10));
  if (input.status && !["RESOLVED", "CLOSED"].includes(input.status)) data.resolvedAt = null;
  const updated = await db.repairIssue.update({ where: { id: issue.id }, data });
  await audit(null, actor, { entity: "RepairIssue", entityId: issue.id, action: input.status && input.status !== issue.status ? `status:${issue.status}->${input.status}` : "update", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { status: issue.status, severity: issue.severity }, after: { status: updated.status, severity: updated.severity } });
  return { id: updated.id };
}

export async function deleteIssue(actor: Actor, issueId: string) {
  const issue = await db.repairIssue.findFirst({ where: { id: issueId, deletedAt: null } });
  if (!issue) throw notFound("Issue");
  const { vehicle } = await requireVehicle(actor, issue.vehicleId, "write");
  await db.repairIssue.update({ where: { id: issue.id }, data: { deletedAt: new Date() } });
  await audit(null, actor, { entity: "RepairIssue", entityId: issue.id, action: "delete", vehicleId: vehicle.id, householdId: vehicle.householdId, before: { title: issue.title } });
  return { ok: true };
}

export async function getIssue(actor: Actor, issueId: string) {
  const i = await db.repairIssue.findFirst({ where: { id: issueId, deletedAt: null }, include: issueInclude });
  if (!i) throw notFound("Issue");
  const { fin } = await requireVehicle(actor, i.vehicleId, "view");
  return issueView(i, fin);
}

export async function listIssues(actor: Actor, q: { vehicleId?: string; status?: string; open?: boolean; severity?: string; q?: string; component?: string; page?: number; pageSize?: number }) {
  const scope = await scopeVehicles(actor, q.vehicleId, "view");
  const fin = new Set(scope.filter((s) => s.fin).map((s) => s.vehicle.id));
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, q.pageSize ?? 50);
  const where: Prisma.RepairIssueWhereInput = {
    vehicleId: { in: scope.map((s) => s.vehicle.id) },
    deletedAt: null,
    ...(q.status ? { status: q.status as any } : {}),
    ...(q.open ? { status: { notIn: ["RESOLVED", "CLOSED"] } } : {}),
    ...(q.severity ? { severity: q.severity as any } : {}),
    ...(q.component ? { componentKey: q.component } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }, { symptoms: { contains: q.q, mode: "insensitive" } }, { componentKey: { contains: q.q, mode: "insensitive" } }, { codes: { some: { code: { contains: q.q, mode: "insensitive" } } } }] } : {}),
  };
  const [total, rows] = await Promise.all([db.repairIssue.count({ where }), db.repairIssue.findMany({ where, include: issueInclude, orderBy: [{ discoveredAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize })]);
  return { items: rows.map((r) => issueView(r, fin.has(r.vehicleId))), page, pageSize, total };
}

/** Converts an issue into a completed repair record (and expense), resolving the issue - all in one transaction. */
export async function convertIssueToRepair(actor: Actor, issueId: string, input: z.infer<typeof convertIssueSchema>) {
  const issue = await db.repairIssue.findFirst({ where: { id: issueId, deletedAt: null } });
  if (!issue) throw notFound("Issue");
  const { vehicle } = await requireVehicle(actor, issue.vehicleId, "write");
  const out = await db.$transaction(async (tx) => {
    const recId = await createRecordInTx(tx, actor, vehicle, {
      vehicleId: vehicle.id,
      kind: "REPAIR",
      status: "COMPLETED",
      title: input.title ?? `Repair: ${issue.title}`,
      description: issue.description ?? undefined,
      serviceDate: input.serviceDate,
      odometerKm: input.odometerKm ?? null,
      workPerformedBy: input.workPerformedBy,
      providerId: input.providerId ?? issue.providerId ?? null,
      mechanicName: input.mechanicName ?? null,
      laborCost: input.laborCost ?? null,
      partsCost: input.partsCost ?? null,
      tax: input.tax ?? null,
      discount: input.discount ?? null,
      notes: input.notes ?? null,
      repairIssueId: issue.id,
      items: input.items,
      allowDuplicate: false,
      confirmOdometerCorrection: input.confirmOdometerCorrection,
    } as any);
    const rec = await tx.maintenanceRecord.findUniqueOrThrow({ where: { id: recId } });
    await tx.repairIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: isoToDate(input.serviceDate), actualCost: rec.totalCost, resolution: input.resolution ?? issue.resolution ?? "Repaired", providerId: rec.providerId ?? issue.providerId } });
    await tx.diagnosticCode.updateMany({ where: { repairIssueId: issue.id, status: "ACTIVE", deletedAt: null }, data: { status: "RESOLVED", resolvedAt: isoToDate(input.serviceDate) } });
    await audit(tx, actor, { entity: "RepairIssue", entityId: issue.id, action: "convert-to-repair", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { recordId: recId, totalCost: Number(rec.totalCost) } });
    return { recordId: recId, totalCost: Number(rec.totalCost) };
  });
  return out;
}

// ───────── diagnostic codes

export async function createCode(actor: Actor, input: z.infer<typeof dtcSchema> & { vehicleId: string }) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (input.repairIssueId) {
    const i = await db.repairIssue.findFirst({ where: { id: input.repairIssueId, vehicleId: vehicle.id, deletedAt: null } });
    if (!i) throw new AppError("VALIDATION_ERROR", "Unknown issue for this vehicle");
  }
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const c = await db.diagnosticCode.create({
    data: {
      vehicleId: vehicle.id,
      repairIssueId: input.repairIssueId ?? null,
      code,
      description: input.description ?? null,
      detectedAt: isoToDate(input.detectedAt),
      odometerKm: input.odometerKm ?? null,
      source: input.source,
      component: input.component ?? null,
      severity: input.severity,
      status: input.status,
      symptoms: input.symptoms ?? null,
      notes: input.notes ?? null,
      resolution: input.resolution ?? null,
      resolvedAt: input.status !== "ACTIVE" ? isoToDate(input.detectedAt) : null,
      createdById: actor.id,
    },
  });
  await audit(null, actor, { entity: "DiagnosticCode", entityId: c.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { code } });
  return dtcView(c);
}

export async function updateCode(actor: Actor, codeId: string, input: Partial<z.infer<typeof dtcSchema>>) {
  const c = await db.diagnosticCode.findFirst({ where: { id: codeId, deletedAt: null } });
  if (!c) throw notFound("Diagnostic code");
  await requireVehicle(actor, c.vehicleId, "write");
  const data: Prisma.DiagnosticCodeUpdateInput = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === "vehicleId" || k === "repairIssueId") continue;
    if (k === "detectedAt") data.detectedAt = isoToDate(v as string);
    else if (k === "code") data.code = (v as string).toUpperCase().replace(/\s+/g, "");
    else (data as any)[k] = v;
  }
  if (input.status && input.status !== "ACTIVE" && !c.resolvedAt) data.resolvedAt = new Date(new Date().toISOString().slice(0, 10));
  if (input.status === "ACTIVE") data.resolvedAt = null;
  return dtcView(await db.diagnosticCode.update({ where: { id: c.id }, data }));
}

export async function deleteCode(actor: Actor, codeId: string) {
  const c = await db.diagnosticCode.findFirst({ where: { id: codeId, deletedAt: null } });
  if (!c) throw notFound("Diagnostic code");
  await requireVehicle(actor, c.vehicleId, "write");
  await db.diagnosticCode.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

export async function listCodes(actor: Actor, vehicleId?: string) {
  const scope = await scopeVehicles(actor, vehicleId, "view");
  const rows = await db.diagnosticCode.findMany({ where: { vehicleId: { in: scope.map((s) => s.vehicle.id) }, deletedAt: null }, orderBy: { detectedAt: "desc" } });
  return rows.map(dtcView);
}
