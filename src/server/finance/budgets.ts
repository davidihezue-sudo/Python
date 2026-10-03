// Budgets: household budgets (everyone shared) and personal budgets (owner only), with rollover and period comparison.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { evaluateBudget, nextPeriod, periodBoundsFor, previousPeriodOf, type BudgetPeriodKind } from "./engine/budget";
import { resolveAncestor } from "./engine/ledger";
import { audit } from "../services/audit";
import { dateIso, id, isoDate, nonNegMoney, optText, text, toDate } from "./common";
import { requireInHousehold, requireWriter, type FinCtx } from "./access";
import { categoryParents, loadCategories, loadReportTxs } from "./load";
import { netExpense } from "./analytics";

export const budgetSchema = z.object({
  name: text(100), period: z.enum(["WEEKLY", "MONTHLY", "ANNUAL", "CUSTOM"]).default("MONTHLY"), scope: z.enum(["HOUSEHOLD", "PERSONAL"]).default("HOUSEHOLD"), startDate: isoDate.optional(), endDate: isoDate.optional(), notes: optText(500),
  lines: z.array(z.object({ categoryId: id, amount: nonNegMoney, rollover: z.boolean().default(false), warnAtPct: z.number().int().min(1).max(100).default(85) })).max(100).default([]),
});
export const budgetPatchSchema = budgetSchema.partial().extend({ active: z.boolean().optional() });

const visible = (ctx: FinCtx) => ({ householdId: ctx.householdId, deletedAt: null, OR: [{ scope: "HOUSEHOLD" as const }, { scope: "PERSONAL" as const, ownerMemberId: ctx.me.id }] });
async function getBudgetRow(ctx: FinCtx, budgetId: string) {
  const b = await db.finBudget.findFirst({ where: { id: budgetId, ...visible(ctx) }, include: { lines: true } });
  if (!b) throw new AppError("NOT_FOUND", "Budget not found");
  return b;
}
function bounds(input: { period: string; startDate?: string; endDate?: string }, today: string) {
  if (input.period === "CUSTOM") {
    if (!input.startDate || !input.endDate) throw new AppError("VALIDATION_ERROR", "A custom budget needs a start and end date");
    if (input.endDate < input.startDate) throw new AppError("VALIDATION_ERROR", "The end date is before the start date");
    return { from: input.startDate, to: input.endDate };
  }
  return periodBoundsFor(input.period as Exclude<BudgetPeriodKind, "CUSTOM">, input.startDate ?? today);
}

export async function listBudgets(ctx: FinCtx) {
  const rows = await db.finBudget.findMany({ where: visible(ctx), include: { lines: true }, orderBy: [{ startDate: "desc" }, { name: "asc" }] });
  return rows.map((b) => ({ id: b.id, name: b.name, period: b.period, scope: b.scope, from: dateIso(b.startDate), to: dateIso(b.endDate), active: b.active, lineCount: b.lines.length, total: money(b.lines.reduce((a, l) => a.plus(D(l.amount)), ZERO)), current: dateIso(b.startDate)! <= ctx.today && dateIso(b.endDate)! >= ctx.today, owner: b.ownerMemberId ? ctx.members.find((m) => m.id === b.ownerMemberId)?.name ?? null : null }));
}

export async function createBudget(ctx: FinCtx, input: z.infer<typeof budgetSchema>) {
  requireWriter(ctx);
  const { from, to } = bounds(input, ctx.today);
  await assertCategories(ctx, input.lines.map((l) => l.categoryId));
  const dupCat = new Set(input.lines.map((l) => l.categoryId));
  if (dupCat.size !== input.lines.length) throw new AppError("VALIDATION_ERROR", "Each category can appear only once in a budget");
  const b = await db.finBudget.create({ data: { householdId: ctx.householdId, name: input.name, period: input.period, scope: input.scope, ownerMemberId: input.scope === "PERSONAL" ? ctx.me.id : null, startDate: toDate(from), endDate: toDate(to), notes: input.notes ?? null, lines: { create: input.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount, rollover: l.rollover, warnAtPct: l.warnAtPct })) } } });
  await audit(null, ctx.actor, { entity: "Budget", entityId: b.id, action: "create", householdId: ctx.householdId, after: { name: b.name, from, to } });
  return { id: b.id };
}
async function assertCategories(ctx: FinCtx, ids: string[]) {
  if (!ids.length) return;
  const n = await db.finCategory.count({ where: { id: { in: ids }, householdId: ctx.householdId, kind: "EXPENSE" } });
  if (n !== new Set(ids).size) throw new AppError("VALIDATION_ERROR", "A budget category does not exist or is not an expense category");
}
export async function updateBudget(ctx: FinCtx, budgetId: string, patch: z.infer<typeof budgetPatchSchema>) {
  requireWriter(ctx);
  const b = await getBudgetRow(ctx, budgetId);
  if (b.scope === "PERSONAL" && b.ownerMemberId !== ctx.me.id) throw new AppError("NOT_FOUND", "Budget not found");
  const range = patch.period || patch.startDate || patch.endDate ? bounds({ period: patch.period ?? b.period, startDate: patch.startDate ?? dateIso(b.startDate)!, endDate: patch.endDate ?? dateIso(b.endDate)! }, ctx.today) : null;
  if (patch.lines) await assertCategories(ctx, patch.lines.map((l) => l.categoryId));
  await db.$transaction(async (tx) => {
    await tx.finBudget.update({ where: { id: b.id }, data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.period ? { period: patch.period } : {}), ...(range ? { startDate: toDate(range.from), endDate: toDate(range.to) } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) } });
    if (patch.lines) {
      await tx.finBudgetLine.deleteMany({ where: { budgetId: b.id } });
      await tx.finBudgetLine.createMany({ data: patch.lines.map((l) => ({ budgetId: b.id, categoryId: l.categoryId, amount: l.amount, rollover: l.rollover ?? false, warnAtPct: l.warnAtPct ?? 85 })) });
    }
    await audit(tx, ctx.actor, { entity: "Budget", entityId: b.id, action: "update", householdId: ctx.householdId, after: { name: patch.name, lines: patch.lines?.length } });
  });
  return { id: b.id };
}
export async function deleteBudget(ctx: FinCtx, budgetId: string) {
  requireWriter(ctx);
  const b = await getBudgetRow(ctx, budgetId);
  await db.finBudget.update({ where: { id: b.id }, data: { deletedAt: new Date(), active: false } });
  return { ok: true };
}

export const duplicateSchema = z.object({ next: z.boolean().default(true), startDate: isoDate.optional(), name: text(100).optional(), copyAmounts: z.boolean().default(true) });
/** Duplicates a budget into the following period (or a chosen start date), keeping category limits and rollover rules. */
export async function duplicateBudget(ctx: FinCtx, budgetId: string, input: z.infer<typeof duplicateSchema>) {
  requireWriter(ctx);
  const b = await getBudgetRow(ctx, budgetId);
  const range = input.startDate ? bounds({ period: b.period, startDate: input.startDate, endDate: input.startDate }, ctx.today) : nextPeriod(b.period as BudgetPeriodKind, dateIso(b.startDate)!, dateIso(b.endDate)!);
  const clash = await db.finBudget.findFirst({ where: { ...visible(ctx), scope: b.scope, ownerMemberId: b.ownerMemberId, startDate: toDate(range.from), name: input.name ?? b.name } });
  if (clash) throw conflict("A budget with that name already exists for that period");
  const n = await db.finBudget.create({ data: { householdId: ctx.householdId, name: input.name ?? b.name, period: b.period, scope: b.scope, ownerMemberId: b.ownerMemberId, startDate: toDate(range.from), endDate: toDate(range.to), notes: b.notes, lines: { create: b.lines.map((l) => ({ categoryId: l.categoryId, amount: input.copyAmounts ? l.amount : "0.00", rollover: l.rollover, warnAtPct: l.warnAtPct })) } } });
  return { id: n.id, from: range.from, to: range.to };
}

async function actualByLine(ctx: FinCtx, b: { scope: string; lines: { categoryId: string }[] }, from: string, to: string, cats: Awaited<ReturnType<typeof loadCategories>>) {
  const { txs } = await loadReportTxs(ctx, from, to, b.scope === "PERSONAL" ? "my" : "household");
  const parents = categoryParents(cats);
  const targets = new Set(b.lines.map((l) => l.categoryId));
  const m = new Map<string, Dec>();
  let unbudgeted = ZERO;
  for (const t of txs) {
    const ne = netExpense(t);
    if (ne === null) continue;
    const hit = resolveAncestor(t.categoryId, targets, parents);
    if (hit) m.set(hit, (m.get(hit) ?? ZERO).plus(ne));
    else unbudgeted = unbudgeted.plus(ne);
  }
  return { byLine: m, unbudgeted };
}

export async function budgetReport(ctx: FinCtx, budgetId: string) {
  const b = await getBudgetRow(ctx, budgetId);
  const from = dateIso(b.startDate)!, to = dateIso(b.endDate)!;
  const cats = await loadCategories(ctx);
  const prev = previousPeriodOf(b.period as BudgetPeriodKind, from, to);
  const [cur, pre] = await Promise.all([actualByLine(ctx, b, from, to, cats), actualByLine(ctx, b, prev.from, prev.to, cats)]);
  // rollover carry: unspent (or overspent) amount of the immediately preceding budget of the same kind
  const before = await db.finBudget.findFirst({ where: { ...visible(ctx), scope: b.scope, ownerMemberId: b.ownerMemberId, period: b.period, endDate: toDate(prev.to), id: { not: b.id } }, include: { lines: true } });
  const carry = new Map<string, Dec>();
  if (before) {
    const a = await actualByLine(ctx, before, dateIso(before.startDate)!, dateIso(before.endDate)!, cats);
    for (const l of before.lines) carry.set(l.categoryId, D(l.amount).minus(a.byLine.get(l.categoryId) ?? ZERO));
  }
  const res = evaluateBudget({ lines: b.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount.toString(), rollover: l.rollover, warnAtPct: l.warnAtPct })), actualByLine: cur.byLine, unbudgetedActual: cur.unbudgeted, previousByLine: pre.byLine, carryByLine: carry, from, to, today: ctx.today });
  const names = new Map(cats.map((c) => [c.id, c.name]));
  return {
    id: b.id, name: b.name, period: b.period, scope: b.scope, from, to, notes: b.notes, currency: ctx.base, previousRange: prev, asOf: ctx.today, inProgress: ctx.today >= from && ctx.today <= to,
    lines: res.lines.map((l) => ({ categoryId: l.categoryId, category: names.get(l.categoryId) ?? "Unknown", budgeted: money(l.budgeted), carriedOver: money(l.carriedOver), available: money(l.available), actual: money(l.actual), remaining: money(l.remaining), percentUsed: l.percentUsed?.toString() ?? null, previousActual: l.previousActual ? money(l.previousActual) : "0.00", forecast: money(l.forecast), forecastOver: l.forecastOver, state: l.state, rollover: b.lines.find((x) => x.categoryId === l.categoryId)?.rollover ?? false, warnAtPct: b.lines.find((x) => x.categoryId === l.categoryId)?.warnAtPct ?? 85 })),
    unbudgeted: money(res.unbudgeted), totals: { budgeted: money(res.totals.budgeted), actual: money(res.totals.actual), remaining: money(res.totals.remaining), percentUsed: res.totals.percentUsed?.toString() ?? null, forecast: money(res.totals.forecast) },
    basis: b.scope === "PERSONAL" ? "Counts expenses you own." : "Counts expenses shared with the household. Each expense is counted once however it is allocated.",
  };
}

/** Current-period budget utilisation used by the dashboard. */
export async function currentBudgetUtilisation(ctx: FinCtx, scope: "HOUSEHOLD" | "PERSONAL") {
  const b = await db.finBudget.findFirst({ where: { ...visible(ctx), scope, ...(scope === "PERSONAL" ? { ownerMemberId: ctx.me.id } : {}), active: true, startDate: { lte: toDate(ctx.today) }, endDate: { gte: toDate(ctx.today) } }, orderBy: { startDate: "desc" } });
  if (!b) return null;
  const r = await budgetReport(ctx, b.id);
  return { id: r.id, name: r.name, ...r.totals, overCount: r.lines.filter((l) => l.state === "over").length, approachingCount: r.lines.filter((l) => l.state === "approaching").length };
}

export const compareQuery = z.object({ ids: z.string().transform((s) => s.split(",").filter(Boolean).slice(0, 12)) });
export async function compareBudgets(ctx: FinCtx, ids: string[]) {
  const reports = await Promise.all(ids.map((i) => budgetReport(ctx, i)));
  return reports.map((r) => ({ id: r.id, name: r.name, from: r.from, to: r.to, budgeted: r.totals.budgeted, actual: r.totals.actual, remaining: r.totals.remaining, percentUsed: r.totals.percentUsed }));
}
export { requireInHousehold };

/** After an expense is saved: if it pushes a category of the member's or the household's current budget to 80 percent or more, say so. */
export async function budgetNudge(ctx: FinCtx, txId: string) {
  const t = await db.finTransaction.findUnique({ where: { id: txId }, select: { type: true, categoryId: true, category: { select: { parentId: true } }, date: true, ownerMemberId: true, visibility: true } });
  if (!t || t.type !== "EXPENSE" || !t.categoryId) return null;
  const ids = [t.categoryId, t.category?.parentId].filter(Boolean) as string[];
  const day = dateIso(t.date) as string;
  const budgets = await db.finBudget.findMany({ where: { ...visible(ctx), active: true, startDate: { lte: toDate(day) }, endDate: { gte: toDate(day) } } });
  let worst: { budget: string; category: string; percentUsed: number; remaining: string; over: boolean } | null = null;
  for (const b of budgets) {
    const r = await budgetReport(ctx, b.id);
    for (const l of r.lines) {
      if (!ids.includes(l.categoryId) || l.percentUsed === null) continue;
      const pct = Number(l.percentUsed);
      if (pct >= 80 && (!worst || pct > worst.percentUsed)) worst = { budget: r.name, category: l.category, percentUsed: Math.round(pct), remaining: l.remaining, over: pct > 100 };
    }
  }
  return worst;
}
