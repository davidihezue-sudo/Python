// Bills, subscriptions, insurance and recurring rules: scheduled obligations that feed the calendar, alerts and forecasts.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { monthlyAmount, annualAmount, nextOccurrence, occurrences, type Frequency } from "./engine/frequency";
import { addDays, addMonths, diffDays } from "./engine/dates";
import { billStatus, outstanding } from "./engine/obligations";
import { audit } from "../services/audit";
import { currencyCode, dateIso, frequency, id, isoDate, moneyIn, nonNegMoney, optText, posMoney, text, toDate } from "./common";
import { metaView, newRecordMeta, requireAccount, requireInHousehold, requireVisible, requireWriter, updateRecordMeta, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { createTransaction } from "./transactions";

const meta = { assignToMemberId: id.nullish(), ...visibilityFields };

// ───────────────────────── Bills
export const BILL_KINDS = ["ELECTRICITY", "NATURAL_GAS", "WATER", "INTERNET", "PHONE", "MORTGAGE", "RENT", "INSURANCE", "LOAN", "CREDIT_CARD", "SUBSCRIPTION", "PROPERTY_TAX", "OTHER"] as const;
export const billSchema = z.object({
  name: text(100), provider: optText(100), kind: z.enum(BILL_KINDS).default("OTHER"), amount: nonNegMoney, currency: currencyCode.optional(), frequency: frequency.default("MONTHLY"), dueDate: isoDate, endDate: isoDate.nullish(),
  accountId: id.nullish(), categoryId: id.nullish(), responsibleMemberId: id.nullish(), reminderDays: z.array(z.number().int().min(0).max(60)).max(6).default([3]), autopay: z.boolean().default(false), notes: optText(1000), ...meta,
});
export const billPatchSchema = billSchema.partial().extend({ active: z.boolean().optional() });
export const billPaySchema = z.object({ dueDate: isoDate, amount: posMoney, paidOn: isoDate, accountId: id.optional(), payerMemberId: id.nullish(), notes: optText(300) });

type BillRow = Awaited<ReturnType<typeof db.bill.findFirstOrThrow>>;
async function paidMap(billIds: string[]) {
  const rows = await db.billPayment.findMany({ where: { billId: { in: billIds } } });
  const m = new Map<string, Dec>();
  for (const r of rows) m.set(`${r.billId}|${dateIso(r.dueDate)}`, (m.get(`${r.billId}|${dateIso(r.dueDate)}`) ?? ZERO).plus(D(r.amount)));
  return m;
}
const billOcc = (b: BillRow, from: string, to: string) => occurrences(b.frequency as Frequency, dateIso(b.dueDate) as string, from, to, dateIso(b.endDate));

export async function listBills(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.bill.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ active: "desc" }, { dueDate: "asc" }] });
  const paid = await paidMap(rows.map((r) => r.id));
  const lastPays = await db.billPayment.findMany({ where: { billId: { in: rows.map((r) => r.id) } }, orderBy: { paidOn: "desc" } });
  return rows.map((b) => {
    const freq = b.frequency as Frequency;
    // the occurrence to show: the oldest unpaid occurrence in the last 60 days, otherwise the next one
    const recent = billOcc(b, addDays(ctx.today, -60), addDays(ctx.today, 400));
    const pick = recent.find((d) => outstanding(b.amount.toString(), paid.get(`${b.id}|${d}`) ?? ZERO).gt(0)) ?? recent[recent.length - 1] ?? (dateIso(b.dueDate) as string);
    const paidAmt = paid.get(`${b.id}|${pick}`) ?? ZERO;
    const status = billStatus({ amount: b.amount.toString(), paid: paidAmt, dueDate: pick, today: ctx.today, leadDays: Math.max(...(b.reminderDays.length ? b.reminderDays : [3])) });
    return { id: b.id, name: b.name, provider: b.provider, kind: b.kind, amount: money(b.amount), currency: b.currency, frequency: b.frequency, dueDate: dateIso(b.dueDate), endDate: dateIso(b.endDate), accountId: b.accountId, categoryId: b.categoryId, responsibleMember: b.responsibleMemberId ? ctx.members.find((m) => m.id === b.responsibleMemberId)?.name ?? null : null, responsibleMemberId: b.responsibleMemberId, reminderDays: b.reminderDays, autopay: b.autopay, notes: b.notes, active: b.active, monthlyEquivalent: monthlyAmount(b.amount.toString(), freq) ? money(monthlyAmount(b.amount.toString(), freq) as Dec) : null, currentDue: pick, currentStatus: status, paidThisOccurrence: money(paidAmt), remaining: money(outstanding(b.amount.toString(), paidAmt)), lastPaidOn: dateIso(lastPays.find((p) => p.billId === b.id)?.paidOn), ...metaView(ctx, b) };
  });
}
export async function createBill(ctx: FinCtx, input: z.infer<typeof billSchema>) {
  requireWriter(ctx);
  if (input.accountId) await requireAccount(ctx, input.accountId);
  const b = await db.bill.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), name: input.name, provider: input.provider ?? null, kind: input.kind, amount: input.amount, currency: input.currency ?? ctx.base, frequency: input.frequency, dueDate: toDate(input.dueDate), endDate: input.endDate ? toDate(input.endDate) : null, accountId: input.accountId ?? null, categoryId: input.categoryId ?? null, responsibleMemberId: input.responsibleMemberId ?? null, reminderDays: input.reminderDays, autopay: input.autopay, notes: input.notes ?? null } });
  await audit(null, ctx.actor, { entity: "Bill", entityId: b.id, action: "create", householdId: ctx.householdId, after: { name: b.name, amount: money(b.amount) } });
  return { id: b.id };
}
export async function updateBill(ctx: FinCtx, billId: string, patch: z.infer<typeof billPatchSchema>) {
  requireWriter(ctx);
  const b = requireVisible(ctx, await db.bill.findUnique({ where: { id: billId } }), "Bill", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, b, patch, "other");
  for (const k of ["name", "provider", "kind", "amount", "currency", "frequency", "accountId", "categoryId", "responsibleMemberId", "reminderDays", "autopay", "notes", "active"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.dueDate) data.dueDate = toDate(patch.dueDate);
  if (patch.endDate !== undefined) data.endDate = patch.endDate ? toDate(patch.endDate) : null;
  await db.bill.update({ where: { id: b.id }, data });
  await audit(null, ctx.actor, { entity: "Bill", entityId: b.id, action: "update", householdId: ctx.householdId, before: { amount: money(b.amount) }, after: patch });
  return { id: b.id };
}
export async function deleteBill(ctx: FinCtx, billId: string) {
  requireWriter(ctx);
  const b = requireVisible(ctx, await db.bill.findUnique({ where: { id: billId } }), "Bill", { write: true });
  await db.bill.update({ where: { id: b.id }, data: { deletedAt: new Date(), active: false, updatedById: ctx.actor.id } });
  await audit(null, ctx.actor, { entity: "Bill", entityId: b.id, action: "delete", householdId: ctx.householdId });
  return { ok: true };
}

/**
 * Pays (all or part of) one occurrence of a bill. This creates the expense once, attributed to the payer, allocated to the household
 * for shared bills and to the owner for personal ones. A payment for a bill never creates a second expense elsewhere.
 */
export async function payBill(ctx: FinCtx, billId: string, input: z.infer<typeof billPaySchema>) {
  requireWriter(ctx);
  const b = requireVisible(ctx, await db.bill.findUnique({ where: { id: billId } }), "Bill", { write: true });
  const accountId = input.accountId ?? b.accountId;
  if (!accountId) throw new AppError("VALIDATION_ERROR", "Choose the account used to pay", { fieldErrors: { accountId: ["Required"] } });
  if (!billOcc(b, input.dueDate, input.dueDate).length && dateIso(b.dueDate) !== input.dueDate) throw new AppError("VALIDATION_ERROR", "That is not a due date for this bill", { fieldErrors: { dueDate: ["Not a due date for this bill"] } });
  const already = (await paidMap([b.id])).get(`${b.id}|${input.dueDate}`) ?? ZERO;
  if (already.plus(D(input.amount)).gt(D(b.amount).plus(0.004)) && D(b.amount).gt(0)) throw conflict(`This would pay more than the bill amount (${money(b.amount)}). ${money(outstanding(b.amount.toString(), already))} remains for this due date.`);
  const payer = input.payerMemberId === undefined ? ctx.me.id : input.payerMemberId;
  const shared = b.visibility !== "PERSONAL";
  const res = await createTransaction(ctx, { type: "EXPENSE", accountId, amount: input.amount, date: input.paidOn, description: `${b.name}${b.provider ? ` (${b.provider})` : ""}`, categoryId: b.categoryId, merchant: b.provider, notes: input.notes ?? null, status: "POSTED", payer: payer ?? "HOUSEHOLD", allocation: shared ? { mode: "HOUSEHOLD" } : { mode: "OWNER" }, visibility: b.visibility, sharedWithMemberIds: b.sharedWithMemberIds, force: true } as never);
  await db.$transaction(async (tx) => {
    await tx.finTransaction.update({ where: { id: res.id }, data: { billId: b.id } });
    await tx.billPayment.create({ data: { billId: b.id, dueDate: toDate(input.dueDate), amount: input.amount, paidOn: toDate(input.paidOn), memberId: payer ?? null, transactionId: res.id } });
  });
  await audit(null, ctx.actor, { entity: "Bill", entityId: b.id, action: "pay", householdId: ctx.householdId, after: { dueDate: input.dueDate, amount: input.amount, payer } });
  return { transactionId: res.id };
}

export async function billOccurrences(ctx: FinCtx, from: string, to: string, view: View | "all" = "all") {
  const rows = await db.bill.findMany({ where: { householdId: ctx.householdId, deletedAt: null, active: true, ...visWhere(ctx, view) } });
  const paid = await paidMap(rows.map((r) => r.id));
  const out: { billId: string; name: string; kind: string; date: string; amount: string; paid: string; status: string; ownerMemberId: string | null }[] = [];
  for (const b of rows) for (const d of billOcc(b, from, to)) {
    const p = paid.get(`${b.id}|${d}`) ?? ZERO;
    out.push({ billId: b.id, name: b.name, kind: b.kind, date: d, amount: money(b.amount), paid: money(p), status: billStatus({ amount: b.amount.toString(), paid: p, dueDate: d, today: ctx.today, leadDays: Math.max(...(b.reminderDays.length ? b.reminderDays : [3])) }), ownerMemberId: b.ownerMemberId });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ───────────────────────── Subscriptions
export const subscriptionSchema = z.object({
  name: text(100), provider: optText(100), category: z.string().max(40).default("Streaming"), amount: nonNegMoney, currency: currencyCode.optional(), frequency: frequency.default("MONTHLY"), nextBillingDate: isoDate, accountId: id.nullish(), categoryId: id.nullish(),
  cancellationInfo: optText(500), notes: optText(1000), ...meta,
});
export const subscriptionPatchSchema = subscriptionSchema.partial().extend({ active: z.boolean().optional(), markReviewed: z.boolean().optional() });
type SubRow = Awaited<ReturnType<typeof db.recurringSubscription.findFirstOrThrow>>;
export function subscriptionView(ctx: FinCtx, s: SubRow) {
  const f = s.frequency as Frequency;
  const mo = monthlyAmount(s.amount.toString(), f), yr = annualAmount(s.amount.toString(), f);
  const hist = ((s.priceHistory as { date: string; amount: string }[]) ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
  const increased = prev && D(s.amount).gt(D(prev.amount));
  const reviewBase = dateIso(s.lastReviewedAt) ?? dateIso(s.createdAt) as string;
  const daysSince = diffDays(ctx.today, reviewBase);
  return { id: s.id, name: s.name, provider: s.provider, category: s.category, amount: money(s.amount), currency: s.currency, frequency: s.frequency, nextBillingDate: dateIso(s.nextBillingDate), accountId: s.accountId, categoryId: s.categoryId, cancellationInfo: s.cancellationInfo, notes: s.notes, active: s.active, monthlyCost: mo ? money(mo) : null, annualCost: yr ? money(yr) : null, lastReviewedAt: dateIso(s.lastReviewedAt), priceHistory: hist, priceIncrease: increased && prev ? { from: prev.amount, to: money(s.amount), on: hist[hist.length - 1].date } : null, needsReview: s.active && daysSince > 180 && diffDays(ctx.today, dateIso(s.createdAt) as string) > 180 ? { daysSinceReview: daysSince } : null, ...metaView(ctx, s) };
}
export async function listSubscriptions(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.recurringSubscription.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ active: "desc" }, { nextBillingDate: "asc" }] });
  const items = rows.map((r) => subscriptionView(ctx, r));
  const active = items.filter((i) => i.active);
  const upcoming = active.filter((i) => i.nextBillingDate && diffDays(i.nextBillingDate, ctx.today) <= 30 && i.nextBillingDate >= ctx.today).map((i) => ({ id: i.id, name: i.name, date: i.nextBillingDate, amount: i.amount }));
  const sumM = active.reduce((a, i) => a.plus(D(i.monthlyCost)), ZERO), sumY = active.reduce((a, i) => a.plus(D(i.annualCost)), ZERO);
  return { items, totals: { monthly: money(sumM), annual: money(sumY), activeCount: active.length, currency: ctx.base, note: "Totals assume all subscriptions are in the household currency." }, upcoming, flagged: items.filter((i) => i.priceIncrease || i.needsReview).map((i) => ({ id: i.id, name: i.name, priceIncrease: i.priceIncrease, needsReview: i.needsReview })) };
}
export async function createSubscription(ctx: FinCtx, input: z.infer<typeof subscriptionSchema>) {
  requireWriter(ctx);
  if (input.accountId) await requireAccount(ctx, input.accountId);
  const s = await db.recurringSubscription.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), name: input.name, provider: input.provider ?? null, category: input.category, amount: input.amount, currency: input.currency ?? ctx.base, frequency: input.frequency, nextBillingDate: toDate(input.nextBillingDate), accountId: input.accountId ?? null, categoryId: input.categoryId ?? null, cancellationInfo: input.cancellationInfo ?? null, notes: input.notes ?? null, priceHistory: [{ date: ctx.today, amount: input.amount }] } });
  await audit(null, ctx.actor, { entity: "Subscription", entityId: s.id, action: "create", householdId: ctx.householdId });
  return { id: s.id };
}
export async function updateSubscription(ctx: FinCtx, subId: string, patch: z.infer<typeof subscriptionPatchSchema>) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.recurringSubscription.findUnique({ where: { id: subId } }), "Subscription", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, s, patch, "other");
  for (const k of ["name", "provider", "category", "amount", "currency", "frequency", "accountId", "categoryId", "cancellationInfo", "notes", "active"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.nextBillingDate) data.nextBillingDate = toDate(patch.nextBillingDate);
  if (patch.markReviewed) data.lastReviewedAt = toDate(ctx.today);
  if (patch.amount && !D(patch.amount).eq(D(s.amount))) data.priceHistory = [...((s.priceHistory as unknown[]) ?? []), { date: ctx.today, amount: patch.amount }];
  await db.recurringSubscription.update({ where: { id: s.id }, data });
  await audit(null, ctx.actor, { entity: "Subscription", entityId: s.id, action: "update", householdId: ctx.householdId, before: { amount: money(s.amount) }, after: patch });
  return { id: s.id };
}
export async function deleteSubscription(ctx: FinCtx, subId: string) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.recurringSubscription.findUnique({ where: { id: subId } }), "Subscription", { write: true });
  await db.recurringSubscription.update({ where: { id: s.id }, data: { deletedAt: new Date(), active: false, updatedById: ctx.actor.id } });
  return { ok: true };
}
export const subscriptionPaySchema = z.object({ date: isoDate, accountId: id.optional(), amount: posMoney.optional() });
/** Records the charge as one expense and advances the next billing date. */
export async function recordSubscriptionCharge(ctx: FinCtx, subId: string, input: z.infer<typeof subscriptionPaySchema>) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.recurringSubscription.findUnique({ where: { id: subId } }), "Subscription", { write: true });
  const accountId = input.accountId ?? s.accountId;
  if (!accountId) throw new AppError("VALIDATION_ERROR", "Choose the account that was charged", { fieldErrors: { accountId: ["Required"] } });
  const res = await createTransaction(ctx, { type: "EXPENSE", accountId, amount: input.amount ?? money(s.amount), date: input.date, description: s.name, categoryId: s.categoryId, merchant: s.provider ?? s.name, status: "POSTED", visibility: s.visibility, sharedWithMemberIds: s.sharedWithMemberIds, allocation: { mode: s.visibility === "PERSONAL" ? "OWNER" : "OWNER" }, force: true } as never);
  const next = nextOccurrence(s.frequency as Frequency, dateIso(s.nextBillingDate) as string, input.date);
  await db.$transaction([db.finTransaction.update({ where: { id: res.id }, data: { subscriptionId: s.id } }), ...(next ? [db.recurringSubscription.update({ where: { id: s.id }, data: { nextBillingDate: toDate(next) } })] : [])]);
  return { transactionId: res.id, nextBillingDate: next };
}

// ───────────────────────── Insurance
export const INSURANCE_KINDS = ["VEHICLE", "HOME", "TENANT", "LIFE", "DISABILITY", "HEALTH", "TRAVEL", "OTHER"] as const;
export const insuranceSchema = z.object({
  kind: z.enum(INSURANCE_KINDS), provider: text(100), policyName: text(100), policyNumberLast4: z.string().regex(/^\d{2,4}$/, "Enter only the last 2 to 4 digits").nullish(), insuredMemberIds: z.array(id).max(50).default([]),
  premium: nonNegMoney, currency: currencyCode.optional(), frequency: frequency.default("MONTHLY"), coverageAmount: nonNegMoney.nullish(), renewalDate: isoDate.nullish(), expiryDate: isoDate.nullish(), beneficiary: optText(200), accountId: id.nullish(), vehicleId: id.nullish(), notes: optText(1000), ...meta,
});
export const insurancePatchSchema = insuranceSchema.partial().extend({ active: z.boolean().optional() });
type InsRow = Awaited<ReturnType<typeof db.insurancePolicy.findFirstOrThrow>>;
export const insuranceView = (ctx: FinCtx, p: InsRow) => {
  const f = p.frequency as Frequency, mo = monthlyAmount(p.premium.toString(), f), yr = annualAmount(p.premium.toString(), f);
  const ren = dateIso(p.renewalDate);
  return { id: p.id, kind: p.kind, provider: p.provider, policyName: p.policyName, policyNumber: p.policyNumberLast4 ? `**** ${p.policyNumberLast4}` : null, policyNumberLast4: p.policyNumberLast4, insured: p.insuredMemberIds.map((m) => ctx.members.find((x) => x.id === m)?.name).filter(Boolean), insuredMemberIds: p.insuredMemberIds, premium: money(p.premium), currency: p.currency, frequency: p.frequency, coverageAmount: p.coverageAmount ? money(p.coverageAmount) : null, renewalDate: ren, expiryDate: dateIso(p.expiryDate), daysToRenewal: ren ? diffDays(ren, ctx.today) : null, beneficiary: p.beneficiary, accountId: p.accountId, vehicleId: p.vehicleId, notes: p.notes, active: p.active, monthlyCost: mo ? money(mo) : null, annualCost: yr ? money(yr) : null, ...metaView(ctx, p) };
};
export async function listInsurance(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.insurancePolicy.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ active: "desc" }, { renewalDate: "asc" }] });
  const items = rows.map((r) => insuranceView(ctx, r));
  const act = items.filter((i) => i.active);
  return { items, totals: { monthly: money(act.reduce((a, i) => a.plus(D(i.monthlyCost)), ZERO)), annual: money(act.reduce((a, i) => a.plus(D(i.annualCost)), ZERO)), currency: ctx.base }, renewingSoon: act.filter((i) => i.daysToRenewal !== null && i.daysToRenewal >= 0 && i.daysToRenewal <= 60).map((i) => ({ id: i.id, name: i.policyName, date: i.renewalDate, daysToRenewal: i.daysToRenewal })) };
}
export async function createInsurance(ctx: FinCtx, input: z.infer<typeof insuranceSchema>) {
  requireWriter(ctx);
  await (await import("./vehicles")).assertVehicleLink(ctx, input.vehicleId);
  if (input.accountId) await requireAccount(ctx, input.accountId);
  for (const m of input.insuredMemberIds) if (!ctx.members.some((x) => x.id === m)) throw new AppError("VALIDATION_ERROR", "Insured members must belong to this household");
  const p = await db.insurancePolicy.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), kind: input.kind, provider: input.provider, policyName: input.policyName, policyNumberLast4: input.policyNumberLast4 ?? null, insuredMemberIds: input.insuredMemberIds, premium: input.premium, currency: input.currency ?? ctx.base, frequency: input.frequency, coverageAmount: input.coverageAmount ?? null, renewalDate: input.renewalDate ? toDate(input.renewalDate) : null, expiryDate: input.expiryDate ? toDate(input.expiryDate) : null, beneficiary: input.beneficiary ?? null, accountId: input.accountId ?? null, vehicleId: input.vehicleId ?? null, notes: input.notes ?? null } });
  await audit(null, ctx.actor, { entity: "InsurancePolicy", entityId: p.id, action: "create", householdId: ctx.householdId });
  return { id: p.id };
}
export async function updateInsurance(ctx: FinCtx, polId: string, patch: z.infer<typeof insurancePatchSchema>) {
  requireWriter(ctx);
  const p = requireVisible(ctx, await db.insurancePolicy.findUnique({ where: { id: polId } }), "Policy", { write: true });
  if (patch.vehicleId) await (await import("./vehicles")).assertVehicleLink(ctx, patch.vehicleId);
  const data: Record<string, unknown> = updateRecordMeta(ctx, p, patch, "other");
  for (const k of ["kind", "provider", "policyName", "policyNumberLast4", "insuredMemberIds", "premium", "currency", "frequency", "coverageAmount", "beneficiary", "accountId", "vehicleId", "notes", "active"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  for (const k of ["renewalDate", "expiryDate"] as const) if (patch[k] !== undefined) data[k] = patch[k] ? toDate(patch[k] as string) : null;
  await db.insurancePolicy.update({ where: { id: p.id }, data });
  await audit(null, ctx.actor, { entity: "InsurancePolicy", entityId: p.id, action: "update", householdId: ctx.householdId, after: patch });
  return { id: p.id };
}
export async function deleteInsurance(ctx: FinCtx, polId: string) {
  requireWriter(ctx);
  const p = requireVisible(ctx, await db.insurancePolicy.findUnique({ where: { id: polId } }), "Policy", { write: true });
  await db.insurancePolicy.update({ where: { id: p.id }, data: { deletedAt: new Date(), active: false, updatedById: ctx.actor.id } });
  return { ok: true };
}

// ───────────────────────── Recurring rules (auto posted transactions)
export const recurringSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]), description: text(200), amount: posMoney, accountId: id, toAccountId: id.nullish(), categoryId: id.nullish(), merchantName: optText(100), frequency: frequency, startDate: isoDate, endDate: isoDate.nullish(), autoPost: z.boolean().default(false), lastPostedOn: isoDate.nullish(), notes: optText(500), ...meta,
});
export const recurringPatchSchema = recurringSchema.partial().extend({ active: z.boolean().optional() });
export async function listRecurring(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.recurringRule.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ active: "desc" }, { startDate: "asc" }] });
  return rows.map((r) => ({ id: r.id, type: r.type, description: r.description, amount: money(r.amount), accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, merchantName: r.merchantName, frequency: r.frequency, startDate: dateIso(r.startDate), endDate: dateIso(r.endDate), lastPostedOn: dateIso(r.lastPostedOn), nextDate: nextOccurrence(r.frequency as Frequency, dateIso(r.startDate) as string, dateIso(r.lastPostedOn) ?? addDays(dateIso(r.startDate) as string, -1), { end: dateIso(r.endDate) }), autoPost: r.autoPost, active: r.active, notes: r.notes, ...metaView(ctx, r) }));
}
export async function createRecurring(ctx: FinCtx, input: z.infer<typeof recurringSchema>) {
  requireWriter(ctx);
  await requireAccount(ctx, input.accountId, { write: true });
  if (input.type === "TRANSFER" && !input.toAccountId) throw new AppError("VALIDATION_ERROR", "Choose the account to transfer into");
  if (input.toAccountId) await requireAccount(ctx, input.toAccountId, { write: true });
  const r = await db.recurringRule.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "other"), type: input.type, description: input.description, amount: input.amount, accountId: input.accountId, toAccountId: input.toAccountId ?? null, categoryId: input.categoryId ?? null, merchantName: input.merchantName ?? null, frequency: input.frequency, startDate: toDate(input.startDate), endDate: input.endDate ? toDate(input.endDate) : null, autoPost: input.autoPost, lastPostedOn: input.lastPostedOn ? toDate(input.lastPostedOn) : null, notes: input.notes ?? null, currency: ctx.base } });
  await audit(null, ctx.actor, { entity: "RecurringRule", entityId: r.id, action: "create", householdId: ctx.householdId });
  return { id: r.id };
}
export async function updateRecurring(ctx: FinCtx, ruleId: string, patch: z.infer<typeof recurringPatchSchema>) {
  requireWriter(ctx);
  const r = requireVisible(ctx, await db.recurringRule.findUnique({ where: { id: ruleId } }), "Recurring item", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, r, patch, "other");
  for (const k of ["description", "amount", "accountId", "toAccountId", "categoryId", "merchantName", "frequency", "autoPost", "notes", "active"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.startDate) data.startDate = toDate(patch.startDate);
  if (patch.endDate !== undefined) data.endDate = patch.endDate ? toDate(patch.endDate) : null;
  await db.recurringRule.update({ where: { id: r.id }, data });
  return { id: r.id };
}
export async function deleteRecurring(ctx: FinCtx, ruleId: string) {
  requireWriter(ctx);
  const r = requireVisible(ctx, await db.recurringRule.findUnique({ where: { id: ruleId } }), "Recurring item", { write: true });
  await db.recurringRule.update({ where: { id: r.id }, data: { deletedAt: new Date(), active: false, updatedById: ctx.actor.id } });
  return { ok: true };
}
/** Posts every due occurrence up to `through` (default today). Safe to repeat: lastPostedOn prevents duplicates. */
export async function postDueRecurring(ctx: FinCtx, ruleId: string, through?: string) {
  requireWriter(ctx);
  const r = requireVisible(ctx, await db.recurringRule.findUnique({ where: { id: ruleId } }), "Recurring item", { write: true });
  const upTo = through ?? ctx.today;
  const from = r.lastPostedOn ? addDays(dateIso(r.lastPostedOn) as string, 1) : (dateIso(r.startDate) as string);
  const dates = occurrences(r.frequency as Frequency, dateIso(r.startDate) as string, from, upTo, dateIso(r.endDate));
  const { createTransfer } = await import("./transactions");
  for (const d of dates) {
    if (r.type === "TRANSFER") await createTransfer(ctx, { fromAccountId: r.accountId, toAccountId: r.toAccountId as string, amount: money(r.amount), date: d, description: r.description } as never);
    else {
      const t = await createTransaction(ctx, { type: r.type, accountId: r.accountId, amount: money(r.amount), date: d, description: r.description, categoryId: r.categoryId, merchant: r.merchantName, recurringRuleId: r.id, visibility: r.visibility, sharedWithMemberIds: r.sharedWithMemberIds, force: true } as never);
      void t;
    }
    await db.recurringRule.update({ where: { id: r.id }, data: { lastPostedOn: toDate(d) } });
  }
  return { posted: dates.length };
}
export { addMonths };
