// Debts. The outstanding balance always comes from the debt's ledger account, so repayments, interest and balances reconcile.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError, conflict } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { amortise, simulateStrategy, splitPayment, type Strategy } from "./engine/debt";
import { monthlyAmount, PER_YEAR, type Frequency } from "./engine/frequency";
import { audit } from "../services/audit";
import { currencyCode, dateIso, frequency, id, isoDate, moneyIn, nonNegMoney, optText, posMoney, rateIn, text, toDate } from "./common";
import { clampToAccount, metaView, newRecordMeta, requireAccount, requireVisible, requireWriter, resolveVisibility, updateRecordMeta, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { DEBT_ACCOUNT_TYPE } from "./defaults";
import { createAccount, ledgerSums } from "./accounts";
import { INTEREST_CATEGORY } from "./defaults";

export const DEBT_TYPES = ["CREDIT_CARD", "PERSONAL_LOAN", "LINE_OF_CREDIT", "VEHICLE_LOAN", "STUDENT_LOAN", "MORTGAGE", "OTHER"] as const;
export const debtSchema = z.object({
  lender: text(100), name: optText(100), type: z.enum(DEBT_TYPES), originalAmount: nonNegMoney, outstandingBalance: nonNegMoney, interestRate: rateIn.default("0"), compoundingPerYear: z.number().int().min(1).max(365).optional(),
  minimumPayment: nonNegMoney.default("0.00"), regularPayment: nonNegMoney.default("0.00"), frequency: frequency.default("MONTHLY"), nextDueDate: isoDate.nullish(), termMonths: z.number().int().min(1).max(1200).nullish(), startDate: isoDate.nullish(), maturityDate: isoDate.nullish(),
  creditLimit: nonNegMoney.nullish(), paymentAccountId: id.nullish(), assetId: id.nullish(), notes: optText(1000), currency: currencyCode.optional(), assignToMemberId: id.nullish(), ...visibilityFields,
});
export const debtPatchSchema = debtSchema.partial().omit({ outstandingBalance: true, type: true }).extend({ active: z.boolean().optional() });
export const paymentSchema = z.object({ date: isoDate, total: posMoney, fromAccountId: id, interest: nonNegMoney.optional(), principal: nonNegMoney.optional(), note: optText(300), payerMemberId: id.nullish() });

type DebtFull = Awaited<ReturnType<typeof loadDebts>>[number];
async function loadDebts(ctx: FinCtx, view: View | "all", extra: Record<string, unknown> = {}) {
  return db.debt.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view), ...extra }, include: { account: true, payments: { where: { deletedAt: null }, orderBy: { date: "desc" } } }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
}

async function interestCategoryId(householdId: string) {
  return (await db.finCategory.findFirst({ where: { householdId, name: INTEREST_CATEGORY, isSystem: true } }))?.id ?? null;
}

export async function listDebts(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await loadDebts(ctx, view);
  const sums = await ledgerSums(ctx.householdId, rows.map((r) => r.accountId));
  const intCat = await interestCategoryId(ctx.householdId);
  const interestExp = intCat ? await db.finTransaction.groupBy({ by: ["accountId"], where: { householdId: ctx.householdId, accountId: { in: rows.map((r) => r.accountId) }, categoryId: intCat, type: "EXPENSE", deletedAt: null, status: "POSTED" }, _sum: { amount: true } }) : [];
  const items = rows.map((d) => debtView(ctx, d, D(d.account.openingBalance).plus(sums.get(d.accountId) ?? ZERO), D(interestExp.find((x) => x.accountId === d.accountId)?._sum.amount).negated()));
  const act = items.filter((i) => i.active);
  const total = act.reduce((a, i) => a.plus(D(i.outstanding)), ZERO);
  const monthly = act.reduce((a, i) => a.plus(D(i.monthlyPayment)), ZERO);
  return { items, totals: { totalDebt: money(total), monthlyPayments: money(monthly), interestPaid: money(items.reduce((a, i) => a.plus(D(i.interestPaid)), ZERO)), principalPaid: money(items.reduce((a, i) => a.plus(D(i.principalPaid)), ZERO)), currency: ctx.base, note: "Totals add balances in each debt's own currency. Use debts in the household currency for exact totals." } };
}

function debtView(ctx: FinCtx, d: DebtFull, ledger: Dec, cardInterest: Dec) {
  const outstanding = ledger.isNegative() ? ledger.negated() : ZERO;
  const orig = D(d.originalAmount);
  const paidInterest = d.payments.reduce((a, p) => a.plus(D(p.interest)), ZERO).plus(cardInterest);
  const paidPrincipal = d.payments.reduce((a, p) => a.plus(D(p.principal)), ZERO);
  const pay = D(d.regularPayment).gt(0) ? d.regularPayment : d.minimumPayment;
  const proj = outstanding.gt(0) && D(pay).gt(0) ? amortise({ balance: outstanding, aprPercent: d.interestRate.toString(), compoundingPerYear: d.compoundingPerYear, frequency: d.frequency as Frequency, payment: pay.toString(), startDate: dateIso(d.nextDueDate) ?? ctx.today }) : null;
  const mo = monthlyAmount(pay.toString(), d.frequency as Frequency);
  return {
    id: d.id, accountId: d.accountId, name: d.account.name, lender: d.lender, type: d.type, currency: d.account.currency, originalAmount: money(orig), outstanding: money(outstanding), interestRate: d.interestRate.toString(), compoundingPerYear: d.compoundingPerYear, minimumPayment: money(d.minimumPayment), regularPayment: money(d.regularPayment),
    frequency: d.frequency, monthlyPayment: mo ? money(mo) : "0.00", nextDueDate: dateIso(d.nextDueDate), termMonths: d.termMonths, startDate: dateIso(d.startDate), maturityDate: dateIso(d.maturityDate), paymentAccountId: d.paymentAccountId, assetId: d.assetId, notes: d.notes, active: d.active, creditLimit: d.account.creditLimit ? money(d.account.creditLimit) : null,
    interestPaid: money(paidInterest), principalPaid: money(paidPrincipal), repaidPercent: orig.gt(0) ? Dec_pct(orig.minus(outstanding), orig) : null,
    projection: proj ? { payoffDate: proj.payoffDate, periods: proj.periods, totalInterest: money(proj.totalInterest), paidOff: proj.paidOff, reason: proj.reason ?? null } : null,
    payments: d.payments.slice(0, 50).map((p) => ({ id: p.id, date: dateIso(p.date), total: money(p.total), principal: money(p.principal), interest: money(p.interest), by: p.memberId ? ctx.members.find((m) => m.id === p.memberId)?.name ?? null : null })), ...metaView(ctx, d),
  };
}
const Dec_pct = (a: Dec, b: Dec) => a.div(b).times(100).toDecimalPlaces(1).toString();

export async function getDebt(ctx: FinCtx, debtId: string) {
  const all = await listDebts(ctx, "all");
  const d = all.items.find((x) => x.id === debtId);
  if (!d) throw new AppError("NOT_FOUND", "Debt not found");
  return d;
}

/** Creates the liability account and the debt record together; the starting balance is the amount currently owed. */
export async function createDebt(ctx: FinCtx, input: z.infer<typeof debtSchema>) {
  requireWriter(ctx);
  if (D(input.outstandingBalance).gt(D(input.originalAmount)) && input.type !== "CREDIT_CARD" && input.type !== "LINE_OF_CREDIT") throw new AppError("VALIDATION_ERROR", "The outstanding balance cannot exceed the original amount", { fieldErrors: { outstandingBalance: ["Cannot exceed the original amount"] } });
  if (input.paymentAccountId) await requireAccount(ctx, input.paymentAccountId);
  const acct = await createAccount(ctx, { name: input.name ?? `${input.lender} (${input.type.toLowerCase().replace(/_/g, " ")})`, institution: input.lender, type: DEBT_ACCOUNT_TYPE[input.type] as never, openingBalance: input.outstandingBalance, openingIsOwed: true, openingDate: input.startDate && input.startDate <= ctx.today ? input.startDate : ctx.today, creditLimit: input.creditLimit ?? null, currency: input.currency, assignToMemberId: input.assignToMemberId, visibility: input.visibility, sharedWithMemberIds: input.sharedWithMemberIds, ownerMemberId: input.assignToMemberId } as never);
  const a = await db.finAccount.findUniqueOrThrow({ where: { id: acct.id }, include: { debt: true } });
  await db.debt.update({ where: { id: (a.debt as { id: string }).id }, data: { type: input.type, lender: input.lender, originalAmount: input.originalAmount, interestRate: input.interestRate, compoundingPerYear: input.compoundingPerYear ?? (input.type === "MORTGAGE" ? 2 : 12), minimumPayment: input.minimumPayment, regularPayment: input.regularPayment, frequency: input.frequency, nextDueDate: input.nextDueDate ? toDate(input.nextDueDate) : null, termMonths: input.termMonths ?? null, startDate: input.startDate ? toDate(input.startDate) : null, maturityDate: input.maturityDate ? toDate(input.maturityDate) : null, paymentAccountId: input.paymentAccountId ?? null, assetId: input.assetId ?? null, notes: input.notes ?? null } });
  return { id: (a.debt as { id: string }).id, accountId: acct.id };
}

export async function updateDebt(ctx: FinCtx, debtId: string, patch: z.infer<typeof debtPatchSchema>) {
  requireWriter(ctx);
  const d = requireVisible(ctx, await db.debt.findUnique({ where: { id: debtId } }), "Debt", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, d, patch, "debts");
  for (const k of ["lender", "originalAmount", "interestRate", "compoundingPerYear", "minimumPayment", "regularPayment", "frequency", "termMonths", "paymentAccountId", "assetId", "notes", "active"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  for (const k of ["nextDueDate", "startDate", "maturityDate"] as const) if (patch[k] !== undefined) data[k] = patch[k] ? toDate(patch[k] as string) : null;
  await db.$transaction(async (tx) => {
    await tx.debt.update({ where: { id: d.id }, data });
    if (patch.name || patch.creditLimit !== undefined || patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined) await tx.finAccount.update({ where: { id: d.accountId }, data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.creditLimit !== undefined ? { creditLimit: patch.creditLimit } : {}), ...(patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined ? resolveVisibility(ctx, patch, "debts", { current: d }) : {}), updatedById: ctx.actor.id } });
    await audit(tx, ctx.actor, { entity: "Debt", entityId: d.id, action: "update", householdId: ctx.householdId, after: patch });
  });
  return { id: d.id };
}

export async function deleteDebt(ctx: FinCtx, debtId: string) {
  requireWriter(ctx);
  const d = requireVisible(ctx, await db.debt.findUnique({ where: { id: debtId } }), "Debt", { write: true });
  const n = await db.finTransaction.count({ where: { accountId: d.accountId, deletedAt: null } });
  if (n) throw conflict("This debt has recorded transactions. Mark it inactive instead so history stays intact.");
  await db.$transaction([db.debt.update({ where: { id: d.id }, data: { deletedAt: new Date(), active: false } }), db.finAccount.update({ where: { id: d.accountId }, data: { deletedAt: new Date() } })]);
  return { ok: true };
}

/**
 * Records a repayment. Principal moves from the paying account into the debt account (a transfer, so it is never counted as an
 * expense); interest is an expense on the paying account. The debt's balance falls by the principal only.
 */
export async function recordDebtPayment(ctx: FinCtx, debtId: string, input: z.infer<typeof paymentSchema>) {
  requireWriter(ctx);
  const d = requireVisible(ctx, await db.debt.findUnique({ where: { id: debtId }, include: { account: true } }), "Debt", { write: true });
  const from = await requireAccount(ctx, input.fromAccountId, { write: true });
  if (from.currency !== d.account.currency) throw new AppError("VALIDATION_ERROR", "The paying account and the debt use different currencies");
  const bal = D(d.account.openingBalance).plus((await ledgerSums(ctx.householdId, [d.accountId])).get(d.accountId) ?? ZERO);
  const owed = bal.isNegative() ? bal.negated() : ZERO;
  const total = D(input.total);
  let interest: Dec, principal: Dec;
  if (input.interest !== undefined || input.principal !== undefined) {
    interest = input.interest !== undefined ? D(input.interest) : total.minus(D(input.principal));
    principal = input.principal !== undefined ? D(input.principal) : total.minus(interest);
    if (!interest.plus(principal).eq(total) || interest.isNegative() || principal.isNegative()) throw new AppError("VALIDATION_ERROR", "Principal and interest must add up to the payment", { fieldErrors: { principal: ["Principal plus interest must equal the payment"] } });
  } else ({ interest, principal } = splitPayment({ balance: owed, aprPercent: d.interestRate.toString(), compoundingPerYear: d.compoundingPerYear, frequency: d.frequency as Frequency, total }));
  if (principal.gt(owed)) throw conflict(`This payment would overpay the debt. ${money(owed)} is outstanding.`);
  const payer = input.payerMemberId === undefined ? ctx.me.id : input.payerMemberId;
  const group = randomUUID();
  const catId = await interestCategoryId(ctx.householdId);
  const shared = d.visibility !== "PERSONAL";
  const rec = await db.$transaction(async (tx) => {
    const p = await tx.debtPayment.create({ data: { debtId: d.id, date: toDate(input.date), total: money(total), principal: money(principal), interest: money(interest), fromAccountId: from.id, memberId: payer, note: input.note ?? null } });
    const base = { householdId: ctx.householdId, date: toDate(input.date), debtPaymentId: p.id, ownerMemberId: ctx.me.id, payerMemberId: payer, createdById: ctx.actor.id, updatedById: ctx.actor.id };
    if (principal.gt(0)) {
      await tx.finTransaction.create({ data: { ...base, accountId: from.id, type: "TRANSFER", amount: money(principal.negated()), currency: from.currency, description: `Payment to ${d.lender}`, transferGroupId: group, ...clampToAccount(from, resolveVisibility(ctx, { visibility: d.visibility, sharedWithMemberIds: d.sharedWithMemberIds }, "debts")) } });
      await tx.finTransaction.create({ data: { ...base, accountId: d.accountId, type: "TRANSFER", amount: money(principal), currency: d.account.currency, description: `Payment from ${from.name}`, transferGroupId: group, ...clampToAccount(d.account, resolveVisibility(ctx, { visibility: d.visibility, sharedWithMemberIds: d.sharedWithMemberIds }, "debts")) } });
    }
    if (interest.gt(0)) await tx.finTransaction.create({ data: { ...base, accountId: from.id, type: "EXPENSE", amount: money(interest.negated()), currency: from.currency, description: `Interest on ${d.lender}`, categoryId: catId, allocationMode: shared ? "HOUSEHOLD" : "OWNER", ...clampToAccount(from, resolveVisibility(ctx, { visibility: d.visibility, sharedWithMemberIds: d.sharedWithMemberIds }, "debts")) } });
    if (d.nextDueDate && input.date >= (dateIso(d.nextDueDate) as string)) {
      const { nextOccurrence } = await import("./engine/frequency");
      const n = nextOccurrence(d.frequency as Frequency, dateIso(d.nextDueDate) as string, input.date);
      if (n) await tx.debt.update({ where: { id: d.id }, data: { nextDueDate: toDate(n) } });
    }
    await audit(tx, ctx.actor, { entity: "Debt", entityId: d.id, action: "payment", householdId: ctx.householdId, after: { total: money(total), principal: money(principal), interest: money(interest), payer } });
    return p;
  });
  return { id: rec.id, principal: money(principal), interest: money(interest), remaining: money(owed.minus(principal)) };
}
export async function deleteDebtPayment(ctx: FinCtx, debtId: string, paymentId: string) {
  requireWriter(ctx);
  const d = requireVisible(ctx, await db.debt.findUnique({ where: { id: debtId } }), "Debt", { write: true });
  const p = await db.debtPayment.findFirst({ where: { id: paymentId, debtId: d.id, deletedAt: null } });
  if (!p) throw new AppError("NOT_FOUND", "Payment not found");
  await db.$transaction(async (tx) => {
    await tx.debtPayment.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await tx.finTransaction.updateMany({ where: { debtPaymentId: p.id, deletedAt: null }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await audit(tx, ctx.actor, { entity: "Debt", entityId: d.id, action: "delete-payment", householdId: ctx.householdId, before: { total: money(p.total) } });
  });
  return { ok: true };
}

export async function debtSchedule(ctx: FinCtx, debtId: string, extra = "0") {
  const d = await getDebt(ctx, debtId);
  const pay = D(d.regularPayment).gt(0) ? d.regularPayment : d.minimumPayment;
  const base = amortise({ balance: d.outstanding, aprPercent: d.interestRate, compoundingPerYear: d.compoundingPerYear, frequency: d.frequency as Frequency, payment: pay, startDate: d.nextDueDate ?? ctx.today, maxPeriods: 600 });
  const withExtra = D(extra).gt(0) ? amortise({ balance: d.outstanding, aprPercent: d.interestRate, compoundingPerYear: d.compoundingPerYear, frequency: d.frequency as Frequency, payment: pay, extra, startDate: d.nextDueDate ?? ctx.today, maxPeriods: 600 }) : null;
  const wire = (a: ReturnType<typeof amortise>) => ({ periods: a.periods, payoffDate: a.payoffDate, paidOff: a.paidOff, reason: a.reason ?? null, totalInterest: money(a.totalInterest), totalPaid: money(a.totalPaid), rows: a.rows.slice(0, 600).map((r) => ({ n: r.n, date: r.date, payment: money(r.payment), interest: money(r.interest), principal: money(r.principal), closing: money(r.closing) })) });
  return { debt: { id: d.id, name: d.name, outstanding: d.outstanding }, current: wire(base), withExtra: withExtra ? { extraMonthly: money(extra), ...wire(withExtra), interestSaved: money(base.totalInterest.minus(withExtra.totalInterest)), periodsSaved: base.periods - withExtra.periods } : null };
}

export const strategySchema = z.object({ extra: z.string().default("0"), order: z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean) : undefined)), view: z.enum(["my", "household", "all"]).default("all") });
/** Compares repayment strategies side by side without assuming that one is right for everybody. */
export async function compareStrategies(ctx: FinCtx, q: z.infer<typeof strategySchema>) {
  const { items } = await listDebts(ctx, q.view);
  const live = items.filter((i) => i.active && D(i.outstanding).gt(0));
  const input = live.map((d) => ({ id: d.id, name: d.name, balance: d.outstanding, aprPercent: d.interestRate, compoundingPerYear: d.compoundingPerYear, minimumPayment: D(d.minimumPayment).gt(0) ? d.minimumPayment : d.regularPayment }));
  const run = (strategy: Strategy, extra: string) => simulateStrategy({ debts: input, strategy, extraMonthly: extra, customOrder: q.order, startDate: ctx.today });
  const wire = (r: ReturnType<typeof run>) => ({ strategy: r.strategy, months: r.months, debtFreeDate: r.debtFreeDate, completed: r.completed, reason: r.reason ?? null, totalInterest: money(r.totalInterest), totalPaid: money(r.totalPaid), payoffOrder: r.payoffOrder, timeline: r.timeline.filter((_, i) => i % 3 === 0 || i === r.timeline.length - 1).map((t) => ({ month: t.month, date: t.date, totalBalance: money(t.totalBalance) })) });
  const minimums = wire(run("AVALANCHE", "0"));
  const strategies = [wire(run("AVALANCHE", q.extra)), wire(run("SNOWBALL", q.extra)), ...(q.order?.length ? [wire(run("CUSTOM", q.extra))] : [])];
  return { debts: live.map((d) => ({ id: d.id, name: d.name, outstanding: d.outstanding, interestRate: d.interestRate })), extraMonthly: money(q.extra), minimumsOnly: minimums, strategies, note: "Avalanche usually pays the least interest. Snowball clears small balances first, which some people find easier to stick with. Neither is right for everyone." };
}
export { id, moneyIn, PER_YEAR };
