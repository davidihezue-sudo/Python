import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { diffDays, humanizeDays, isoToDate, todayInTz, type IsoDate } from "@/lib/dates";
import { formatDistance } from "@/lib/units";
import { reminderSchema, reminderUpdateSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor } from "../context";
import { statusUrgency } from "../engine/schedule";
import { num, iso } from "../serialize";
import { accessibleVehicles, requireVehicle } from "./access";
import { audit } from "./audit";
import { evaluateVehicleSchedules } from "./schedules";

export async function createReminder(actor: Actor, input: z.infer<typeof reminderSchema>) {
  const { vehicle } = await requireVehicle(actor, input.vehicleId, "write");
  if (input.assignmentId) {
    const a = await db.maintenanceScheduleAssignment.findFirst({ where: { id: input.assignmentId, vehicleId: vehicle.id, deletedAt: null } });
    if (!a) throw new AppError("VALIDATION_ERROR", "Unknown schedule for this vehicle");
  }
  const r = await db.reminder.create({ data: { vehicleId: vehicle.id, assignmentId: input.assignmentId ?? null, type: input.type, title: input.title, notes: input.notes ?? null, dueDate: input.dueDate ? isoToDate(input.dueDate) : null, dueKm: input.dueKm ?? null, leadDays: input.leadDays, leadKm: input.leadKm, createdById: actor.id } });
  await audit(null, actor, { entity: "Reminder", entityId: r.id, action: "create", vehicleId: vehicle.id, householdId: vehicle.householdId, after: { title: r.title } });
  return { id: r.id };
}

export async function updateReminder(actor: Actor, id: string, input: z.infer<typeof reminderUpdateSchema>) {
  const r = await db.reminder.findUnique({ where: { id } });
  if (!r) throw notFound("Reminder");
  await requireVehicle(actor, r.vehicleId, "write");
  await db.reminder.update({ where: { id }, data: { ...(input.title ? { title: input.title } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? isoToDate(input.dueDate) : null } : {}), ...(input.dueKm !== undefined ? { dueKm: input.dueKm } : {}), ...(input.status ? { status: input.status } : {}), ...(input.leadDays ? { leadDays: input.leadDays } : {}), ...(input.leadKm ? { leadKm: input.leadKm } : {}) } });
  return { id };
}

export async function deleteReminder(actor: Actor, id: string) {
  const r = await db.reminder.findUnique({ where: { id } });
  if (!r) throw notFound("Reminder");
  await requireVehicle(actor, r.vehicleId, "write");
  await db.reminder.delete({ where: { id } });
  return { ok: true };
}

export async function listReminders(actor: Actor, vehicleId?: string, includeDone = false) {
  const scope = await accessibleVehicles(actor, "view", vehicleId && vehicleId !== "all" ? { vehicleId } : {});
  const rows = await db.reminder.findMany({ where: { vehicleId: { in: scope.map((s) => s.vehicle.id) }, ...(includeDone ? {} : { status: "ACTIVE" }) }, include: { vehicle: true }, orderBy: [{ dueDate: "asc" }] });
  return rows.map((r) => ({ id: r.id, vehicleId: r.vehicleId, vehicleName: r.vehicle.nickname, type: r.type, title: r.title, notes: r.notes, dueDate: iso(r.dueDate), dueKm: num(r.dueKm), status: r.status, leadDays: r.leadDays, leadKm: r.leadKm, assignmentId: r.assignmentId }));
}

export type UpcomingKind = "maintenance" | "registration" | "insurance" | "inspection" | "warranty" | "custom" | "document" | "repair";
export interface UpcomingItem {
  key: string;
  kind: UpcomingKind;
  vehicleId: string;
  vehicleName: string;
  title: string;
  summary: string;
  dueDate: IsoDate | null;
  dueKm: number | null;
  state: "overdue" | "due" | "soon" | "upcoming";
  urgency: number;
  assignmentId?: string;
  reminderId?: string;
  actionUrl: string;
  basis?: string[];
}

const stateOf = (days: number): UpcomingItem["state"] => (days < 0 ? "overdue" : days <= 7 ? "due" : days <= 30 ? "soon" : "upcoming");
const urgencyOf = (s: UpcomingItem["state"]) => ({ overdue: 100, due: 80, soon: 60, upcoming: 40 })[s];

/** Everything due or coming due across the actor's vehicles - derived live, so it is always consistent with the data. */
export async function upcoming(actor: Actor, opts: { vehicleId?: string; horizonDays?: number } = {}): Promise<UpcomingItem[]> {
  const horizon = opts.horizonDays ?? 90;
  const scope = await accessibleVehicles(actor, "view", opts.vehicleId && opts.vehicleId !== "all" ? { vehicleId: opts.vehicleId } : {});
  const today = todayInTz(actor.prefs.timezone);
  const unit = actor.prefs.distanceUnit;
  const out: UpcomingItem[] = [];
  for (const s of scope) {
    const v = s.vehicle;
    const name = v.nickname;
    const bundle = await evaluateVehicleSchedules(v.id, actor.prefs, s.fin, db, today);
    for (const a of bundle.items) {
      if (!a.enabled || ["UP_TO_DATE", "UNKNOWN_HISTORY"].includes(a.status)) continue;
      const state: UpcomingItem["state"] = a.status === "OVERDUE" ? "overdue" : a.status === "DUE_NOW" || a.status === "INSPECTION_REQUIRED" ? "due" : a.status === "DUE_SOON" ? "soon" : "upcoming";
      out.push({ key: `maint:${a.id}`, kind: "maintenance", vehicleId: v.id, vehicleName: name, title: a.name, summary: a.summary, dueDate: a.effectiveDueDate, dueKm: a.nextDueKm, state, urgency: urgencyOf(state) + statusUrgency(a.status), assignmentId: a.id, actionUrl: `/service-history/new?assignmentId=${a.id}`, basis: a.estimateBasis });
    }
    const dateItem = (kind: UpcomingKind, key: string, title: string, date: IsoDate | null, url: string, maxPast = 120) => {
      if (!date) return;
      const d = diffDays(date, today);
      if (d > horizon || d < -maxPast) return;
      const state = stateOf(d);
      out.push({ key, kind, vehicleId: v.id, vehicleName: name, title, summary: d < 0 ? `Expired ${humanizeDays(d)} ago (${date})` : d === 0 ? `Today (${date})` : `In ${humanizeDays(d)} (${date})`, dueDate: date, dueKm: null, state, urgency: urgencyOf(state), actionUrl: url });
    };
    dateItem("registration", `reg:${v.id}`, "Registration expiry", iso(v.registrationExpiryDate), `/vehicles/${v.id}?tab=overview`);
    dateItem("insurance", `ins:${v.id}`, "Insurance renewal", iso(v.insuranceRenewalDate), `/vehicles/${v.id}?tab=overview`);
    dateItem("inspection", `insp:${v.id}`, "Inspection due", iso(v.nextInspectionDate), `/vehicles/${v.id}?tab=inspections`);
    const [ws, ps, docs, rems, issues] = await Promise.all([
      db.warranty.findMany({ where: { vehicleId: v.id, deletedAt: null, endDate: { not: null } } }),
      db.part.findMany({ where: { vehicleId: v.id, deletedAt: null, warrantyEnd: { not: null } } }),
      db.document.findMany({ where: { vehicleId: v.id, deletedAt: null, expiresOn: { not: null } } }),
      db.reminder.findMany({ where: { vehicleId: v.id, status: "ACTIVE" } }),
      db.repairIssue.findMany({ where: { vehicleId: v.id, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED", "MONITORING"] }, severity: { in: ["HIGH", "CRITICAL"] } } }),
    ]);
    for (const w of ws) dateItem("warranty", `war:${w.id}`, `Warranty: ${w.name}`, iso(w.endDate), `/vehicles/${v.id}?tab=warranty`, 30);
    for (const p of ps) dateItem("warranty", `pwar:${p.id}`, `Part warranty: ${p.name}`, iso(p.warrantyEnd), `/parts?part=${p.id}`, 30);
    for (const d of docs) dateItem("document", `doc:${d.id}`, `Document expires: ${d.title}`, iso(d.expiresOn), `/documents?doc=${d.id}`, 30);
    for (const r of rems) {
      const dueDate = iso(r.dueDate);
      const cur = num(v.currentOdometerKm);
      if (dueDate) dateItem("custom", `rem:${r.id}`, r.title, dueDate, `/reminders`, 365);
      if (r.dueKm !== null && cur !== null) {
        const rem = Number(r.dueKm) - cur;
        if (rem <= (bundle.usage.avgDailyKm ?? 40) * horizon) {
          const st: UpcomingItem["state"] = rem < 0 ? "overdue" : rem <= 200 ? "due" : rem <= 1000 ? "soon" : "upcoming";
          out.push({ key: `remkm:${r.id}`, kind: "custom", vehicleId: v.id, vehicleName: name, title: r.title, summary: rem < 0 ? `${formatDistance(-rem, unit)} past ${formatDistance(Number(r.dueKm), unit)}` : `In ${formatDistance(rem, unit)} (at ${formatDistance(Number(r.dueKm), unit)})`, dueDate: null, dueKm: Number(r.dueKm), state: st, urgency: urgencyOf(st), reminderId: r.id, actionUrl: `/reminders` });
        }
      }
    }
    for (const i of issues) out.push({ key: `issue:${i.id}`, kind: "repair", vehicleId: v.id, vehicleName: name, title: `Open ${i.severity.toLowerCase()} issue: ${i.title}`, summary: `Reported ${iso(i.discoveredAt)} - ${i.status.toLowerCase().replace("_", " ")}`, dueDate: null, dueKm: null, state: i.severity === "CRITICAL" ? "overdue" : "due", urgency: i.severity === "CRITICAL" ? 95 : 75, actionUrl: `/repairs?issue=${i.id}` });
  }
  return out.sort((a, b) => b.urgency - a.urgency || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}
