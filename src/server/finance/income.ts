// Income sources. Gross and net are always tracked separately and never added together.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { monthlyAmount, annualAmount, nextOccurrence, occurrences, type Frequency } from "./engine/frequency";
import { addMonths, startOfMonth } from "./engine/dates";
import { audit } from "../services/audit";
import { currencyCode, dateIso, frequency, id, isoDate, moneyIn, nonNegMoney, optText, text, toDate } from "./common";
import { canEdit, memberRef, ownerFor, requireAccount, requireVisible, requireWriter, resolveVisibility, visibilityFields, visWhere, clampToAccount, type FinCtx, type View } from "./access";
import { loadFx } from "./load";
import { createTransaction } from "./transactions";

export const INCOME_KINDS = ["EMPLOYMENT", "PART_TIME", "SELF_EMPLOYMENT", "BUSINESS", "CONTRACT", "FREELANCE", "RENTAL", "INVESTMENT", "GOVERNMENT_BENEFIT", "OTHER"] as const;
export const incomeSchema = z.object({
  name: text(100), kind: z.enum(INCOME_KINDS).default("EMPLOYMENT"), employer: optText(100), currency: currencyCode.optional(),
  grossAmount: nonNegMoney, netAmount: nonNegMoney, taxDeduction: nonNegMoney.default("0.00"), pensionDeduction: nonNegMoney.default("0.00"), otherDeduction: nonNegMoney.default("0.00"),
  frequency: frequency.default("BIWEEKLY"), nextPayDate: isoDate.nullish(), startDate: isoDate.nullish(), endDate: isoDate.nullish(), accountId: id.nullish(), notes: optText(1000),
  assignToMemberId: id.nullish(), ...visibilityFields,
});
export const incomePatchSchema = incomeSchema.partial().extend({ active: z.boolean().optional(), pausedFrom: isoDate.nullish(), pausedUntil: isoDate.nullish() });

const KIND_CATEGORY: Record<string, string> = { EMPLOYMENT: "Salary", PART_TIME: "Salary", SELF_EMPLOYMENT: "Self-employment", BUSINESS: "Business", CONTRACT: "Self-employment", FREELANCE: "Self-employment", RENTAL: "Rental income", INVESTMENT: "Investment income", GOVERNMENT_BENEFIT: "Government benefits", OTHER: "Other income" };

function validateAmounts(gross: string, net: string) {
  if (D(net).gt(D(gross))) throw new AppError("VALIDATION_ERROR", "Net income cannot be higher than gross income", { fieldErrors: { netAmount: ["Cannot exceed gross"] } });
}
type SrcRow = Awaited<ReturnType<typeof db.incomeSource.findFirstOrThrow>>;
export const isActiveOn = (s: Pick<SrcRow, "active" | "startDate" | "endDate" | "pausedFrom" | "pausedUntil">, on: string) => s.active && (!s.startDate || dateIso(s.startDate)! <= on) && (!s.endDate || dateIso(s.endDate)! >= on) && !(s.pausedFrom && dateIso(s.pausedFrom)! <= on && (!s.pausedUntil || dateIso(s.pausedUntil)! >= on));

/** Trailing twelve month average of what an irregular source actually paid (net). */
async function irregularAverages(ctx: FinCtx, sourceIds: string[]) {
  if (!sourceIds.length) return new Map<string, Dec>();
  const from = toDate(addMonths(startOfMonth(ctx.today), -11));
  const g = await db.finTransaction.groupBy({ by: ["incomeSourceId"], where: { householdId: ctx.householdId, incomeSourceId: { in: sourceIds }, type: "INCOME", status: "POSTED", deletedAt: null, date: { gte: from }, ...visWhere(ctx, "all") }, _sum: { amount: true } });
  return new Map(g.map((r) => [r.incomeSourceId as string, D(r._sum.amount).div(12)]));
}

export function sourceView(ctx: FinCtx, s: SrcRow, irregularNet: Dec | null) {
  const freq = s.frequency as Frequency;
  const net = monthlyAmount(s.netAmount.toString(), freq) ?? irregularNet;
  const gross = monthlyAmount(s.grossAmount.toString(), freq);
  const annualNet = annualAmount(s.netAmount.toString(), freq);
  const annualGross = annualAmount(s.grossAmount.toString(), freq);
  const today = ctx.today;
  return {
    id: s.id, name: s.name, kind: s.kind, employer: s.employer, currency: s.currency, grossAmount: money(s.grossAmount), netAmount: money(s.netAmount), taxDeduction: money(s.taxDeduction), pensionDeduction: money(s.pensionDeduction), otherDeduction: money(s.otherDeduction),
    frequency: s.frequency, nextPayDate: dateIso(s.nextPayDate), startDate: dateIso(s.startDate), endDate: dateIso(s.endDate), pausedFrom: dateIso(s.pausedFrom), pausedUntil: dateIso(s.pausedUntil), accountId: s.accountId, notes: s.notes, active: s.active, activeToday: isActiveOn(s, today),
    monthlyGross: gross ? money(gross) : null, monthlyNet: net ? money(net) : null, annualGross: annualGross ? money(annualGross) : null, annualNet: annualNet ? money(annualNet) : null, monthlyBasis: freq === "IRREGULAR" ? "Trailing twelve month average of recorded payments" : `${freq.toLowerCase().replace("_", "-")} amount converted to a monthly average`,
    owner: memberRef(ctx, s.ownerMemberId), ownerMemberId: s.ownerMemberId, mine: s.ownerMemberId === ctx.me.id, visibility: s.visibility, sharedWithMemberIds: s.ownerMemberId === ctx.me.id ? s.sharedWithMemberIds : undefined, canEdit: canEdit(ctx, s),
  };
}

export async function listIncome(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await db.incomeSource.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], include: { changes: { orderBy: { effectiveDate: "desc" } } } });
  const irr = await irregularAverages(ctx, rows.filter((r) => r.frequency === "IRREGULAR").map((r) => r.id));
  return rows.map((r) => ({ ...sourceView(ctx, r, irr.get(r.id) ?? null), changes: r.changes.map((c) => ({ id: c.id, kind: c.kind, effectiveDate: dateIso(c.effectiveDate), grossBefore: c.grossBefore ? money(c.grossBefore) : null, grossAfter: c.grossAfter ? money(c.grossAfter) : null, netBefore: c.netBefore ? money(c.netBefore) : null, netAfter: c.netAfter ? money(c.netAfter) : null, note: c.note })) }));
}

/** Combined and per member income. Gross and net totals are reported side by side and never mixed. */
export async function incomeSummary(ctx: FinCtx, view: View | "all" = "household") {
  const items = (await listIncome(ctx, view)).filter((i) => i.activeToday);
  const fx = await loadFx(ctx);
  const per = new Map<string, { gross: Dec; net: Dec; grossMissing: boolean }>();
  const warnings: string[] = [];
  let tg = ZERO, tn = ZERO;
  for (const i of items) {
    const cg = i.monthlyGross ? fx.convert(i.monthlyGross, i.currency, ctx.base, ctx.today) : null;
    const cn = i.monthlyNet ? fx.convert(i.monthlyNet, i.currency, ctx.base, ctx.today) : null;
    if ((i.monthlyNet && !cn) || (i.monthlyGross && !cg)) warnings.push(`No exchange rate for ${i.currency} to ${ctx.base}, so "${i.name}" is excluded.`);
    const k = i.ownerMemberId ?? "household";
    const cur = per.get(k) ?? { gross: ZERO, net: ZERO, grossMissing: false };
    if (cg) cur.gross = cur.gross.plus(cg.amount);
    else if (!i.monthlyGross) cur.grossMissing = true;
    if (cn) cur.net = cur.net.plus(cn.amount);
    per.set(k, cur);
    if (cg) tg = tg.plus(cg.amount);
    if (cn) tn = tn.plus(cn.amount);
  }
  const members = [...per.entries()].map(([k, v]) => ({ member: k === "household" ? null : memberRef(ctx, k), monthlyGross: money(v.gross), monthlyNet: money(v.net), grossIncomplete: v.grossMissing, share: tn.isZero() ? null : v.net.div(tn).times(100).toDecimalPlaces(1).toString() }));
  return { view, currency: ctx.base, combinedMonthlyGross: money(tg), combinedMonthlyNet: money(tn), combinedAnnualGross: money(tg.times(12)), combinedAnnualNet: money(tn.times(12)), members, sourceCount: items.length, warnings, note: "Gross and net are separate measures. Household cash flow uses net income only." };
}

export async function createIncome(ctx: FinCtx, input: z.infer<typeof incomeSchema>) {
  requireWriter(ctx);
  validateAmounts(input.grossAmount, input.netAmount);
  const owner = ownerFor(ctx, input.assignToMemberId);
  const acct = input.accountId ? await requireAccount(ctx, input.accountId) : null;
  const vis = resolveVisibility(ctx, input, "income");
  const row = await db.incomeSource.create({ data: { householdId: ctx.householdId, ownerMemberId: owner, ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id, accountId: acct?.id ?? null, name: input.name, kind: input.kind, employer: input.employer ?? null, currency: input.currency ?? acct?.currency ?? ctx.base, grossAmount: input.grossAmount, netAmount: input.netAmount, taxDeduction: input.taxDeduction, pensionDeduction: input.pensionDeduction, otherDeduction: input.otherDeduction, frequency: input.frequency, nextPayDate: input.nextPayDate ? toDate(input.nextPayDate) : null, startDate: input.startDate ? toDate(input.startDate) : null, endDate: input.endDate ? toDate(input.endDate) : null, notes: input.notes ?? null } });
  await audit(null, ctx.actor, { entity: "IncomeSource", entityId: row.id, action: "create", householdId: ctx.householdId, after: { name: row.name, owner, visibility: vis.visibility } });
  return { id: row.id };
}

export async function updateIncome(ctx: FinCtx, sourceId: string, patch: z.infer<typeof incomePatchSchema>) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.incomeSource.findUnique({ where: { id: sourceId } }), "Income source", { write: true });
  if ((patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined || patch.assignToMemberId !== undefined) && s.ownerMemberId !== ctx.me.id) throw new AppError("FORBIDDEN", "Only the owner can change who can see this income");
  const gross = patch.grossAmount ?? money(s.grossAmount), net = patch.netAmount ?? money(s.netAmount);
  validateAmounts(gross, net);
  const vis = patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined ? resolveVisibility(ctx, patch, "income", { current: s }) : {};
  const data: Record<string, unknown> = { updatedById: ctx.actor.id, ...vis };
  for (const k of ["name", "kind", "employer", "currency", "grossAmount", "netAmount", "taxDeduction", "pensionDeduction", "otherDeduction", "frequency", "notes", "active", "accountId"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  for (const k of ["nextPayDate", "startDate", "endDate", "pausedFrom", "pausedUntil"] as const) if (patch[k] !== undefined) data[k] = patch[k] ? toDate(patch[k] as string) : null;
  if (patch.assignToMemberId) data.ownerMemberId = ownerFor(ctx, patch.assignToMemberId);
  await db.incomeSource.update({ where: { id: s.id }, data });
  await audit(null, ctx.actor, { entity: "IncomeSource", entityId: s.id, action: "update", householdId: ctx.householdId, before: { gross: money(s.grossAmount), net: money(s.netAmount) }, after: patch });
  return { id: s.id };
}

export async function deleteIncome(ctx: FinCtx, sourceId: string) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.incomeSource.findUnique({ where: { id: sourceId } }), "Income source", { write: true });
  await db.incomeSource.update({ where: { id: s.id }, data: { deletedAt: new Date(), active: false, updatedById: ctx.actor.id } });
  await audit(null, ctx.actor, { entity: "IncomeSource", entityId: s.id, action: "delete", householdId: ctx.householdId });
  return { ok: true };
}

export const incomeChangeSchema = z.object({ kind: z.enum(["SALARY_INCREASE", "SALARY_DECREASE", "JOB_CHANGE", "INTERRUPTION", "RESUMPTION", "OTHER"]), effectiveDate: isoDate, grossAfter: nonNegMoney.optional(), netAfter: nonNegMoney.optional(), pausedUntil: isoDate.nullish(), note: optText(300) });
/** Records a change in income and, when it takes effect today or earlier, applies it to the source. History is always kept. */
export async function recordIncomeChange(ctx: FinCtx, sourceId: string, input: z.infer<typeof incomeChangeSchema>) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.incomeSource.findUnique({ where: { id: sourceId } }), "Income source", { write: true });
  const grossAfter = input.grossAfter ?? (input.kind === "INTERRUPTION" ? null : null);
  await db.$transaction(async (tx) => {
    await tx.incomeChange.create({ data: { incomeSourceId: s.id, kind: input.kind, effectiveDate: toDate(input.effectiveDate), grossBefore: s.grossAmount, grossAfter, netBefore: s.netAmount, netAfter: input.netAfter ?? null, note: input.note ?? null } });
    const apply = input.effectiveDate <= ctx.today;
    const data: Record<string, unknown> = { updatedById: ctx.actor.id };
    if (apply && (input.grossAfter || input.netAfter)) {
      const g = input.grossAfter ?? money(s.grossAmount), n = input.netAfter ?? money(s.netAmount);
      validateAmounts(g, n);
      data.grossAmount = g; data.netAmount = n;
    }
    if (input.kind === "INTERRUPTION") { data.pausedFrom = toDate(input.effectiveDate); data.pausedUntil = input.pausedUntil ? toDate(input.pausedUntil) : null; }
    if (input.kind === "RESUMPTION") { data.pausedFrom = null; data.pausedUntil = null; }
    await tx.incomeSource.update({ where: { id: s.id }, data });
    await audit(tx, ctx.actor, { entity: "IncomeSource", entityId: s.id, action: `change:${input.kind}`, householdId: ctx.householdId, before: { gross: money(s.grossAmount), net: money(s.netAmount) }, after: input });
  });
  return { ok: true };
}

export const paymentSchema = z.object({ date: isoDate, amount: nonNegMoney.optional(), accountId: id.optional(), categoryId: id.nullish(), notes: optText(300) });
/** Records the actual pay-day deposit as an INCOME transaction owned by the source's owner. Expected pay dates advance automatically. */
export async function recordIncomePayment(ctx: FinCtx, sourceId: string, input: z.infer<typeof paymentSchema>) {
  requireWriter(ctx);
  const s = requireVisible(ctx, await db.incomeSource.findUnique({ where: { id: sourceId } }), "Income source", { write: true });
  const accountId = input.accountId ?? s.accountId;
  if (!accountId) throw new AppError("VALIDATION_ERROR", "Choose the account the payment was deposited into", { fieldErrors: { accountId: ["Required"] } });
  const cat = input.categoryId ?? (await db.finCategory.findFirst({ where: { householdId: ctx.householdId, kind: "INCOME", name: KIND_CATEGORY[s.kind], parentId: null } }))?.id ?? null;
  const acct = await requireAccount(ctx, accountId, { write: true });
  const res = await createTransaction(ctx, { type: "INCOME", accountId, amount: input.amount ?? money(s.netAmount), date: input.date, description: s.employer ? `${s.name} (${s.employer})` : s.name, categoryId: cat, notes: input.notes ?? null, status: "POSTED", assignToMemberId: s.ownerMemberId, incomeSourceId: s.id, visibility: s.visibility, sharedWithMemberIds: s.sharedWithMemberIds, force: true } as never);
  const next = s.frequency === "IRREGULAR" || s.frequency === "ONE_TIME" ? null : nextOccurrence(s.frequency as Frequency, dateIso(s.nextPayDate) ?? input.date, input.date);
  if (next) await db.incomeSource.update({ where: { id: s.id }, data: { nextPayDate: toDate(next) } });
  void acct; void clampToAccount;
  return res;
}

/** Expected pay dates for the calendar and forecasts. */
export function expectedPayDates(s: { frequency: string; nextPayDate: Date | null; endDate: Date | null }, from: string, to: string): string[] {
  if (!s.nextPayDate) return [];
  return occurrences(s.frequency as Frequency, dateIso(s.nextPayDate) as string, from, to, dateIso(s.endDate));
}
export { id, optText };
