// Financial calendar: obligations derived from every module plus custom events.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money } from "./engine/decimal";
import { occurrences, type Frequency } from "./engine/frequency";
import { addDays, addMonths } from "./engine/dates";
import { sortObligations, type Obligation } from "./engine/obligations";
import { dateIso, id, isoDate, optText, text, toDate } from "./common";
import { metaView, newRecordMeta, requireVisible, requireWriter, updateRecordMeta, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { billOccurrences } from "./bills";

export const eventSchema = z.object({ title: text(120), date: isoDate, endDate: isoDate.nullish(), notes: optText(500), assignToMemberId: id.nullish(), ...visibilityFields });
export const eventPatchSchema = eventSchema.partial().extend({ completed: z.boolean().optional() });

export async function obligations(ctx: FinCtx, from: string, to: string, view: View | "all" = "all"): Promise<Obligation[]> {
  const w = { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) };
  const [income, bills, subs, ins, debts, goals, rules, events] = await Promise.all([
    db.incomeSource.findMany({ where: { ...w, active: true } }),
    billOccurrences(ctx, from, to, view),
    db.recurringSubscription.findMany({ where: { ...w, active: true } }),
    db.insurancePolicy.findMany({ where: { ...w, active: true } }),
    db.debt.findMany({ where: { ...w, active: true }, include: { account: { select: { name: true } } } }),
    db.savingsGoal.findMany({ where: { ...w, status: "ACTIVE" } }),
    db.recurringRule.findMany({ where: { ...w, active: true } }),
    db.calendarEvent.findMany({ where: { ...w, date: { lte: toDate(to) }, OR: [{ endDate: null, date: { gte: toDate(from) } }, { endDate: { gte: toDate(from) } }] } }),
  ]);
  const out: Obligation[] = [];
  for (const s of income) {
    if (!s.nextPayDate || s.frequency === "IRREGULAR") continue;
    for (const d of occurrences(s.frequency as Frequency, dateIso(s.nextPayDate)!, from, to, dateIso(s.endDate))) out.push({ key: `inc:${s.id}:${d}`, date: d, kind: "INCOME", title: s.name, amount: money(s.netAmount), direction: "in", sourceType: "income", sourceId: s.id, ownerMemberId: s.ownerMemberId });
  }
  for (const b of bills) out.push({ key: `bill:${b.billId}:${b.date}`, date: b.date, kind: "BILL", title: b.name, amount: b.amount, direction: "out", sourceType: "bill", sourceId: b.billId, status: b.status, ownerMemberId: b.ownerMemberId, completed: b.status === "PAID" });
  for (const s of subs) for (const d of occurrences(s.frequency as Frequency, dateIso(s.nextBillingDate)!, from, to)) out.push({ key: `sub:${s.id}:${d}`, date: d, kind: "SUBSCRIPTION", title: s.name, amount: money(s.amount), direction: "out", sourceType: "subscription", sourceId: s.id, ownerMemberId: s.ownerMemberId });
  for (const p of ins) {
    if (p.renewalDate) for (const d of occurrences(p.frequency as Frequency, dateIso(p.renewalDate)!, from, to)) out.push({ key: `ins:${p.id}:${d}`, date: d, kind: "INSURANCE", title: `${p.policyName} premium`, amount: money(p.premium), direction: "out", sourceType: "insurance", sourceId: p.id, ownerMemberId: p.ownerMemberId });
    if (p.renewalDate && dateIso(p.renewalDate)! >= from && dateIso(p.renewalDate)! <= to) out.push({ key: `insren:${p.id}`, date: dateIso(p.renewalDate)!, kind: "INSURANCE_RENEWAL", title: `${p.policyName} renews`, amount: null, direction: "neutral", sourceType: "insurance", sourceId: p.id, ownerMemberId: p.ownerMemberId });
  }
  for (const d of debts) {
    const pay = D(d.regularPayment).gt(0) ? d.regularPayment : d.minimumPayment;
    if (!d.nextDueDate || D(pay).lte(0)) continue;
    const kind = d.type === "MORTGAGE" ? "MORTGAGE" : d.type === "CREDIT_CARD" ? "CREDIT_CARD" : "LOAN";
    for (const day of occurrences(d.frequency as Frequency, dateIso(d.nextDueDate)!, from, to)) out.push({ key: `debt:${d.id}:${day}`, date: day, kind, title: `${d.lender} payment`, amount: money(pay), direction: "out", sourceType: "debt", sourceId: d.id, ownerMemberId: d.ownerMemberId });
  }
  for (const g of goals) {
    if (D(g.monthlyContribution).gt(0)) for (const day of occurrences("MONTHLY", `${addMonths(from, 0).slice(0, 7)}-01`, from, to)) out.push({ key: `goal:${g.id}:${day}`, date: day, kind: "SAVINGS", title: `Save for ${g.name}`, amount: money(g.monthlyContribution), direction: "neutral", sourceType: "goal", sourceId: g.id, ownerMemberId: g.ownerMemberId });
    if (g.targetDate && dateIso(g.targetDate)! >= from && dateIso(g.targetDate)! <= to) out.push({ key: `goaldate:${g.id}`, date: dateIso(g.targetDate)!, kind: "GOAL", title: `Goal date: ${g.name}`, amount: money(g.targetAmount), direction: "neutral", sourceType: "goal", sourceId: g.id, ownerMemberId: g.ownerMemberId });
  }
  for (const r of rules) for (const d of occurrences(r.frequency as Frequency, dateIso(r.startDate)!, r.lastPostedOn ? addDays(dateIso(r.lastPostedOn)!, 1) > from ? addDays(dateIso(r.lastPostedOn)!, 1) : from : from, to, dateIso(r.endDate))) out.push({ key: `rec:${r.id}:${d}`, date: d, kind: "RECURRING", title: r.description, amount: money(r.amount), direction: r.type === "INCOME" ? "in" : r.type === "EXPENSE" ? "out" : "neutral", sourceType: "recurring", sourceId: r.id, ownerMemberId: r.ownerMemberId });
  for (const e of events) out.push({ key: `evt:${e.id}`, date: dateIso(e.date)!, kind: "CUSTOM", title: e.title, amount: null, direction: "neutral", sourceType: "event", sourceId: e.id, ownerMemberId: e.ownerMemberId, completed: !!e.completedAt, note: e.notes });
  return sortObligations(out.filter((o) => o.date >= from && o.date <= to));
}

export async function listEvents(ctx: FinCtx, from?: string, to?: string) {
  const rows = await db.calendarEvent.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, "all"), ...(from && to ? { date: { gte: toDate(from), lte: toDate(to) } } : {}) }, orderBy: { date: "asc" } });
  return rows.map((e) => ({ id: e.id, title: e.title, date: dateIso(e.date), endDate: dateIso(e.endDate), notes: e.notes, completed: !!e.completedAt, ...metaView(ctx, e) }));
}
export async function createEvent(ctx: FinCtx, input: z.infer<typeof eventSchema>) {
  requireWriter(ctx);
  const e = await db.calendarEvent.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), title: input.title, date: toDate(input.date), endDate: input.endDate ? toDate(input.endDate) : null, notes: input.notes ?? null } });
  return { id: e.id };
}
export async function updateEvent(ctx: FinCtx, eventId: string, patch: z.infer<typeof eventPatchSchema>) {
  requireWriter(ctx);
  const e = requireVisible(ctx, await db.calendarEvent.findUnique({ where: { id: eventId } }), "Event", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, e, patch, "other");
  if (patch.title) data.title = patch.title;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.date) data.date = toDate(patch.date);
  if (patch.endDate !== undefined) data.endDate = patch.endDate ? toDate(patch.endDate) : null;
  if (patch.completed !== undefined) data.completedAt = patch.completed ? new Date() : null;
  await db.calendarEvent.update({ where: { id: e.id }, data });
  return { id: e.id };
}
export async function deleteEvent(ctx: FinCtx, eventId: string) {
  requireWriter(ctx);
  const e = requireVisible(ctx, await db.calendarEvent.findUnique({ where: { id: eventId } }), "Event", { write: true });
  await db.calendarEvent.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
export { AppError };
