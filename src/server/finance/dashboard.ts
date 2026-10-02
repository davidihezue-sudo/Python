// The dashboard and the member comparison. Every figure comes from a service that reads real, permitted records.
import { z } from "zod";
import { D, money, ZERO } from "./engine/decimal";
import { addDays, diffDays, endOfMonth, resolveRange, previousPeriod, type RangePreset } from "./engine/dates";
import { runForecast } from "./engine/forecast";
import { sortObligations } from "./engine/obligations";
import { isoDate } from "./common";
import { memberRef, type FinCtx, type View } from "./access";
import { summarise, trend, type Scope } from "./analytics";
import { incomeSummary } from "./income";
import { netWorth } from "./wealth";
import { listDebts } from "./debts";
import { listGoals, emergencyPlan } from "./goals";
import { currentBudgetUtilisation } from "./budgets";
import { obligations } from "./calendar";
import { computeAlerts } from "./alerts";
import { listTransactions, txQuerySchema } from "./transactions";
import { buildBaseline, wireForecast } from "./forecasts";
import { contributionReport } from "./contributions";
import { listAccounts } from "./accounts";

export const dashboardQuery = z.object({ view: z.enum(["my", "household"]).default("household"), range: z.enum(["current_month", "previous_month", "last_3_months", "last_6_months", "last_12_months", "year_to_date", "custom"]).default("current_month"), from: isoDate.optional(), to: isoDate.optional() });

export async function dashboard(ctx: FinCtx, q: z.infer<typeof dashboardQuery>) {
  const view: View = q.view;
  const r = resolveRange(q.range as RangePreset, ctx.today, { from: q.from, to: q.to });
  const prev = previousPeriod(r.from, r.to);
  const monthFrom = `${ctx.today.slice(0, 7)}-01`, monthTo = endOfMonth(ctx.today);
  const [sum, tr, inc, nw, debts, goals, emergency, accounts, budget] = await Promise.all([summarise(ctx, view, r.from, r.to), trend(ctx, view, r.from, r.to), incomeSummary(ctx, view), netWorth(ctx, { view, months: 12 }), listDebts(ctx, view), listGoals(ctx, view), emergencyPlan(ctx, { view, months: "3,6", planMonths: 12 } as never), listAccounts(ctx, view), currentBudgetUtilisation(ctx, view === "my" ? "PERSONAL" : "HOUSEHOLD")]);
  const [upcoming, alerts, recent, contrib] = await Promise.all([obligations(ctx, ctx.today, addDays(ctx.today, 30), view), computeAlerts(ctx), listTransactions(ctx, txQuerySchema.parse({ view, pageSize: 10 })), view === "household" ? contributionReport(ctx, monthFrom, monthTo) : null]);

  // end of month forecast for the same view
  let endOfMonthBalance: string | null = null;
  try {
    const base = await buildBaseline(ctx, { view, savingsInterestPct: 0, investmentReturnPct: 0, assetGrowthPct: 0, varMonths: 3 });
    const days = Math.max(1, diffDays(monthTo, ctx.today));
    const f = runForecast(base, { days });
    endOfMonthBalance = wireForecast(f).end.liquid;
  } catch { endOfMonthBalance = null; }

  const liquid = accounts.items.filter((a) => a.isLiquid && !a.isLiability && a.status === "ACTIVE").reduce((a, x) => a.plus(D(x.currentBalance)), ZERO);
  const grossMonthly = D(inc.combinedMonthlyGross), netMonthly = D(inc.combinedMonthlyNet);
  const debtMonthly = D(debts.totals.monthlyPayments);
  const dti = grossMonthly.gt(0) ? debtMonthly.div(grossMonthly).times(100).toDecimalPlaces(1) : null;
  const savedPct = sum.totals.savingsRate;
  const metrics = [
    { key: "savingsRate", label: "Savings rate", value: savedPct, unit: "%", detail: `${sum.totals.netCashFlow} left after expenses on ${sum.totals.income} of income in this period.`, meaning: "The share of income that was not spent: (income minus expenses) divided by income. Transfers between accounts are excluded. Negative means spending exceeded income." },
    { key: "debtToIncome", label: "Debt payments to gross income", value: dti?.toString() ?? null, unit: "%", detail: `${money(debtMonthly)} of monthly debt payments against ${money(grossMonthly)} of monthly gross income.`, meaning: "Monthly debt payments divided by gross monthly income. Lenders commonly look at this ratio. Lower is generally easier to manage; the right level depends on your circumstances." },
    { key: "emergencyCoverage", label: "Emergency fund coverage", value: emergency.coverageMonths, unit: "months", detail: `${emergency.currentEmergencySavings} in savings against ${emergency.essentialMonthly} of essential spending a month.`, meaning: "How many months of essential spending your savings accounts could cover. Many planners suggest three to six months, but the right amount depends on job stability and dependants." },
    { key: "budgetPerformance", label: "Budget performance", value: budget?.percentUsed ?? null, unit: "% used", detail: budget ? `${budget.name}: ${budget.actual} of ${budget.budgeted} used, ${budget.overCount} over limit.` : "No active budget covers today.", meaning: "How much of this period's budget has been used. Over 100 percent means spending has exceeded the plan." },
    { key: "cashFlow", label: "Net cash flow", value: sum.totals.netCashFlow, unit: sum.currency, detail: `Income ${sum.totals.income} minus expenses ${sum.totals.expenses}.`, meaning: "Income minus expenses for the selected period. It uses net (after tax) income and counts each expense once." },
    { key: "goals", label: "Financial goals", value: `${goals.summary.onTrack + goals.summary.completed} of ${goals.summary.active + goals.summary.completed}`, unit: "on track or done", detail: `${goals.summary.behind} behind schedule.`, meaning: "Goals are on track when their planned contributions reach the target by the target date. No single score is calculated, so you can see exactly what each measure is based on." },
  ];
  return {
    view, range: { ...r, preset: q.range, previous: prev }, currency: ctx.base, asOf: ctx.today,
    privacyNote: view === "household" ? "Household Finances combines only the records members have shared with the household. Personal records stay private." : "My Finances shows the records you own, shared or personal.",
    overview: { income: sum.totals.income, expenses: sum.totals.expenses, netCashFlow: sum.totals.netCashFlow, monthlySavingsRate: savedPct, totalAssets: nw.assets, totalLiabilities: nw.liabilities, netWorth: nw.netWorth, availableCash: money(liquid), totalDebt: debts.totals.totalDebt, budgetUtilisation: budget?.percentUsed ?? null },
    income: { combinedMonthlyGross: inc.combinedMonthlyGross, combinedMonthlyNet: inc.combinedMonthlyNet, members: inc.members, actualByMember: sum.byMember.map((m) => ({ member: m.member, income: m.income })), warnings: inc.warnings, note: inc.note },
    expenses: { total: sum.totals.expenses, shared: sum.expenseSplit.shared, personal: sum.expenseSplit.personal, byMember: sum.byMember.map((m) => ({ member: m.member, recorded: m.expensesRecorded, paid: m.expensesPaid, allocated: m.allocatedToMember })), byCategory: sum.byCategory.slice(0, 12), note: sum.expenseSplit.note },
    cashFlow: { series: tr.series, comparison: tr.comparison, previousRange: tr.previousRange, endOfMonthForecast: endOfMonthBalance, endOfMonthNote: "Estimated cash at the end of this month from scheduled items and spending averages. Not a guarantee.", savedToGoalsThisPeriod: goals.summary.totalCurrent },
    position: { cash: money(liquid), savings: nw.groups.find((g) => g.group === "savings")?.value ?? "0.00", investments: nw.groups.find((g) => g.group === "investments")?.value ?? "0.00", otherAssets: money(D(nw.assets).minus(liquid).minus(D(nw.groups.find((g) => g.group === "savings")?.value ?? 0)).minus(D(nw.groups.find((g) => g.group === "investments")?.value ?? 0))), liabilities: nw.liabilities, netWorth: nw.netWorth, history: nw.history, monthOverMonth: nw.monthOverMonth, yearOverYear: nw.yearOverYear },
    contributions: contrib ? { arrangement: contrib.arrangement, members: contrib.members.map((m) => ({ member: m.member, paidForSharedExpenses: m.paidForSharedExpenses, sharedBillsPaid: m.sharedBillsPaid, savingsContributions: m.savingsContributions, goalContributions: m.goalContributions, debtPayments: m.debtPayments, transfersToJointAccounts: m.transfersToJointAccounts, netPosition: m.netPosition })), pool: contrib.pool, suggestedSettlements: contrib.suggestedSettlements } : null,
    health: metrics, goals: goals.items.filter((g) => g.status === "ACTIVE").slice(0, 6), goalSummary: goals.summary,
    upcoming: sortObligations(upcoming).filter((o) => o.direction !== "in" && !o.completed).slice(0, 12), alerts: alerts.slice(0, 8), recent: recent.items,
    members: ctx.members.map((m) => memberRef(ctx, m.id)),
  };
}

/** Neutral side-by-side view of member contributions. It only includes records shared with the viewer. */
export async function memberComparison(ctx: FinCtx, from: string, to: string) {
  const [contrib, inc] = await Promise.all([contributionReport(ctx, from, to), incomeSummary(ctx, "household")]);
  const rows = [];
  for (const m of ctx.members) {
    const scope: Scope = m.id === ctx.me.id ? "my" : { member: m.id };
    const sum = await summarise(ctx, scope, from, to);
    const c = contrib.members.find((x) => x.member?.id === m.id);
    const i = inc.members.find((x) => x.member?.id === m.id);
    rows.push({
      member: memberRef(ctx, m.id), monthlyGrossIncome: i?.monthlyGross ?? null, monthlyNetIncome: i?.monthlyNet ?? null, incomeShare: i?.share ?? null, incomeReceived: sum.totals.income, expensesRecorded: sum.totals.expenses, personalSpending: c?.allocatedPersonal ?? "0.00",
      householdExpensesPaid: c?.paidForSharedExpenses ?? "0.00", sharedBillsPaid: c?.sharedBillsPaid ?? "0.00", savingsContributions: c?.savingsContributions ?? "0.00", debtPayments: c?.debtPayments ?? "0.00", goalContributions: c?.goalContributions ?? "0.00", transfersToJointAccounts: c?.transfersToJointAccounts ?? "0.00", netPosition: c?.netPosition ?? "0.00", recordsIncluded: sum.totals.count,
    });
  }
  const goals = await listGoals(ctx, "household");
  return { from, to, currency: ctx.base, arrangement: contrib.arrangement, members: rows, sharedGoals: goals.items.map((g) => ({ id: g.id, name: g.name, target: g.target, current: g.current, byMember: g.contributionsByMember })), suggestedSettlements: contrib.suggestedSettlements, notes: ["This view is meant to help the household understand how it funds shared costs. It is not a ranking.", "It includes only records each member has shared with you. A member who keeps records private will appear to have lower totals, which is not an error.", ...contrib.notes] };
}
export { ZERO };
