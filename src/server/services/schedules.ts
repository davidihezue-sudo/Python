import type { MaintenanceScheduleAssignment, Prisma } from "@prisma/client";
import { db, type Db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateToIso, isoToDate, todayInTz, type IsoDate } from "@/lib/dates";
import { assignmentCreateSchema, assignmentUpdateSchema, scheduleTemplateSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { DEFAULT_THRESHOLDS, deriveLastCompletion, describeDue, evaluateRule, maintenanceHealth, statusUrgency, type Evaluation, type RuleInput, type Thresholds, type Condition } from "../engine/schedule";
import { computeUsage, type Reading, type UsageStats } from "../engine/mileage";
import { num, iso } from "../serialize";
import { requireHouseholdAdmin, requireVehicle } from "./access";
import { audit } from "./audit";
import { libraryAppliesTo, LIBRARY, slugify, TEMPLATES } from "../reference/library";

// ───────────── usage

export async function loadReadings(client: Db, vehicleId: string): Promise<Reading[]> {
  const rows = await client.odometerEntry.findMany({ where: { vehicleId, deletedAt: null }, select: { date: true, valueKm: true }, orderBy: [{ date: "asc" }, { valueKm: "asc" }] });
  return rows.map((r) => ({ date: dateToIso(r.date) as string, valueKm: Number(r.valueKm) }));
}

export async function vehicleUsage(client: Db, vehicleId: string): Promise<{ readings: Reading[]; usage: UsageStats }> {
  const readings = await loadReadings(client, vehicleId);
  return { readings, usage: computeUsage(readings) };
}

// ───────────── derive + persist

type InspectionItem = { assignmentId?: string | null; componentKey?: string | null; condition: Condition };

/**
 * Recompute last-completion, next due and the status snapshot for every assignment of a vehicle.
 * Pure function of (records, inspections, baseline, odometer). Called after any change that could affect schedules.
 */
export async function refreshVehicleSchedules(client: Db, vehicleId: string, today: IsoDate = todayInTz("America/Edmonton")) {
  const vehicle = await client.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return;
  const assignments = await client.maintenanceScheduleAssignment.findMany({ where: { vehicleId, deletedAt: null } });
  if (!assignments.length) return;
  const { usage, readings } = await vehicleUsage(client, vehicleId);
  const currentKm = vehicle.currentOdometerKm !== null ? Number(vehicle.currentOdometerKm) : null;
  const currentKmDate = dateToIso(vehicle.currentOdometerAt) ?? readings.at(-1)?.date ?? null;

  const items = await client.maintenanceRecordItem.findMany({
    where: { assignmentId: { in: assignments.map((a) => a.id) }, completed: true, record: { status: "COMPLETED", deletedAt: null } },
    select: { assignmentId: true, recordId: true, record: { select: { serviceDate: true, odometerKm: true } } },
  });
  const byAssignment = new Map<string, { date: IsoDate; km: number | null; recordId: string }[]>();
  for (const it of items) {
    const arr = byAssignment.get(it.assignmentId as string) ?? [];
    arr.push({ date: dateToIso(it.record.serviceDate) as string, km: num(it.record.odometerKm), recordId: it.recordId });
    byAssignment.set(it.assignmentId as string, arr);
  }
  const inspections = await client.inspection.findMany({ where: { vehicleId, deletedAt: null }, orderBy: { date: "asc" } });

  for (const a of assignments) {
    const recEvents = byAssignment.get(a.id) ?? [];
    const insEvents: { date: IsoDate; km: number | null }[] = [];
    let lastCondition: string | null = null;
    let lastInspectedAt: IsoDate | null = null;
    for (const ins of inspections) {
      const list = (ins.items as unknown as InspectionItem[]) ?? [];
      const hit = list.find((x) => x.assignmentId === a.id || (!x.assignmentId && x.componentKey && x.componentKey === a.componentKey));
      if (hit) {
        lastCondition = hit.condition;
        lastInspectedAt = dateToIso(ins.date);
        insEvents.push({ date: dateToIso(ins.date) as string, km: num(ins.odometerKm) });
      }
    }
    const events = [...recEvents, ...(a.triggerType === "INSPECTION" ? insEvents : [])];
    const last = deriveLastCompletion(events, { date: dateToIso(a.baselineDate), km: num(a.baselineKm) });
    const lastRecord = recEvents.length ? [...recEvents].sort((x, y) => (x.date < y.date ? 1 : -1))[0].recordId : null;
    const rule = toRule({ ...a, lastCompletedAt: last ? isoToDate(last.date) : null, lastCompletedKm: last?.km ?? null, lastCondition, lastInspectedAt: lastInspectedAt ? isoToDate(lastInspectedAt) : null });
    const ev = evaluateRule(rule, { currentKm, currentKmDate, today, avgDailyKm: usage.avgDailyKm, thresholds: DEFAULT_THRESHOLDS });
    await client.maintenanceScheduleAssignment.update({
      where: { id: a.id },
      data: {
        lastCompletedAt: last ? isoToDate(last.date) : null,
        lastCompletedKm: last?.km ?? null,
        lastRecordId: lastRecord,
        lastCondition,
        lastInspectedAt: lastInspectedAt ? isoToDate(lastInspectedAt) : null,
        nextDueKm: ev.nextDueKm,
        nextDueDate: ev.nextDueDate ? isoToDate(ev.nextDueDate) : null,
        status: ev.status,
        statusUpdatedAt: new Date(),
      },
    });
  }
}

type RuleSource = Pick<MaintenanceScheduleAssignment, "triggerType" | "intervalMonths" | "intervalDays" | "anchorDate" | "oneTimeDueDate" | "sourceType" | "dueSoonKm" | "dueSoonDays" | "lastCompletedAt" | "lastCondition" | "lastInspectedAt"> & {
  intervalKm: Prisma.Decimal | number | null;
  oneTimeDueKm: Prisma.Decimal | number | null;
  lastCompletedKm: Prisma.Decimal | number | null;
};

export function toRule(a: RuleSource): RuleInput {
  return {
    triggerType: a.triggerType,
    intervalKm: num(a.intervalKm),
    intervalMonths: a.intervalMonths,
    intervalDays: a.intervalDays,
    anchorDate: dateToIso(a.anchorDate),
    oneTimeDueDate: dateToIso(a.oneTimeDueDate),
    oneTimeDueKm: num(a.oneTimeDueKm),
    sourceType: a.sourceType,
    dueSoonKm: a.dueSoonKm,
    dueSoonDays: a.dueSoonDays,
    lastCompletedAt: dateToIso(a.lastCompletedAt),
    lastCompletedKm: num(a.lastCompletedKm),
    lastCondition: a.lastCondition,
    lastInspectedAt: dateToIso(a.lastInspectedAt),
  };
}

// ───────────── views

type AssignmentWithCat = Prisma.MaintenanceScheduleAssignmentGetPayload<{ include: { category: true } }>;

export function assignmentView(a: AssignmentWithCat, ev: Evaluation, unit: "KM" | "MI", fin: boolean) {
  return {
    id: a.id,
    vehicleId: a.vehicleId,
    scheduleId: a.scheduleId,
    categoryId: a.categoryId,
    categoryKey: a.category.key,
    categoryName: a.category.name,
    name: a.name,
    description: a.description,
    componentKey: a.componentKey,
    triggerType: a.triggerType,
    intervalKm: num(a.intervalKm),
    intervalMonths: a.intervalMonths,
    intervalDays: a.intervalDays,
    anchorDate: iso(a.anchorDate),
    oneTimeDueDate: iso(a.oneTimeDueDate),
    oneTimeDueKm: num(a.oneTimeDueKm),
    priority: a.priority,
    estCostMin: fin ? num(a.estCostMin) : null,
    estCostMax: fin ? num(a.estCostMax) : null,
    currency: a.currency,
    instructions: a.instructions,
    sourceType: a.sourceType,
    sourceNote: a.sourceNote,
    enabled: a.enabled,
    dueSoonKm: a.dueSoonKm,
    dueSoonDays: a.dueSoonDays,
    alertKmBefore: a.alertKmBefore,
    alertDaysBefore: a.alertDaysBefore,
    baselineDate: iso(a.baselineDate),
    baselineKm: num(a.baselineKm),
    lastCompletedAt: iso(a.lastCompletedAt),
    lastCompletedKm: num(a.lastCompletedKm),
    lastRecordId: a.lastRecordId,
    lastCondition: a.lastCondition,
    lastInspectedAt: iso(a.lastInspectedAt),
    status: ev.status,
    nextDueKm: ev.nextDueKm,
    nextDueDate: ev.nextDueDate,
    remainingKm: ev.remainingKm,
    remainingDays: ev.remainingDays,
    estimatedKmDueDate: ev.estimatedKmDueDate,
    estimatedMonthsToKm: ev.estimatedMonthsToKm,
    effectiveDueDate: ev.effectiveDueDate,
    dueBasis: ev.dueBasis,
    estimateBasis: ev.estimateBasis,
    overdueByKm: ev.overdueByKm,
    overdueByDays: ev.overdueByDays,
    reason: ev.reason,
    summary: a.enabled ? describeDue(ev, unit) : "Disabled",
  };
}
export type AssignmentView = ReturnType<typeof assignmentView>;

export interface VehicleScheduleBundle {
  items: AssignmentView[];
  usage: UsageStats;
  health: ReturnType<typeof maintenanceHealth>;
  currentKm: number | null;
}

export async function evaluateVehicleSchedules(vehicleId: string, prefs: { thresholds: Thresholds; distanceUnit: "KM" | "MI"; timezone: string }, fin: boolean, client: Db = db, today?: IsoDate): Promise<VehicleScheduleBundle> {
  const vehicle = await client.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  const [rows, { usage, readings }] = await Promise.all([
    client.maintenanceScheduleAssignment.findMany({ where: { vehicleId, deletedAt: null }, include: { category: true } }),
    vehicleUsage(client, vehicleId),
  ]);
  const t = today ?? todayInTz(prefs.timezone);
  const currentKm = vehicle.currentOdometerKm !== null ? Number(vehicle.currentOdometerKm) : null;
  const currentKmDate = dateToIso(vehicle.currentOdometerAt) ?? readings.at(-1)?.date ?? null;
  const items = rows.map((a) => {
    const ev = evaluateRule(toRule(a), { currentKm, currentKmDate, today: t, avgDailyKm: usage.avgDailyKm, thresholds: prefs.thresholds });
    return assignmentView(a, ev, prefs.distanceUnit, fin);
  });
  items.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const u = statusUrgency(b.status) - statusUrgency(a.status);
    if (u) return u;
    const da = a.effectiveDueDate ?? "9999";
    const dbb = b.effectiveDueDate ?? "9999";
    return da < dbb ? -1 : da > dbb ? 1 : a.name.localeCompare(b.name);
  });
  const health = maintenanceHealth(items.filter((i) => i.enabled).map((i) => ({ status: i.status, priority: i.priority })));
  return { items, usage, health, currentKm };
}

export async function listVehicleSchedules(actor: Actor, vehicleId: string) {
  const { fin } = await requireVehicle(actor, vehicleId, "view");
  return evaluateVehicleSchedules(vehicleId, actor.prefs, fin);
}

// ───────────── library & CRUD

export async function listLibrary(actor: Actor, householdId?: string) {
  const members = await db.householdMember.findMany({ where: { userId: actor.id } });
  const hhIds = householdId ? members.filter((m) => m.householdId === householdId).map((m) => m.householdId) : members.map((m) => m.householdId);
  const rows = await db.maintenanceSchedule.findMany({ where: { deletedAt: null, OR: [{ householdId: null }, { householdId: { in: hhIds } }] }, include: { category: true }, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] });
  return rows.map((s) => ({
    id: s.id,
    libraryKey: s.libraryKey,
    householdId: s.householdId,
    categoryId: s.categoryId,
    categoryName: s.category.name,
    name: s.name,
    description: s.description,
    componentKey: s.componentKey,
    triggerType: s.triggerType,
    intervalKm: num(s.intervalKm),
    intervalMonths: s.intervalMonths,
    intervalDays: s.intervalDays,
    priority: s.priority,
    sourceType: s.sourceType,
    sourceNote: s.sourceNote,
    isSystem: s.isSystem,
    appliesTo: s.appliesTo,
  }));
}

export async function listCategories() {
  return (await db.maintenanceCategory.findMany({ orderBy: { sortOrder: "asc" } })).map((c) => ({ id: c.id, key: c.key, name: c.name }));
}

export async function createHouseholdTemplate(actor: Actor, householdId: string, input: z.infer<typeof scheduleTemplateSchema>) {
  await requireHouseholdAdmin(actor, householdId);
  const s = await db.maintenanceSchedule.create({
    data: {
      householdId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      componentKey: input.componentKey ?? slugify(input.name),
      triggerType: input.triggerType,
      intervalKm: input.intervalKm ?? null,
      intervalMonths: input.intervalMonths ?? null,
      intervalDays: input.intervalDays ?? null,
      priority: input.priority,
      estCostMin: input.estCostMin ?? null,
      estCostMax: input.estCostMax ?? null,
      instructions: input.instructions ?? null,
      sourceType: input.sourceType,
      sourceNote: input.sourceNote ?? null,
    },
  });
  await audit(null, actor, { entity: "MaintenanceSchedule", entityId: s.id, action: "create", householdId, after: s });
  return { id: s.id };
}

/** Apply suggested library schedules (optionally limited to keys) to a vehicle. Existing assignments are never duplicated or overwritten. */
export async function applyLibrary(client: Db, actor: Actor | null, vehicleId: string, opts: { keys?: string[]; sourceNote?: string } = {}) {
  const v = await client.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  const keys = opts.keys ?? LIBRARY.map((l) => l.key);
  const templates = await client.maintenanceSchedule.findMany({ where: { libraryKey: { in: keys }, deletedAt: null } });
  const existing = await client.maintenanceScheduleAssignment.findMany({ where: { vehicleId, deletedAt: null }, select: { scheduleId: true } });
  const have = new Set(existing.map((e) => e.scheduleId));
  const byKey = new Map(LIBRARY.map((l) => [l.key, l]));
  let created = 0;
  for (const t of templates) {
    if (have.has(t.id)) continue;
    const lib = byKey.get(t.libraryKey as string);
    if (lib && !libraryAppliesTo(lib, { fuelType: v.fuelType, drivetrain: v.drivetrain })) continue;
    await client.maintenanceScheduleAssignment.upsert({
      where: { vehicleId_scheduleId: { vehicleId, scheduleId: t.id } },
      update: { deletedAt: null },
      create: {
        vehicleId,
        scheduleId: t.id,
        categoryId: t.categoryId,
        name: t.name,
        description: t.description,
        componentKey: t.componentKey,
        triggerType: t.triggerType,
        intervalKm: t.intervalKm,
        intervalMonths: t.intervalMonths,
        intervalDays: t.intervalDays,
        priority: t.priority,
        estCostMin: t.estCostMin,
        estCostMax: t.estCostMax,
        currency: v.currency,
        instructions: t.instructions,
        sourceType: t.sourceType,
        sourceNote: opts.sourceNote ?? t.sourceNote,
      },
    });
    created++;
  }
  if (created) {
    await audit(client, actor, { entity: "MaintenanceScheduleAssignment", action: "apply-library", vehicleId, householdId: v.householdId, after: { created } });
    await refreshVehicleSchedules(client, vehicleId);
  }
  return { created };
}

export async function applyLibraryForActor(actor: Actor, vehicleId: string, keys?: string[]) {
  await requireVehicle(actor, vehicleId, "write");
  return applyLibrary(db, actor, vehicleId, { keys });
}

export async function applyTemplateSchedules(client: Db, actor: Actor | null, vehicleId: string, templateKey: string) {
  const t = TEMPLATES.find((x) => x.key === templateKey);
  if (!t) return { created: 0 };
  return applyLibrary(client, actor, vehicleId, { keys: t.scheduleKeys, sourceNote: t.sourceNote });
}

export async function createAssignment(actor: Actor, vehicleId: string, input: z.infer<typeof assignmentCreateSchema>) {
  const { vehicle } = await requireVehicle(actor, vehicleId, "write");
  const a = await db.maintenanceScheduleAssignment.create({
    data: {
      vehicleId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      componentKey: input.componentKey ?? slugify(input.name),
      triggerType: input.triggerType,
      intervalKm: input.intervalKm ?? null,
      intervalMonths: input.intervalMonths ?? null,
      intervalDays: input.intervalDays ?? null,
      anchorDate: input.anchorDate ? isoToDate(input.anchorDate) : null,
      oneTimeDueDate: input.oneTimeDueDate ? isoToDate(input.oneTimeDueDate) : null,
      oneTimeDueKm: input.oneTimeDueKm ?? null,
      priority: input.priority,
      estCostMin: input.estCostMin ?? null,
      estCostMax: input.estCostMax ?? null,
      currency: vehicle.currency,
      instructions: input.instructions ?? null,
      sourceType: input.sourceType,
      sourceNote: input.sourceNote ?? null,
      enabled: input.enabled,
      dueSoonKm: input.dueSoonKm ?? null,
      dueSoonDays: input.dueSoonDays ?? null,
      baselineDate: input.baselineDate ? isoToDate(input.baselineDate) : null,
      baselineKm: input.baselineKm ?? null,
    },
  });
  await audit(null, actor, { entity: "MaintenanceScheduleAssignment", entityId: a.id, action: "create", vehicleId, householdId: vehicle.householdId, after: a });
  await refreshVehicleSchedules(db, vehicleId, todayInTz(actor.prefs.timezone));
  return { id: a.id };
}

export async function updateAssignment(actor: Actor, assignmentId: string, input: z.infer<typeof assignmentUpdateSchema>) {
  const a = await db.maintenanceScheduleAssignment.findFirst({ where: { id: assignmentId, deletedAt: null } });
  if (!a) throw notFound("Schedule");
  const { vehicle } = await requireVehicle(actor, a.vehicleId, "write");
  const data: Prisma.MaintenanceScheduleAssignmentUpdateInput = {};
  const set = <K extends keyof typeof input>(k: K, f?: (v: any) => any) => {
    if (input[k] !== undefined) (data as any)[k] = f ? f(input[k]) : input[k];
  };
  set("name");
  set("description");
  set("triggerType");
  set("intervalKm");
  set("intervalMonths");
  set("intervalDays");
  set("anchorDate", (v) => (v ? isoToDate(v) : null));
  set("oneTimeDueDate", (v) => (v ? isoToDate(v) : null));
  set("oneTimeDueKm");
  set("priority");
  set("estCostMin");
  set("estCostMax");
  set("instructions");
  set("sourceType");
  set("sourceNote");
  set("enabled");
  set("dueSoonKm");
  set("dueSoonDays");
  set("alertKmBefore");
  set("alertDaysBefore");
  set("baselineDate", (v) => (v ? isoToDate(v) : null));
  set("baselineKm");
  // A user editing intervals takes ownership of the rule: relabel provenance unless they said otherwise.
  const intervalsChanged = ["intervalKm", "intervalMonths", "intervalDays", "triggerType"].some((k) => (input as any)[k] !== undefined);
  if (intervalsChanged && input.sourceType === undefined && a.sourceType !== "USER_DEFINED") {
    data.sourceType = "USER_DEFINED";
    data.sourceNote = "Customised by you (originally a suggested interval).";
  }
  const merged = { ...a, ...Object.fromEntries(Object.entries(data)) } as any;
  const check = assignmentCreateSchema.safeParse({
    name: merged.name,
    categoryId: merged.categoryId,
    triggerType: merged.triggerType,
    intervalKm: num(merged.intervalKm),
    intervalMonths: merged.intervalMonths,
    intervalDays: merged.intervalDays,
    anchorDate: dateToIso(merged.anchorDate),
    oneTimeDueDate: dateToIso(merged.oneTimeDueDate),
    oneTimeDueKm: num(merged.oneTimeDueKm),
  });
  if (!check.success) throw new AppError("VALIDATION_ERROR", check.error.issues[0].message, check.error.flatten());
  const updated = await db.maintenanceScheduleAssignment.update({ where: { id: a.id }, data });
  await audit(null, actor, { entity: "MaintenanceScheduleAssignment", entityId: a.id, action: "update", vehicleId: a.vehicleId, householdId: vehicle.householdId, before: a, after: updated });
  await refreshVehicleSchedules(db, a.vehicleId, todayInTz(actor.prefs.timezone));
  return { id: a.id };
}

export async function deleteAssignment(actor: Actor, assignmentId: string) {
  const a = await db.maintenanceScheduleAssignment.findFirst({ where: { id: assignmentId, deletedAt: null } });
  if (!a) throw notFound("Schedule");
  const { vehicle } = await requireVehicle(actor, a.vehicleId, "write");
  await db.maintenanceScheduleAssignment.update({ where: { id: a.id }, data: { deletedAt: new Date(), enabled: false } });
  await audit(null, actor, { entity: "MaintenanceScheduleAssignment", entityId: a.id, action: "delete", vehicleId: a.vehicleId, householdId: vehicle.householdId, before: a });
  return { ok: true };
}

export async function getAssignment(actor: Actor, assignmentId: string) {
  const a = await db.maintenanceScheduleAssignment.findFirst({ where: { id: assignmentId, deletedAt: null }, include: { category: true } });
  if (!a) throw notFound("Schedule");
  const { fin } = await requireVehicle(actor, a.vehicleId, "view");
  const bundle = await evaluateVehicleSchedules(a.vehicleId, actor.prefs, fin);
  const view = bundle.items.find((i) => i.id === a.id);
  if (!view) throw notFound("Schedule");
  const history = await db.auditLog.findMany({ where: { entity: "MaintenanceScheduleAssignment", entityId: a.id }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } });
  return { ...view, changeHistory: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt.toISOString(), by: h.user?.name ?? null })) };
}

/** Cross-vehicle schedule overview for the Maintenance planner page. */
export async function listAllSchedules(actor: Actor, vehicleIds: { id: string; name: string; fin: boolean }[]) {
  const out: (AssignmentView & { vehicleName: string })[] = [];
  for (const v of vehicleIds) {
    const b = await evaluateVehicleSchedules(v.id, actor.prefs, v.fin);
    for (const i of b.items) out.push({ ...i, vehicleName: v.name });
  }
  out.sort((a, b) => statusUrgency(b.status) - statusUrgency(a.status) || (a.effectiveDueDate ?? "9999").localeCompare(b.effectiveDueDate ?? "9999"));
  return out;
}
