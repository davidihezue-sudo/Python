// Financial reports. Every report is built from real, permitted records and states its scope and period.
import { z } from "zod";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { addMonths, endOfMonth, monthKeys, previousPeriod, startOfMonth } from "./engine/dates";
import { monthlySeries, periodTotals, spendByCategory, rollUpToRoot } from "./engine/ledger";
import { isoDate, id } from "./common";
import { memberRef, type FinCtx, type View } from "./access";
import type { ReportData, Column } from "../services/reports";
import { summarise, netExpense, type Scope } from "./analytics";
import { categoryParents, loadCategories, loadReportTxs } from "./load";
import { listAccounts } from "./accounts";
import { listDebts } from "./debts";
import { listGoals } from "./goals";
import { netWorth } from "./wealth";
import { budgetReport, listBudgets } from "./budgets";
import { listBills, listSubscriptions, listInsurance, listRecurring } from "./bills";
import { contributionReport } from "./contributions";
import { memberComparison } from "./dashboard";
import { listIncome } from "./income";
import { allTransactions } from "./transactions";

export const REPORT_TYPES = [
  { type: "income-monthly", label: "Monthly income report", description: "Income by month and member." },
  { type: "expense-monthly", label: "Monthly expense report", description: "Expenses by month, shared and personal." },
  { type: "category-spending", label: "Category spending report", description: "Where the money went, with the previous period." },
  { type: "cash-flow", label: "Household cash flow report", description: "Income, expenses and net cash flow by month." },
  { type: "budget-performance", label: "Budget performance report", description: "Budgeted versus actual by category.", needsBudget: true },
  { type: "debt", label: "Debt report", description: "Balances, rates, payments and projected payoff." },
  { type: "savings", label: "Savings and goals report", description: "Progress toward savings goals." },
  { type: "net-worth", label: "Net worth report", description: "Assets, liabilities and net worth over time." },
  { type: "account-balances", label: "Account balance report", description: "Balances of every account you can see." },
  { type: "annual-summary", label: "Annual financial summary", description: "A year month by month with totals." },
  { type: "member-contribution", label: "Household member contribution report", description: "Who paid, who it is allocated to, and positions." },
  { type: "member-comparison", label: "Member comparison", description: "A neutral side by side of shared contributions." },
  { type: "recurring-expenses", label: "Recurring expenses report", description: "Bills, subscriptions, insurance and recurring items." },
  { type: "transactions", label: "Transaction ledger", description: "Every transaction in the period." },
] as const;
export type FinReportType = (typeof REPORT_TYPES)[number]["type"];

export const reportQuery = z.object({ type: z.enum(REPORT_TYPES.map((r) => r.type) as [FinReportType, ...FinReportType[]]), view: z.enum(["my", "household"]).default("household"), from: isoDate.optional(), to: isoDate.optional(), year: z.coerce.number().int().min(2000).max(2100).optional(), budgetId: id.optional(), format: z.enum(["pdf", "csv", "xlsx", "json"]).default("json") });

const num = (s: string | null | undefined) => (s === null || s === undefined ? null : Number(s));
const M: Pick<Column, "format" | "align"> = { format: "money", align: "right" };
const col = (key: string, label: string, extra: Partial<Column> = {}): Column => ({ key, label, ...extra });

export async function buildFinanceReport(ctx: FinCtx, q: z.infer<typeof reportQuery>): Promise<ReportData> {
  const today = ctx.today;
  const year = q.year ?? Number(today.slice(0, 4));
  const isAnnual = q.type === "annual-summary";
  const from = isAnnual ? `${year}-01-01` : (q.from ?? startOfMonth(addMonths(today, -5)));
  const to = isAnnual ? `${year}-12-31` : (q.to ?? endOfMonth(today));
  const view: View = q.view;
  const scopeLabel = view === "my" ? `My Finances (${ctx.me.name})` : "Household Finances (records shared with the household)";
  const rep: ReportData = { type: q.type, title: REPORT_TYPES.find((r) => r.type === q.type)!.label, subtitle: `${scopeLabel}. Period ${from} to ${to}. Currency ${ctx.base}.`, generatedAt: new Date().toISOString(), generatedFor: ctx.actor.name, vehicles: [], privacy: { hideVin: false, hideCosts: false, hideProviders: false }, units: { distance: "km", currency: ctx.base }, columns: [], rows: [], summary: [], notes: ["Figures come from records entered by household members. Private records of other members are never included.", "Transfers between accounts, credit card payments and settlements between members are not counted as income or expenses."] };

  switch (q.type) {
    case "income-monthly": {
      const { txs } = await loadReportTxs(ctx, from, to, view);
      const by = new Map<string, Dec>();
      for (const t of txs) if (t.type === "INCOME") by.set(`${t.date.slice(0, 7)}|${t.ownerId ?? ""}`, (by.get(`${t.date.slice(0, 7)}|${t.ownerId ?? ""}`) ?? ZERO).plus(t.base));
      rep.columns = [col("month", "Month"), col("member", "Member"), col("income", "Net income received", M)];
      for (const mth of monthKeys(from, to)) for (const m of ctx.members) { const v = by.get(`${mth}|${m.id}`); if (v) rep.rows.push({ month: mth, member: m.name, income: num(money(v)) }); }
      const total = [...by.values()].reduce((a, b) => a.plus(b), ZERO);
      rep.summary.push({ label: "Total income received", value: num(money(total)) as number });
      const inc = await listIncome(ctx, view);
      rep.notes.push(`Expected monthly: ${inc.filter((i) => i.activeToday && i.monthlyNet).map((i) => `${i.name} net ${i.monthlyNet}${i.monthlyGross ? ` (gross ${i.monthlyGross})` : ""}`).join("; ") || "none recorded"}.`);
      break;
    }
    case "expense-monthly": {
      const { txs } = await loadReportTxs(ctx, from, to, view);
      rep.columns = [col("month", "Month"), col("expenses", "Expenses (net of refunds)", M), col("shared", "Allocated to household", M), col("personal", "Allocated to members", M)];
      const { allocationsOf } = await import("./analytics");
      let tot = ZERO;
      for (const mth of monthKeys(from, to)) {
        let e = ZERO, sh = ZERO, pe = ZERO;
        for (const t of txs.filter((x) => x.date.startsWith(mth))) { const ne = netExpense(t); if (!ne) continue; e = e.plus(ne); for (const a of allocationsOf(t)) if (a.memberId === null) sh = sh.plus(a.amount); else pe = pe.plus(a.amount); }
        tot = tot.plus(e);
        rep.rows.push({ month: mth, expenses: num(money(e)), shared: num(money(sh)), personal: num(money(pe)) });
      }
      rep.summary.push({ label: "Total expenses", value: num(money(tot)) as number });
      break;
    }
    case "category-spending": {
      const s = await summarise(ctx, view, from, to);
      const prev = previousPeriod(from, to);
      const p = await summarise(ctx, view, prev.from, prev.to);
      const pm = new Map(p.byCategory.map((c) => [c.categoryId, c.amount]));
      rep.columns = [col("category", "Category"), col("amount", "Amount", M), col("share", "Share of total", { format: "percent", align: "right" }), col("previous", `Previous period (${prev.from} to ${prev.to})`, M), col("change", "Change", M)];
      for (const c of s.byCategory) rep.rows.push({ category: c.name, amount: num(c.amount), share: num(c.share), previous: num(pm.get(c.categoryId) ?? "0.00"), change: num(money(D(c.amount).minus(D(pm.get(c.categoryId) ?? 0)))) });
      rep.summary.push({ label: "Total expenses", value: num(s.totals.expenses) as number }, { label: "Previous period", value: num(p.totals.expenses) as number });
      break;
    }
    case "cash-flow":
    case "annual-summary": {
      const { txs } = await loadReportTxs(ctx, from, to, view);
      rep.columns = [col("month", "Month"), col("income", "Income", M), col("expenses", "Expenses", M), col("net", "Net cash flow", M), col("rate", "Savings rate", { format: "percent", align: "right" })];
      for (const m of monthlySeries(txs, from, to)) rep.rows.push({ month: m.month, income: num(money(m.income)), expenses: num(money(m.expenses)), net: num(money(m.netCashFlow)), rate: m.savingsRate ? num(m.savingsRate.toString()) : null });
      const t = periodTotals(txs, from, to);
      rep.summary.push({ label: "Income", value: num(money(t.income)) as number }, { label: "Expenses", value: num(money(t.expenses)) as number }, { label: "Net cash flow", value: num(money(t.netCashFlow)) as number });
      break;
    }
    case "budget-performance": {
      const bs = await listBudgets(ctx);
      const pick = q.budgetId ?? bs.find((b) => b.current)?.id ?? bs[0]?.id;
      if (!pick) { rep.notes.push("No budgets exist yet."); break; }
      const b = await budgetReport(ctx, pick);
      rep.subtitle = `${b.name} (${b.scope.toLowerCase()}). Period ${b.from} to ${b.to}. Currency ${ctx.base}.`;
      rep.columns = [col("category", "Category"), col("budgeted", "Budgeted", M), col("actual", "Actual", M), col("remaining", "Remaining", M), col("pct", "Used", { format: "percent", align: "right" }), col("forecast", "Forecast", M), col("previous", "Previous period", M), col("state", "Status")];
      for (const l of b.lines) rep.rows.push({ category: l.category, budgeted: num(l.available), actual: num(l.actual), remaining: num(l.remaining), pct: num(l.percentUsed), forecast: num(l.forecast), previous: num(l.previousActual), state: l.state === "over" ? "Over budget" : l.state === "approaching" ? "Approaching limit" : l.state === "unfunded" ? "No budget set" : "Within budget" });
      rep.summary.push({ label: "Budgeted", value: num(b.totals.budgeted) as number }, { label: "Actual", value: num(b.totals.actual) as number }, { label: "Unbudgeted spending", value: num(b.unbudgeted) as number });
      break;
    }
    case "debt": {
      const d = await listDebts(ctx, view);
      rep.columns = [col("debt", "Debt"), col("lender", "Lender"), col("type", "Type"), col("outstanding", "Outstanding", M), col("rate", "Rate", { format: "percent", align: "right" }), col("payment", "Monthly payment", M), col("interest", "Interest paid", M), col("principal", "Principal paid", M), col("payoff", "Projected payoff")];
      for (const x of d.items) rep.rows.push({ debt: x.name, lender: x.lender, type: x.type.replace(/_/g, " ").toLowerCase(), outstanding: num(x.outstanding), rate: num(x.interestRate), payment: num(x.monthlyPayment), interest: num(x.interestPaid), principal: num(x.principalPaid), payoff: x.projection?.payoffDate ?? "Not projected" });
      rep.summary.push({ label: "Total debt", value: num(d.totals.totalDebt) as number }, { label: "Monthly debt payments", value: num(d.totals.monthlyPayments) as number });
      break;
    }
    case "savings": {
      const g = await listGoals(ctx, view);
      rep.columns = [col("goal", "Goal"), col("target", "Target", M), col("current", "Current", M), col("pct", "Complete", { format: "percent", align: "right" }), col("monthly", "Monthly plan", M), col("required", "Required monthly", M), col("eta", "Estimated completion"), col("status", "Status")];
      for (const x of g.items) rep.rows.push({ goal: x.name, target: num(x.target), current: num(x.current), pct: num(x.percentComplete), monthly: num(x.monthlyContribution), required: num(x.requiredMonthly), eta: x.estimatedCompletion ?? "", status: x.progressStatus.replace(/_/g, " ").toLowerCase() });
      rep.summary.push({ label: "Total saved toward goals", value: num(g.summary.totalCurrent) as number });
      break;
    }
    case "net-worth": {
      const n = await netWorth(ctx, { view, months: 24 });
      rep.columns = [col("month", "Month"), col("assets", "Assets", M), col("liabilities", "Liabilities", M), col("netWorth", "Net worth", M), col("change", "Change", M)];
      for (const h of n.history) rep.rows.push({ month: h.month, assets: num(h.assets), liabilities: num(h.liabilities), netWorth: num(h.netWorth), change: num(h.change) });
      rep.summary.push({ label: "Net worth today", value: num(n.netWorth) as number }, { label: "Assets", value: num(n.assets) as number }, { label: "Liabilities", value: num(n.liabilities) as number });
      rep.notes.push(...n.notes);
      break;
    }
    case "account-balances": {
      const a = await listAccounts(ctx, view);
      rep.columns = [col("account", "Account"), col("institution", "Institution"), col("type", "Type"), col("owner", "Owner"), col("sharing", "Sharing"), col("balance", "Balance", M), col("currency", "Currency")];
      for (const x of a.items) rep.rows.push({ account: x.name, institution: x.institution ?? "", type: x.type.replace(/_/g, " ").toLowerCase(), owner: x.owner?.name ?? "Joint", sharing: x.visibility.toLowerCase(), balance: num(x.currentBalance), currency: x.currency });
      rep.summary.push({ label: "Total assets", value: num(a.totals.assets) as number }, { label: "Total liabilities", value: num(a.totals.liabilities) as number }, { label: "Net", value: num(a.totals.netWorth) as number });
      break;
    }
    case "member-contribution": {
      const c = await contributionReport(ctx, from, to);
      rep.subtitle = `${c.arrangement.label}. Period ${from} to ${to}. Currency ${ctx.base}.`;
      rep.columns = [col("member", "Member"), col("net", "Monthly net income", M), col("paid", "Paid in total", M), col("shared", "Paid toward shared costs", M), col("bills", "Shared bills paid", M), col("joint", "Moved to joint accounts", M), col("allocated", "Allocated to member", M), col("share", "Share of shared costs", M), col("savings", "Savings contributions", M), col("debt", "Debt payments", M), col("position", "Net position", M)];
      for (const m of c.members) rep.rows.push({ member: m.member?.name ?? "", net: num(m.monthlyNetIncome), paid: num(m.paidTotal), shared: num(m.paidForSharedExpenses), bills: num(m.sharedBillsPaid), joint: num(m.transfersToJointAccounts), allocated: num(m.allocatedPersonal), share: num(m.shareOfSharedExpenses), savings: num(m.savingsContributions), debt: num(m.debtPayments), position: num(m.netPosition) });
      rep.summary.push({ label: "Shared expenses", value: num(c.pool) as number }, { label: "Allocated to individual members", value: num(c.personalTotal) as number });
      rep.notes.push(c.explanation, ...c.notes);
      break;
    }
    case "member-comparison": {
      const c = await memberComparison(ctx, from, to);
      rep.columns = [col("member", "Member"), col("gross", "Monthly gross income", M), col("net", "Monthly net income", M), col("recorded", "Expenses recorded", M), col("shared", "Household expenses paid", M), col("savings", "Savings contributions", M), col("debt", "Debt payments", M), col("goals", "Goal contributions", M)];
      for (const m of c.members) rep.rows.push({ member: m.member?.name ?? "", gross: num(m.monthlyGrossIncome), net: num(m.monthlyNetIncome), recorded: num(m.expensesRecorded), shared: num(m.householdExpensesPaid), savings: num(m.savingsContributions), debt: num(m.debtPayments), goals: num(m.goalContributions) });
      rep.notes.push(...c.notes);
      break;
    }
    case "recurring-expenses": {
      const [b, s, i, r] = await Promise.all([listBills(ctx, view), listSubscriptions(ctx, view), listInsurance(ctx, view), listRecurring(ctx, view)]);
      rep.columns = [col("kind", "Type"), col("name", "Name"), col("frequency", "Frequency"), col("amount", "Amount", M), col("monthly", "Monthly equivalent", M), col("owner", "Owner"), col("next", "Next date")];
      for (const x of b.filter((y) => y.active)) rep.rows.push({ kind: "Bill", name: x.name, frequency: x.frequency.toLowerCase().replace(/_/g, "-"), amount: num(x.amount), monthly: num(x.monthlyEquivalent), owner: x.owner?.name ?? "Joint", next: x.currentDue });
      for (const x of s.items.filter((y) => y.active)) rep.rows.push({ kind: "Subscription", name: x.name, frequency: x.frequency.toLowerCase().replace(/_/g, "-"), amount: num(x.amount), monthly: num(x.monthlyCost), owner: x.owner?.name ?? "Joint", next: x.nextBillingDate });
      for (const x of i.items.filter((y) => y.active)) rep.rows.push({ kind: "Insurance", name: x.policyName, frequency: x.frequency.toLowerCase().replace(/_/g, "-"), amount: num(x.premium), monthly: num(x.monthlyCost), owner: x.owner?.name ?? "Joint", next: x.renewalDate });
      for (const x of r.filter((y) => y.active && y.type === "EXPENSE")) rep.rows.push({ kind: "Recurring", name: x.description, frequency: x.frequency.toLowerCase().replace(/_/g, "-"), amount: num(x.amount), monthly: null, owner: x.owner?.name ?? "Joint", next: x.nextDate });
      rep.summary.push({ label: "Monthly equivalent (bills, subscriptions, insurance)", value: Number(rep.rows.reduce((a, x) => a + (Number(x.monthly) || 0), 0).toFixed(2)) });
      break;
    }
    case "transactions": {
      const t = await allTransactions(ctx, { view, from, to, sort: "date_asc" });
      rep.columns = [col("date", "Date"), col("description", "Description"), col("category", "Category"), col("account", "Account"), col("type", "Type"), col("owner", "Owner"), col("payer", "Paid by"), col("entered", "Entered by"), col("amount", "Amount", M)];
      for (const x of t.items) rep.rows.push({ date: x.date, description: x.description, category: x.categoryName ?? "", account: x.accountName, type: x.type.toLowerCase(), owner: x.owner?.name ?? "", payer: x.paidByHousehold ? "Household" : x.payer?.name ?? "", entered: x.enteredBy?.name ?? "", amount: num(x.amount) });
      if (t.truncated) rep.notes.push(`Showing the first ${t.items.length} of ${t.total} transactions. Narrow the date range to see the rest.`);
      rep.summary.push({ label: "Income", value: num(t.summary.income) as number }, { label: "Expenses", value: num(t.summary.expenses) as number });
      break;
    }
  }
  return rep;
}
export { memberRef, categoryParents, loadCategories, spendByCategory, rollUpToRoot };
