// Savings goals and household financial goals, plus the emergency fund planner.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { incomeLossRunway, planEmergencyFund, projectDebtGoal, projectGoal } from "./engine/savings";
import { addMonths, startOfMonth, endOfMonth } from "./engine/dates";
import { audit } from "../services/audit";
import { currencyCode, dateIso, id, isoDate, moneyIn, nonNegMoney, optText, text, toDate } from "./common";
import { clampToAccount, memberRef, metaView, newRecordMeta, requireAccount, requireVisible, requireWriter, resolveVisibility, updateRecordMeta, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { ledgerSums } from "./accounts";
import { getDebt } from "./debts";
import { loadBooks, nwInputs, loadCategories, categoryParents, loadReportTxs } from "./load";
import { computeNetWorth } from "./engine/networth";
import { isLiquidType, SAVINGS_ACCOUNT_TYPES, spendByCategory, rollUpToRoot } from "./engine/ledger";
import { incomeSummary } from "./income";

export const GOAL_KINDS = ["EMERGENCY_FUND", "HOME_DOWN_PAYMENT", "VEHICLE", "VACATION", "EDUCATION", "MAJOR_PURCHASE", "GENERAL_SAVINGS", "DEBT_PAYOFF", "INVESTMENT_CONTRIBUTION", "NET_WORTH", "CUSTOM"] as const;
export const goalSchema = z.object({
  name: text(100), description: optText(500), kind: z.enum(GOAL_KINDS).default("GENERAL_SAVINGS"), tracking: z.enum(["CONTRIBUTIONS", "DEBT_BALANCE", "NET_WORTH", "ACCOUNT_BALANCE"]).default("CONTRIBUTIONS"), targetAmount: nonNegMoney, startingAmount: nonNegMoney.default("0.00"), currency: currencyCode.optional(),
  targetDate: isoDate.nullish(), monthlyContribution: nonNegMoney.default("0.00"), accountId: id.nullish(), debtId: id.nullish(), responsibleMemberId: id.nullish(), assignedMemberIds: z.array(id).max(50).default([]), priority: z.number().int().min(1).max(3).default(2), notes: optText(1000),
  assignToMemberId: id.nullish(), ...visibilityFields,
});
export const goalPatchSchema = goalSchema.partial().extend({ status: z.enum(["ACTIVE", "COMPLETED", "PAUSED", "CANCELLED"]).optional() });
export const contributionSchema = z.object({ date: isoDate, amount: moneyIn.refine((s) => !D(s).isZero(), "Amount cannot be zero"), fromAccountId: id.nullish(), memberId: id.nullish(), note: optText(300) });

type GoalRow = Awaited<ReturnType<typeof loadGoals>>[number];
async function loadGoals(ctx: FinCtx, view: View | "all") {
  return db.savingsGoal.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, include: { contributions: { where: { deletedAt: null }, orderBy: { date: "desc" } } }, orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "asc" }] });
}

async function currentAmount(ctx: FinCtx, g: GoalRow): Promise<{ current: Dec; note: string | null; debtStart?: Dec }> {
  if (g.tracking === "ACCOUNT_BALANCE" && g.accountId) {
    const a = await db.finAccount.findFirst({ where: { id: g.accountId, householdId: ctx.householdId, deletedAt: null } });
    if (a) return { current: D(a.openingBalance).plus((await ledgerSums(ctx.householdId, [a.id])).get(a.id) ?? ZERO), note: `Tracks the balance of ${a.name}` };
  }
  if (g.tracking === "DEBT_BALANCE" && g.debtId) {
    try {
      const d = await getDebt(ctx, g.debtId);
      return { current: D(g.targetAmount).minus(D(d.outstanding)).lt(0) ? ZERO : D(g.targetAmount).minus(D(d.outstanding)), note: `Tracks repayment of ${d.name}` };
    } catch { /* debt not visible */ }
  }
  if (g.tracking === "NET_WORTH") {
    const view: View = g.visibility === "PERSONAL" ? "my" : "household";
    const books = await loadBooks(ctx, { view });
    return { current: computeNetWorth({ ...(await nwInputs(ctx, view)), txs: books.balanceTxs, baseCurrency: ctx.base, fx: books.fx, asOf: ctx.today }).netWorth, note: `Tracks ${view === "my" ? "your" : "household"} net worth` };
  }
  const sum = g.contributions.reduce((a, c) => a.plus(D(c.amount)), ZERO);
  return { current: D(g.startingAmount).plus(sum), note: null };
}

export async function goalView(ctx: FinCtx, g: GoalRow) {
  const { current, note } = await currentAmount(ctx, g);
  const proj = g.tracking === "DEBT_BALANCE" ? projectDebtGoal({ startingBalance: g.targetAmount.toString(), outstanding: D(g.targetAmount).minus(current).toString(), targetDate: dateIso(g.targetDate), monthlyPayment: g.monthlyContribution.toString(), today: ctx.today }) : projectGoal({ target: g.targetAmount.toString(), current, monthly: g.monthlyContribution.toString(), targetDate: dateIso(g.targetDate), today: ctx.today });
  const status = g.status === "ACTIVE" ? proj.status : g.status === "COMPLETED" ? "COMPLETED" : g.status;
  const byMember = new Map<string, Dec>();
  for (const c of g.contributions) if (c.memberId) byMember.set(c.memberId, (byMember.get(c.memberId) ?? ZERO).plus(D(c.amount)));
  return {
    id: g.id, name: g.name, description: g.description, kind: g.kind, tracking: g.tracking, trackingNote: note, target: money(g.targetAmount), startingAmount: money(g.startingAmount), current: money(current), remaining: money(proj.remaining), percentComplete: proj.percentComplete.toString(), targetDate: dateIso(g.targetDate), monthlyContribution: money(g.monthlyContribution),
    requiredMonthly: proj.requiredMonthly ? money(proj.requiredMonthly) : null, estimatedCompletion: proj.estimatedCompletion, shortfallMonthly: proj.shortfallMonthly ? money(proj.shortfallMonthly) : null, progressStatus: status, status: g.status, priority: g.priority, accountId: g.accountId, debtId: g.debtId, responsibleMember: memberRef(ctx, g.responsibleMemberId), assignedMemberIds: g.assignedMemberIds, notes: g.notes, completedAt: dateIso(g.completedAt), currency: g.currency,
    contributionsByMember: [...byMember.entries()].map(([m, v]) => ({ member: memberRef(ctx, m), total: money(v) })), recentContributions: g.contributions.slice(0, 20).map((c) => ({ id: c.id, date: dateIso(c.date), amount: money(c.amount), member: memberRef(ctx, c.memberId), note: c.note })), ...metaView(ctx, g),
  };
}

export async function listGoals(ctx: FinCtx, view: View | "all" = "all") {
  const rows = await loadGoals(ctx, view);
  const items = await Promise.all(rows.map((g) => goalView(ctx, g)));
  const active = items.filter((i) => i.status === "ACTIVE");
  const count = (s: string) => items.filter((i) => i.progressStatus === s).length;
  return { items, summary: { onTrack: count("ON_TRACK"), behind: count("BEHIND"), completed: count("COMPLETED"), noPlan: count("NO_PLAN"), active: active.length, totalTarget: money(active.reduce((a, i) => a.plus(D(i.target)), ZERO)), totalCurrent: money(active.reduce((a, i) => a.plus(D(i.current)), ZERO)), monthlyPlanned: money(active.reduce((a, i) => a.plus(D(i.monthlyContribution)), ZERO)), currency: ctx.base } };
}
export async function getGoal(ctx: FinCtx, goalId: string) {
  const g = requireVisible(ctx, await db.savingsGoal.findUnique({ where: { id: goalId }, include: { contributions: { where: { deletedAt: null }, orderBy: { date: "desc" } } } }), "Goal");
  return goalView(ctx, g);
}

export async function createGoal(ctx: FinCtx, input: z.infer<typeof goalSchema>) {
  requireWriter(ctx);
  if (input.accountId) await requireAccount(ctx, input.accountId);
  if (input.tracking === "DEBT_BALANCE" && !input.debtId) throw new AppError("VALIDATION_ERROR", "Choose the debt this goal tracks", { fieldErrors: { debtId: ["Required"] } });
  if (input.tracking === "ACCOUNT_BALANCE" && !input.accountId) throw new AppError("VALIDATION_ERROR", "Choose the account this goal tracks", { fieldErrors: { accountId: ["Required"] } });
  if (input.assignedMemberIds.some((m) => !ctx.members.some((x) => x.id === m))) throw new AppError("VALIDATION_ERROR", "Assigned members must belong to this household");
  const g = await db.savingsGoal.create({ data: { householdId: ctx.householdId, ...newRecordMeta(ctx, input, "savings"), name: input.name, description: input.description ?? null, kind: input.kind, tracking: input.tracking, targetAmount: input.targetAmount, startingAmount: input.startingAmount, currency: input.currency ?? ctx.base, targetDate: input.targetDate ? toDate(input.targetDate) : null, monthlyContribution: input.monthlyContribution, accountId: input.accountId ?? null, debtId: input.debtId ?? null, responsibleMemberId: input.responsibleMemberId ?? ctx.me.id, assignedMemberIds: input.assignedMemberIds, priority: input.priority, notes: input.notes ?? null } });
  await audit(null, ctx.actor, { entity: "SavingsGoal", entityId: g.id, action: "create", householdId: ctx.householdId, after: { name: g.name, target: money(g.targetAmount) } });
  return { id: g.id };
}
export async function updateGoal(ctx: FinCtx, goalId: string, patch: z.infer<typeof goalPatchSchema>) {
  requireWriter(ctx);
  const g = requireVisible(ctx, await db.savingsGoal.findUnique({ where: { id: goalId } }), "Goal", { write: true });
  const data: Record<string, unknown> = updateRecordMeta(ctx, g, patch, "savings");
  for (const k of ["name", "description", "kind", "tracking", "targetAmount", "startingAmount", "currency", "monthlyContribution", "accountId", "debtId", "responsibleMemberId", "assignedMemberIds", "priority", "notes", "status"] as const) if ((patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
  if (patch.targetDate !== undefined) data.targetDate = patch.targetDate ? toDate(patch.targetDate) : null;
  if (patch.status === "COMPLETED") data.completedAt = toDate(ctx.today);
  await db.savingsGoal.update({ where: { id: g.id }, data });
  await audit(null, ctx.actor, { entity: "SavingsGoal", entityId: g.id, action: "update", householdId: ctx.householdId, before: { monthly: money(g.monthlyContribution), target: money(g.targetAmount) }, after: patch });
  return getGoal(ctx, g.id);
}
export async function deleteGoal(ctx: FinCtx, goalId: string) {
  requireWriter(ctx);
  const g = requireVisible(ctx, await db.savingsGoal.findUnique({ where: { id: goalId } }), "Goal", { write: true });
  await db.savingsGoal.update({ where: { id: g.id }, data: { deletedAt: new Date(), status: "CANCELLED", updatedById: ctx.actor.id } });
  return { ok: true };
}

/**
 * Records a contribution (or withdrawal when negative) by a member. With a source account and a goal savings account the money moves
 * as a transfer, so the contribution is never counted as an expense. The goal's progress and projected completion update at once.
 */
export async function addContribution(ctx: FinCtx, goalId: string, input: z.infer<typeof contributionSchema>) {
  requireWriter(ctx);
  const g = requireVisible(ctx, await db.savingsGoal.findUnique({ where: { id: goalId } }), "Goal", { write: true });
  if (g.tracking !== "CONTRIBUTIONS") throw new AppError("VALIDATION_ERROR", "This goal tracks a balance automatically, so contributions are not recorded on it");
  const memberId = input.memberId ?? ctx.me.id;
  if (!ctx.members.some((m) => m.id === memberId)) throw new AppError("VALIDATION_ERROR", "Unknown member");
  const amount = D(input.amount);
  let group: string | null = null;
  const c = await db.$transaction(async (tx) => {
    if (input.fromAccountId && g.accountId) {
      const from = await requireAccount(ctx, input.fromAccountId, { write: true }), to = await requireAccount(ctx, g.accountId, { write: true });
      group = randomUUID();
      const base = { householdId: ctx.householdId, type: "TRANSFER" as const, date: toDate(input.date), description: `Savings: ${g.name}`, transferGroupId: group, ownerMemberId: memberId, payerMemberId: memberId, createdById: ctx.actor.id, updatedById: ctx.actor.id };
      const [src, dst] = amount.gt(0) ? [from, to] : [to, from];
      const mag = amount.abs();
      await tx.finTransaction.create({ data: { ...base, accountId: src.id, amount: money(mag.negated()), currency: src.currency, ...clampToAccount(src, resolveVisibility(ctx, { visibility: g.visibility, sharedWithMemberIds: g.sharedWithMemberIds }, "savings")) } });
      await tx.finTransaction.create({ data: { ...base, accountId: dst.id, amount: money(mag), currency: dst.currency, ...clampToAccount(dst, resolveVisibility(ctx, { visibility: g.visibility, sharedWithMemberIds: g.sharedWithMemberIds }, "savings")) } });
    }
    const row = await tx.goalContribution.create({ data: { goalId: g.id, date: toDate(input.date), amount: money(amount), memberId, note: input.note ?? null, transferGroupId: group } });
    await audit(tx, ctx.actor, { entity: "SavingsGoal", entityId: g.id, action: "contribution", householdId: ctx.householdId, after: { amount: money(amount), member: memberId, enteredBy: ctx.me.id } });
    return row;
  });
  const view = await getGoal(ctx, g.id);
  if (view.progressStatus === "COMPLETED" && g.status === "ACTIVE") await db.savingsGoal.update({ where: { id: g.id }, data: { status: "COMPLETED", completedAt: toDate(ctx.today) } });
  return { id: c.id, goal: view };
}
export async function deleteContribution(ctx: FinCtx, goalId: string, contributionId: string) {
  requireWriter(ctx);
  const g = requireVisible(ctx, await db.savingsGoal.findUnique({ where: { id: goalId } }), "Goal", { write: true });
  const c = await db.goalContribution.findFirst({ where: { id: contributionId, goalId: g.id, deletedAt: null } });
  if (!c) throw new AppError("NOT_FOUND", "Contribution not found");
  await db.$transaction(async (tx) => {
    await tx.goalContribution.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    if (c.transferGroupId) await tx.finTransaction.updateMany({ where: { transferGroupId: c.transferGroupId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await audit(tx, ctx.actor, { entity: "SavingsGoal", entityId: g.id, action: "delete-contribution", householdId: ctx.householdId, before: { amount: money(c.amount) } });
  });
  return { ok: true };
}

export const emergencySchema = z.object({ view: z.enum(["my", "household"]).default("household"), essentialMonthly: z.string().optional(), months: z.string().default("1,3,6,9,12"), planMonths: z.coerce.number().int().min(1).max(120).default(12), loseMember: id.optional() });
/** Emergency fund planning. Essential spending is taken from categories flagged essential unless a figure is supplied. */
export async function emergencyPlan(ctx: FinCtx, q: z.infer<typeof emergencySchema>) {
  const from = addMonths(startOfMonth(ctx.today), -3), to = endOfMonth(addMonths(startOfMonth(ctx.today), -1));
  const [{ txs }, cats] = await Promise.all([loadReportTxs(ctx, from, to, q.view), loadCategories(ctx)]);
  const parents = categoryParents(cats);
  const essentialIds = new Set(cats.filter((c) => c.isEssential || (c.parentId && cats.find((p) => p.id === c.parentId)?.isEssential)).map((c) => c.id));
  const spend = spendByCategory(txs, from, to);
  let essential = ZERO;
  for (const [k, v] of spend) if (essentialIds.has(k)) essential = essential.plus(v);
  const computed = essential.div(3);
  const monthly = q.essentialMonthly !== undefined && q.essentialMonthly !== "" ? D(q.essentialMonthly) : computed;
  const books = await loadBooks(ctx, { view: q.view });
  const nw = computeNetWorth({ ...(await nwInputs(ctx, q.view)), txs: books.balanceTxs, baseCurrency: ctx.base, fx: books.fx, asOf: ctx.today });
  const savings = nw.lines.filter((l) => l.side === "asset" && (l.group === "savings" || l.group === "cash")).reduce((a, l) => a.plus(l.value), ZERO);
  const emergencyAcct = nw.lines.filter((l) => l.side === "asset" && l.group === "savings").reduce((a, l) => a.plus(l.value), ZERO);
  const plan = planEmergencyFund({ essentialMonthly: monthly, currentSavings: emergencyAcct, targetMonths: q.months.split(",").map(Number).filter((n) => n > 0 && n <= 36), planMonths: q.planMonths });
  const inc = await incomeSummary(ctx, q.view);
  let scenario = null;
  const loseId = q.loseMember ?? (q.view === "household" ? ctx.members.find((m) => m.id !== ctx.me.id)?.id : ctx.me.id);
  if (loseId) {
    const lost = D(inc.members.find((m) => m.member?.id === loseId)?.monthlyNet ?? 0);
    const remaining = D(inc.combinedMonthlyNet).minus(lost);
    scenario = { lostMember: memberRef(ctx, loseId), lostMonthlyNet: money(lost), ...wire(incomeLossRunway({ essentialMonthly: monthly, remainingIncomeMonthly: remaining, availableSavings: savings })) };
  }
  return { view: q.view, currency: ctx.base, period: { from, to }, essentialMonthly: money(monthly), essentialBasis: q.essentialMonthly ? "Entered by you" : "Average of the last three full months of spending in categories marked essential", coverageMonths: plan.coverageMonths ? plan.coverageMonths.toString() : null, currentEmergencySavings: money(emergencyAcct), cashAndSavings: money(savings), targets: plan.targets.map((t) => ({ months: t.months, amount: money(t.amount), remaining: money(t.remaining), requiredMonthly: t.requiredMonthly ? money(t.requiredMonthly) : null, reached: t.reached })), planMonths: q.planMonths, scenario, note: "Coverage uses savings accounts. The income loss scenario uses net income and assumes essential spending stays the same." };
}
const wire = (r: ReturnType<typeof incomeLossRunway>) => ({ remainingIncomeMonthly: money(r.remainingIncomeMonthly), monthlyShortfall: money(r.monthlyShortfall), runwayMonths: r.runwayMonths ? r.runwayMonths.toString() : null, coversEssentials: r.coversEssentials });
export { id, isLiquidType, SAVINGS_ACCOUNT_TYPES, rollUpToRoot };
