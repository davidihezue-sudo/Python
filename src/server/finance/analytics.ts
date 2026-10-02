// Consolidated analytics over a view ("my" or "household"). Every figure is computed from ledger rows the actor may see.
// An expense appears once in the totals however it is allocated, so views never double count.
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { monthlySeries, periodTotals, spendByCategory, rollUpToRoot, type ConvertedTx } from "./engine/ledger";
import { resolveAllocations } from "./engine/allocation";
import { previousPeriod, endOfMonth, startOfMonth, addMonths } from "./engine/dates";
import { memberRef, type FinCtx, type View } from "./access";
import { loadCategories, loadReportTxs, categoryParents, type LoadedTx } from "./load";

export type Scope = View | { member: string };
type Tx = ConvertedTx & LoadedTx;

/** Net expense amount of a row in base currency: positive for spending, negative for refunds and reimbursements. */
export const netExpense = (t: Tx): Dec | null => (t.type === "EXPENSE" ? t.base.negated() : t.type === "REFUND" || t.type === "REIMBURSEMENT" ? t.base.negated() : null);

/** Allocation of an expense row (signed like netExpense) in base currency. */
export function allocationsOf(t: Tx): { memberId: string | null; amount: Dec }[] {
  const amt = netExpense(t);
  if (amt === null) return [];
  const mag = t.base.abs();
  const sign = amt.isNegative() ? -1 : 1;
  const rows = t.allocationMode === "SPLIT" && t.allocations.length ? t.allocations.map((a) => ({ memberId: a.memberId, amount: D(a.amount) })) : resolveAllocations({ amount: mag, mode: (t.allocationMode as never) ?? "OWNER", ownerId: t.ownerId, allocatedMemberId: t.allocatedMemberId });
  // rescale split rows that are in the transaction currency to the base amount
  const total = rows.reduce((a, r) => a.plus(r.amount), ZERO);
  return rows.map((r) => ({ memberId: r.memberId, amount: (total.isZero() ? r.amount : r.amount.times(mag).div(total)).times(sign) }));
}

export async function summarise(ctx: FinCtx, scope: Scope, from: string, to: string) {
  const view: View | { member: string } = scope;
  const [{ txs, excluded, missingRates }, cats] = await Promise.all([loadReportTxs(ctx, from, to, view), loadCategories(ctx)]);
  const t = periodTotals(txs, from, to);
  const parents = categoryParents(cats);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const spend = rollUpToRoot(spendByCategory(txs, from, to), parents);
  const byCategory = [...spend.entries()].map(([id, v]) => ({ categoryId: id === "uncategorised" ? null : id, name: id === "uncategorised" ? "Uncategorised" : (names.get(id) ?? "Unknown"), amount: money(v), share: t.expenses.isZero() ? null : v.div(t.expenses).times(100).toDecimalPlaces(1).toString() })).filter((c) => !D(c.amount).isZero()).sort((a, b) => D(b.amount).comparedTo(D(a.amount)));
  const subs = spendByCategory(txs, from, to);
  const bySub = [...subs.entries()].map(([id, v]) => ({ categoryId: id === "uncategorised" ? null : id, parentId: parents.get(id) ?? null, name: id === "uncategorised" ? "Uncategorised" : (names.get(id) ?? "Unknown"), amount: money(v) }));

  // Who recorded / who paid / who it is allocated to. These are views onto the same rows, so each sums to the same total.
  const byOwner = new Map<string, { income: Dec; expenses: Dec }>();
  const byPayer = new Map<string, Dec>();
  let sharedPool = ZERO, personalAlloc = ZERO;
  const allocByMember = new Map<string, Dec>();
  for (const x of txs) {
    const k = x.ownerId ?? "household";
    const cur = byOwner.get(k) ?? { income: ZERO, expenses: ZERO };
    if (x.type === "INCOME") cur.income = cur.income.plus(x.base);
    const ne = netExpense(x);
    if (ne) {
      cur.expenses = cur.expenses.plus(ne);
      const pk = x.payerId ?? "household";
      byPayer.set(pk, (byPayer.get(pk) ?? ZERO).plus(ne));
      for (const a of allocationsOf(x)) {
        if (a.memberId === null) sharedPool = sharedPool.plus(a.amount);
        else {
          personalAlloc = personalAlloc.plus(a.amount);
          allocByMember.set(a.memberId, (allocByMember.get(a.memberId) ?? ZERO).plus(a.amount));
        }
      }
    }
    byOwner.set(k, cur);
  }
  const memberRows = ctx.members.map((m) => ({ member: memberRef(ctx, m.id), income: money(byOwner.get(m.id)?.income ?? ZERO), expensesRecorded: money(byOwner.get(m.id)?.expenses ?? ZERO), expensesPaid: money(byPayer.get(m.id) ?? ZERO), allocatedToMember: money(allocByMember.get(m.id) ?? ZERO) }));
  return {
    scope: typeof scope === "string" ? scope : "member", from, to, currency: ctx.base,
    totals: { income: money(t.income), expenses: money(t.expenses), grossExpenses: money(t.grossExpenses), refunds: money(t.refunds), netCashFlow: money(t.netCashFlow), savingsRate: t.savingsRate ? t.savingsRate.toString() : null, count: t.count },
    expenseSplit: { shared: money(sharedPool), personal: money(personalAlloc), note: "Shared = allocated to the household pool. Personal = allocated to an individual member. Together they equal total expenses." },
    byCategory, bySubcategory: bySub, byMember: memberRows, paidByHousehold: money(byPayer.get("household") ?? ZERO),
    excludedForMissingRates: excluded.length, missingRates,
  };
}

/** Month by month income/expense/net for a scope, with an equal length prior period for comparison. */
export async function trend(ctx: FinCtx, scope: Scope, from: string, to: string) {
  const prev = previousPeriod(from, to);
  const [cur, pre] = await Promise.all([loadReportTxs(ctx, from, to, scope), loadReportTxs(ctx, prev.from, prev.to, scope)]);
  const series = monthlySeries(cur.txs, from, to).map((m) => ({ month: m.month, income: money(m.income), expenses: money(m.expenses), net: money(m.netCashFlow) }));
  const a = periodTotals(cur.txs, from, to), b = periodTotals(pre.txs, prev.from, prev.to);
  const delta = (x: Dec, y: Dec) => ({ current: money(x), previous: money(y), change: money(x.minus(y)), changePct: y.isZero() ? null : x.minus(y).div(y.abs()).times(100).toDecimalPlaces(1).toString() });
  return { series, previousRange: prev, comparison: { income: delta(a.income, b.income), expenses: delta(a.expenses, b.expenses), net: delta(a.netCashFlow, b.netCashFlow) } };
}
export { endOfMonth, startOfMonth, addMonths };
