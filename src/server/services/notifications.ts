import webpush from "web-push";
import { db } from "@/lib/db";
import { env, pushEnabled } from "@/lib/env";
import { logger } from "@/lib/logger";
import { diffDays, todayInTz, dateToIso } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { notificationMessage, sendEmail } from "@/lib/email";
import { notFound } from "@/lib/errors";
import { pushSubSchema } from "@/lib/validation";
import type { z } from "zod";
import type { Actor, Prefs } from "../context";
import { prefsFromRow } from "../context";
import { budgetAlert, dateAlert, maintenanceAlert, type AlertCandidate } from "../engine/alerts";
import { budgetPeriod, budgetStatus } from "../engine/costs";
import { evaluateRule } from "../engine/schedule";
import { fromCents, toCents } from "@/lib/money";
import { isoToDate } from "@/lib/dates";
import { ts } from "../serialize";
import { toRule, vehicleUsage } from "./schedules";

// ───────────── generation

async function recipientsFor(vehicleId: string, householdId: string) {
  const [admins, grants] = await Promise.all([
    db.householdMember.findMany({ where: { householdId, role: "ADMIN" }, include: { user: { include: { preference: true } } } }),
    db.vehicleAccess.findMany({ where: { vehicleId }, include: { user: { include: { preference: true } } } }),
  ]);
  const map = new Map<string, { user: (typeof admins)[number]["user"]; role: "ADMIN" | "MEMBER"; level: any; fin: boolean }>();
  for (const a of admins) map.set(a.userId, { user: a.user, role: "ADMIN", level: null, fin: true });
  for (const g of grants) {
    const member = await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId: g.userId } } });
    if (!member) continue; // grant without membership has no access
    const prev = map.get(g.userId);
    map.set(g.userId, { user: g.user, role: member.role, level: g.level, fin: prev?.fin || can({ householdRole: member.role, vehicleLevel: g.level, canViewFinancials: g.canViewFinancials }, "viewFinancials") });
  }
  return [...map.values()].filter((r) => !r.user.disabledAt && !r.user.deletedAt);
}

export interface GenerationResult {
  vehicles: number;
  candidates: number;
  created: number;
}

/**
 * Evaluates every vehicle and creates any notifications that are newly warranted. Idempotent: the unique
 * (userId, dedupeKey) constraint means re-running never duplicates. Runs from the scheduler — it does not depend on
 * anyone opening the app.
 */
export async function generateNotifications(now: Date = new Date()): Promise<GenerationResult> {
  const vehicles = await db.vehicle.findMany({ where: { deletedAt: null, household: { deletedAt: null } } });
  let candidates = 0;
  let created = 0;
  for (const v of vehicles) {
    const recipients = await recipientsFor(v.id, v.householdId);
    if (!recipients.length) continue;
    const { usage, readings } = await vehicleUsage(db, v.id);
    const assignments = await db.maintenanceScheduleAssignment.findMany({ where: { vehicleId: v.id, deletedAt: null, enabled: true } });
    const [ws, ps, docs, rems, issues, budgets] = await Promise.all([
      db.warranty.findMany({ where: { vehicleId: v.id, deletedAt: null, endDate: { not: null } } }),
      db.part.findMany({ where: { vehicleId: v.id, deletedAt: null, warrantyEnd: { not: null } } }),
      db.document.findMany({ where: { vehicleId: v.id, deletedAt: null, expiresOn: { not: null } } }),
      db.reminder.findMany({ where: { vehicleId: v.id, status: "ACTIVE" } }),
      db.repairIssue.findMany({ where: { vehicleId: v.id, deletedAt: null, status: { notIn: ["RESOLVED", "CLOSED", "MONITORING"] } } }),
      db.budget.findMany({ where: { deletedAt: null, householdId: v.householdId, OR: [{ vehicleId: v.id }, { vehicleId: null }] } }),
    ]);
    const currentKm = v.currentOdometerKm !== null ? Number(v.currentOdometerKm) : null;
    const currentKmDate = dateToIso(v.currentOdometerAt) ?? readings.at(-1)?.date ?? null;

    for (const r of recipients) {
      const prefs: Prefs = prefsFromRow(r.user.preference);
      if (!prefs.notifyInApp && !prefs.notifyEmail && !prefs.notifyPush) continue;
      const today = todayInTz(prefs.timezone, now);
      const out: AlertCandidate[] = [];
      for (const a of assignments) {
        const ev = evaluateRule(toRule(a), { currentKm, currentKmDate, today, avgDailyKm: usage.avgDailyKm, thresholds: prefs.thresholds });
        const c = maintenanceAlert({ assignmentId: a.id, vehicleId: v.id, vehicleName: v.nickname, itemName: a.name, evaluation: ev, prefs, override: { km: a.alertKmBefore, days: a.alertDaysBefore }, unit: prefs.distanceUnit });
        if (c) out.push(c);
      }
      const name = v.nickname;
      const push = (c: AlertCandidate | null) => c && out.push(c);
      if (v.registrationExpiryDate) push(dateAlert({ kind: "REGISTRATION_EXPIRING", id: v.id, label: "Registration", vehicleId: v.id, vehicleName: name, date: dateToIso(v.registrationExpiryDate) as string, today, leadDays: [30, 7], actionUrl: `/vehicles/${v.id}` }));
      if (v.insuranceRenewalDate) push(dateAlert({ kind: "INSURANCE_RENEWAL", id: v.id, label: "Insurance", vehicleId: v.id, vehicleName: name, date: dateToIso(v.insuranceRenewalDate) as string, today, leadDays: [30, 7], actionUrl: `/vehicles/${v.id}` }));
      if (v.nextInspectionDate) push(dateAlert({ kind: "INSPECTION_DUE", id: v.id, label: "Inspection", vehicleId: v.id, vehicleName: name, date: dateToIso(v.nextInspectionDate) as string, today, leadDays: [30, 7], actionUrl: `/vehicles/${v.id}?tab=inspections` }));
      for (const w of ws) push(dateAlert({ kind: "WARRANTY_EXPIRING", id: w.id, label: w.name, vehicleId: v.id, vehicleName: name, date: dateToIso(w.endDate) as string, today, leadDays: [60, 30, 7], actionUrl: `/vehicles/${v.id}?tab=warranty` }));
      for (const p of ps) push(dateAlert({ kind: "WARRANTY_EXPIRING", id: p.id, label: `${p.name} (part)`, vehicleId: v.id, vehicleName: name, date: dateToIso(p.warrantyEnd) as string, today, leadDays: [30, 7], actionUrl: `/parts?part=${p.id}` }));
      for (const d of docs) push(dateAlert({ kind: "DOCUMENT_EXPIRING", id: d.id, label: d.title, vehicleId: v.id, vehicleName: name, date: dateToIso(d.expiresOn) as string, today, leadDays: [30, 7], actionUrl: `/documents?doc=${d.id}` }));
      for (const rm of rems) {
        if (rm.dueDate) push(dateAlert({ kind: "CUSTOM_REMINDER", id: rm.id, label: rm.title, vehicleId: v.id, vehicleName: name, date: dateToIso(rm.dueDate) as string, today, leadDays: rm.leadDays, actionUrl: "/reminders" }));
        if (rm.dueKm !== null && currentKm !== null) {
          const remaining = Number(rm.dueKm) - currentKm;
          const leads = [...rm.leadKm].sort((a, b) => a - b);
          const stage = remaining <= 0 ? "reached" : leads.find((l) => remaining <= l);
          if (stage !== undefined) out.push({ type: "CUSTOM_REMINDER", severity: remaining <= 0 ? "WARNING" : "INFO", title: rm.title, body: `${name}: odometer target ${Math.round(Number(rm.dueKm))} km ${remaining <= 0 ? "reached" : `in ${Math.round(remaining)} km`}.`, vehicleId: v.id, actionUrl: "/reminders", dedupeKey: `CUSTOM_REMINDER_KM:${rm.id}:${stage}` });
        }
      }
      const week = `${now.getUTCFullYear()}-W${String(Math.ceil((diffDays(today, `${today.slice(0, 4)}-01-01`) + 1) / 7)).padStart(2, "0")}`;
      for (const i of issues) {
        if (i.severity === "CRITICAL" || i.severity === "HIGH") {
          const age = diffDays(today, dateToIso(i.discoveredAt) as string);
          if (i.severity === "CRITICAL" || age >= 7) out.push({ type: "REPAIR_OUTSTANDING", severity: i.severity === "CRITICAL" ? "CRITICAL" : "WARNING", title: `Outstanding ${i.severity.toLowerCase()} issue: ${i.title}`, body: `${name}: reported ${dateToIso(i.discoveredAt)}, status ${i.status.toLowerCase().replace("_", " ")}.`, vehicleId: v.id, actionUrl: `/repairs?issue=${i.id}`, dedupeKey: `issue:${i.id}:${week}` });
        }
      }
      if (r.fin) {
        for (const b of budgets) {
          const { start, end } = budgetPeriod(b.period, b.year, b.month);
          if (today < start || today > end) continue;
          const scopeIds = b.vehicleId ? [b.vehicleId] : (await db.vehicle.findMany({ where: { householdId: b.householdId, deletedAt: null }, select: { id: true } })).map((x) => x.id);
          const rows = await db.expense.findMany({ where: { vehicleId: { in: scopeIds }, deletedAt: null, category: { in: b.categories }, date: { gte: isoToDate(start), lte: isoToDate(end) } }, select: { amount: true } });
          const actual = fromCents(rows.reduce((a, x) => a + toCents(Number(x.amount)), 0));
          const st = budgetStatus({ amount: Number(b.amount), actual, periodStart: start, periodEnd: end, today });
          const label = b.vehicleId ? v.nickname : "Household";
          const alert = budgetAlert({ budgetId: b.id, label: `${label} ${b.period.toLowerCase()} ${b.year}${b.month ? `-${String(b.month).padStart(2, "0")}` : ""}`, vehicleId: v.id, periodKey: `${b.year}-${b.month ?? 0}`, utilizationPct: st.utilizationPct, thresholds: b.alertAtPercent, actual, amount: Number(b.amount), currencyFmt: (n) => formatMoney(n, b.currency) });
          if (alert && (b.vehicleId || scopeIds[0] === v.id)) push(alert);
        }
      }
      candidates += out.length;
      if (!out.length) continue;
      const res = await db.notification.createMany({
        data: out.map((c) => ({ userId: r.user.id, vehicleId: c.vehicleId, type: c.type, severity: c.severity, title: c.title, body: c.body, actionUrl: c.actionUrl, dedupeKey: c.dedupeKey, deliveredInAppAt: prefs.notifyInApp ? now : null })),
        skipDuplicates: true,
      });
      created += res.count;
    }
  }
  return { vehicles: vehicles.length, candidates, created };
}

// ───────────── delivery (email + push)

let vapidReady = false;
function initPush() {
  if (!pushEnabled()) return false;
  if (!vapidReady) {
    const e = env();
    webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY as string, e.VAPID_PRIVATE_KEY as string);
    vapidReady = true;
  }
  return true;
}

export async function deliverPending(limit = 100) {
  const since = new Date(Date.now() - 3 * 86400_000);
  const rows = await db.notification.findMany({ where: { createdAt: { gt: since }, dismissedAt: null, OR: [{ emailedAt: null }, { pushedAt: null }] }, include: { user: { include: { preference: true, pushSubs: true } } }, orderBy: { createdAt: "asc" }, take: limit });
  let emails = 0;
  let pushes = 0;
  const canPush = initPush();
  for (const n of rows) {
    const prefs = prefsFromRow(n.user.preference);
    if (!n.emailedAt && prefs.notifyEmail && n.user.emailVerifiedAt) {
      const m = notificationMessage(n.title, n.body, n.actionUrl);
      await sendEmail(n.user.email, m.subject, m.text, m.html);
      await db.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
      emails++;
    }
    if (!n.pushedAt && prefs.notifyPush && canPush && n.user.pushSubs.length) {
      for (const sub of n.user.pushSubs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: n.title, body: n.body, url: n.actionUrl ?? "/dashboard", tag: n.id }));
          pushes++;
        } catch (e: any) {
          if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          else logger.warn({ err: e.message }, "web push failed");
        }
      }
      await db.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } });
    }
  }
  return { emails, pushes };
}

// ───────────── inbox

export function notificationView(n: Awaited<ReturnType<typeof db.notification.findFirstOrThrow>>) {
  return { id: n.id, vehicleId: n.vehicleId, type: n.type, severity: n.severity, title: n.title, body: n.body, actionUrl: n.actionUrl, createdAt: ts(n.createdAt), read: !!n.readAt, dismissed: !!n.dismissedAt, actioned: !!n.actionedAt, delivery: { inApp: !!n.deliveredInAppAt, email: !!n.emailedAt, push: !!n.pushedAt } };
}

export async function listNotifications(actor: Actor, q: { unread?: boolean; includeDismissed?: boolean; page?: number; pageSize?: number } = {}) {
  const where = { userId: actor.id, ...(q.includeDismissed ? {} : { dismissedAt: null }), ...(q.unread ? { readAt: null } : {}), deliveredInAppAt: { not: null } } as const;
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, q.pageSize ?? 30);
  const [total, unread, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.count({ where: { userId: actor.id, readAt: null, dismissedAt: null, deliveredInAppAt: { not: null } } }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(notificationView), page, pageSize, total, unread };
}

export async function updateNotifications(actor: Actor, input: { ids?: string[]; all?: boolean; action: "read" | "dismiss" | "actioned" }) {
  const where = input.all ? { userId: actor.id } : { userId: actor.id, id: { in: input.ids ?? [] } };
  const now = new Date();
  const data = input.action === "read" ? { readAt: now } : input.action === "dismiss" ? { dismissedAt: now, readAt: now } : { actionedAt: now, readAt: now };
  const res = await db.notification.updateMany({ where: { ...where, ...(input.action === "read" ? { readAt: null } : {}) }, data });
  return { updated: res.count };
}

export async function savePushSubscription(actor: Actor, input: z.infer<typeof pushSubSchema>, userAgent?: string | null) {
  const s = await db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { userId: actor.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null }, update: { userId: actor.id, p256dh: input.keys.p256dh, auth: input.keys.auth } });
  return { id: s.id };
}
export async function removePushSubscription(actor: Actor, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: actor.id } });
  return { ok: true };
}
export async function deleteNotification(actor: Actor, id: string) {
  const n = await db.notification.findFirst({ where: { id, userId: actor.id } });
  if (!n) throw notFound("Notification");
  await db.notification.delete({ where: { id } });
  return { ok: true };
}
