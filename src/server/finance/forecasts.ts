// Forecasting and what-if scenarios. The baseline is built from the records the actor may see in the chosen view,
// so private information is never exposed through a forecast. Scenarios operate on a copy and never touch real records.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { addMonths, endOfMonth, startOfMonth, addDays } from "./engine/dates";
import { monthlyAmount, type Frequency } from "./engine/frequency";
import { runForecast, type Baseline, type ForecastResult } from "./engine/forecast";
import { applyAssumptions, runScenario, SCENARIO_TYPES, type Assumption } from "./engine/scenario";
import { audit } from "../services/audit";
import { dateIso, id, text, optText } from "./common";
import { requireWriter, type FinCtx, type View } from "./access";
import { loadBooks, loadFx, loadReportTxs, nwInputs } from "./load";
import { computeNetWorth } from "./engine/networth";
import { netExpense } from "./analytics";
import { listBills } from "./bills";
import { listSubscriptions, listInsurance, listRecurring } from "./bills";
import { listDebts } from "./debts";
import { listGoals } from "./goals";
import { listIncome } from "./income";

export const forecastQuery = z.object({ view: z.enum(["my", "household"]).default("household"), months: z.coerce.number().int().min(1).max(60).optional(), days: z.coerce.number().int().min(7).max(1825).optional(), savingsInterestPct: z.coerce.number().min(0).max(30).default(0), investmentReturnPct: z.coerce.number().min(-50).max(50).default(0), assetGrowthPct: z.coerce.number().min(-50).max(50).default(0), varMonths: z.coerce.number().int().min(1).max(12).default(3) });
type Q = z.infer<typeof forecastQuery>;

export async function buildBaseline(ctx: FinCtx, q: Pick<Q, "view" | "savingsInterestPct" | "investmentReturnPct" | "assetGrowthPct" | "varMonths">): Promise<Baseline> {
  const view: View = q.view;
  const asOf = ctx.today;
  const books = await loadBooks(ctx, { view });
  const inputs = { ...(await nwInputs(ctx, view)), txs: books.balanceTxs, baseCurrency: ctx.base, fx: books.fx };
  const nw = computeNetWorth({ ...inputs, asOf });
  const sumGroup = (gs: string[]) => nw.lines.filter((l) => l.side === "asset" && gs.includes(l.group)).reduce((a, l) => a.plus(l.value), ZERO);
  // overdrafts on asset accounts are negative cash
  const overdraft = nw.lines.filter((l) => l.side === "liability" && ["other_liabilities"].includes(l.group)).reduce((a, l) => a.plus(l.value), ZERO);
  const fx = await loadFx(ctx);
  const cv = (v: string | Dec, cur: string, on = asOf) => fx.convert(v, cur, ctx.base, on)?.amount ?? null;

  const [income, bills, subs, ins, rec, debts, goals] = await Promise.all([listIncome(ctx, view), listBills(ctx, view), listSubscriptions(ctx, view), listInsurance(ctx, view), listRecurring(ctx, view), listDebts(ctx, view), listGoals(ctx, view)]);
  const incomes: Baseline["incomes"] = [];
  for (const i of income) {
    if (!i.active || i.frequency === "IRREGULAR") continue;
    const net = cv(i.netAmount, i.currency);
    if (net) incomes.push({ id: i.id, name: i.name, memberId: i.ownerMemberId, net, frequency: i.frequency as Frequency, anchor: i.nextPayDate ?? asOf, start: i.startDate, end: i.endDate, pausedFrom: i.pausedFrom, pausedUntil: i.pausedUntil });
  }
  const outflows: Baseline["outflows"] = [];
  for (const b of bills.filter((x) => x.active)) { const a = cv(b.amount, b.currency); if (a) outflows.push({ id: b.id, name: b.name, kind: "BILL", amount: a, frequency: b.frequency as Frequency, anchor: b.dueDate as string, end: b.endDate, essential: true }); }
  for (const s of subs.items.filter((x) => x.active)) { const a = cv(s.amount, s.currency); if (a) outflows.push({ id: s.id, name: s.name, kind: "SUBSCRIPTION", amount: a, frequency: s.frequency as Frequency, anchor: s.nextBillingDate as string }); }
  for (const p of ins.items.filter((x) => x.active)) { const a = cv(p.premium, p.currency); if (a) outflows.push({ id: p.id, name: p.policyName, kind: "INSURANCE", amount: a, frequency: p.frequency as Frequency, anchor: p.renewalDate ?? asOf, essential: true }); }
  for (const r of rec.filter((x) => x.active && x.type !== "TRANSFER")) {
    const a = D(r.amount);
    if (r.type === "EXPENSE") outflows.push({ id: r.id, name: r.description, kind: "RECURRING", amount: a, frequency: r.frequency as Frequency, anchor: r.nextDate ?? r.startDate as string, end: r.endDate });
    else incomes.push({ id: r.id, name: r.description, net: a, frequency: r.frequency as Frequency, anchor: r.nextDate ?? r.startDate as string, end: r.endDate, memberId: r.ownerMemberId });
  }
  const debtItems: Baseline["debts"] = debts.items.filter((d) => d.active && D(d.outstanding).gt(0)).map((d) => ({ id: d.id, name: d.name, balance: cv(d.outstanding, d.currency) ?? ZERO, aprPercent: d.interestRate, compoundingPerYear: d.compoundingPerYear, payment: cv(D(d.regularPayment).gt(0) ? d.regularPayment : d.minimumPayment, d.currency) ?? ZERO, frequency: d.frequency as Frequency, nextDue: d.nextDueDate }));
  const goalItems: Baseline["goals"] = goals.items.filter((g) => g.status === "ACTIVE" && D(g.monthlyContribution).gt(0) && g.tracking === "CONTRIBUTIONS").map((g) => ({ id: g.id, name: g.name, monthly: g.monthlyContribution, remaining: D(g.target).gt(0) ? g.remaining : null }));

  // spending not covered by a schedule: trailing average of unscheduled expenses
  const from = addMonths(startOfMonth(asOf), -q.varMonths), to = endOfMonth(addMonths(startOfMonth(asOf), -1));
  const hist = await loadReportTxs(ctx, from, to, view);
  let variable = ZERO;
  for (const t of hist.txs) { const ne = netExpense(t); if (ne && !t.scheduled) variable = variable.plus(ne); }
  const irrIds = new Set(income.filter((i) => i.frequency === "IRREGULAR").map((i) => i.id));
  const yFrom = addMonths(startOfMonth(asOf), -12);
  const yHist = irrIds.size ? await loadReportTxs(ctx, yFrom, to, view) : { txs: [] };
  const irregular = yHist.txs.filter((t) => t.type === "INCOME" && t.base && t.incomeSourceId && irrIds.has(t.incomeSourceId)).reduce((a, t) => a.plus(t.base), ZERO);
  const raw = db;
  void raw;
  return {
    asOf, currency: ctx.base, liquid: sumGroup(["cash"]).minus(overdraft), savings: sumGroup(["savings"]), investments: sumGroup(["investments"]), otherAssets: sumGroup(["property", "vehicles", "other_assets"]), assets: [],
    incomes, outflows, debts: debtItems, goals: goalItems, oneOffs: [], variableMonthly: variable.div(q.varMonths).toDecimalPlaces(2), irregularIncomeMonthly: irrIds.size ? irregular.div(12).toDecimalPlaces(2) : ZERO,
    assumptions: { savingsInterestPct: q.savingsInterestPct, investmentReturnPct: q.investmentReturnPct, assetGrowthPct: q.assetGrowthPct, variableSpendingMonthsBasis: q.varMonths, notes: [q.view === "household" ? "Household forecast: only records shared with the household (or with you) are included." : "Personal forecast: only records you own are included.", ...(nw.unconverted.length ? [`Excluded for missing exchange rates: ${nw.unconverted.join(", ")}.`] : [])] },
  };
}

const m2 = (d: Dec) => money(d);
export function wireForecast(f: ForecastResult) {
  return {
    from: f.from, to: f.to, start: { liquid: m2(f.start.liquid), savings: m2(f.start.savings), debt: m2(f.start.debt), netWorth: m2(f.start.netWorth) }, end: { liquid: m2(f.end.liquid), savings: m2(f.end.savings), debt: m2(f.end.debt), netWorth: m2(f.end.netWorth) },
    totals: Object.fromEntries(Object.entries(f.totals).map(([k, v]) => [k, m2(v)])), firstShortfallDate: f.firstShortfallDate, lowestLiquid: { date: f.lowestLiquid.date, amount: m2(f.lowestLiquid.amount) }, debtFreeDate: f.debtFreeDate, warnings: f.warnings, assumptions: f.assumptions,
    months: f.months.map((m) => ({ month: m.month, partial: m.partial, kind: "forecast", income: m2(m.income), expenses: m2(m.expenses), interest: m2(m.interest), netCashFlow: m2(m.netCashFlow), debtPrincipalPaid: m2(m.debtPrincipalPaid), savingsContributions: m2(m.savingsContributions), endLiquid: m2(m.endLiquid), endSavings: m2(m.endSavings), endInvestments: m2(m.endInvestments), endOtherAssets: m2(m.endOtherAssets), endDebt: m2(m.endDebt), endNetWorth: m2(m.endNetWorth) })),
    daily: f.daily.filter((_, i) => i % (f.daily.length > 400 ? 7 : 1) === 0).map((d) => ({ date: d.date, liquid: m2(d.liquid) })),
  };
}
export async function forecast(ctx: FinCtx, q: Q) {
  const base = await buildBaseline(ctx, q);
  const horizon = q.months ? { months: q.months } : { days: q.days ?? 365 };
  const f = runForecast(base, horizon);
  // actual history for the same view, so actual and forecast are visibly separate
  const hist = await loadReportTxs(ctx, addMonths(startOfMonth(ctx.today), -5), ctx.today, q.view);
  const { monthlySeries } = await import("./engine/ledger");
  const actual = monthlySeries(hist.txs, addMonths(startOfMonth(ctx.today), -5), ctx.today).map((m) => ({ month: m.month, kind: "actual", income: m2(m.income), expenses: m2(m.expenses), netCashFlow: m2(m.netCashFlow) }));
  return { view: q.view, currency: ctx.base, asOf: ctx.today, basis: { variableMonthly: m2(D(base.variableMonthly)), irregularIncomeMonthly: m2(D(base.irregularIncomeMonthly)), scheduledIncomeItems: base.incomes.length, scheduledOutflowItems: base.outflows.length, debts: base.debts.length, goals: base.goals.length }, actual, forecast: wireForecast(f), disclaimer: "A forecast is an estimate built from scheduled items and past averages. It is not a guaranteed outcome." };
}

// ───────────────────────── Scenarios
const num = z.union([z.string(), z.number()]);
const target = z.union([z.literal("ALL"), z.object({ memberId: id }), z.object({ incomeId: id })]);
export const assumptionSchema: z.ZodType<Assumption> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("INCOME_CHANGE"), target, mode: z.enum(["PCT", "AMOUNT"]), value: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("JOB_LOSS"), target, startMonth: z.number().int().min(0).max(60).optional(), durationMonths: z.number().int().min(1).max(60).nullish(), severance: num.optional() }),
  z.object({ type: z.literal("JOB_CHANGE"), target: z.union([z.object({ memberId: id }), z.object({ incomeId: id })]), gapMonths: z.number().int().min(0).max(24).optional(), newNetPerPayment: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("ADD_INCOME"), monthlyAmount: num, startMonth: z.number().int().min(0).max(60).optional(), durationMonths: z.number().int().min(1).max(60).nullish(), label: z.string().max(60).optional() }),
  z.object({ type: z.literal("BONUS"), amount: num, month: z.number().int().min(0).max(60).optional(), label: z.string().max(60).optional() }),
  z.object({ type: z.literal("EXPENSE_CHANGE"), target: z.union([z.literal("ALL_SCHEDULED"), z.object({ outflowId: id }), z.object({ kind: z.enum(["BILL", "SUBSCRIPTION", "INSURANCE", "RECURRING", "HOUSING_NEW", "VARIABLE"]) })]), mode: z.enum(["PCT", "AMOUNT"]), value: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("ONE_TIME_EXPENSE"), amount: num, month: z.number().int().min(0).max(60).optional(), label: z.string().max(60).optional() }),
  z.object({ type: z.literal("REDUCE_DISCRETIONARY"), mode: z.enum(["PCT", "AMOUNT"]), value: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("SAVINGS_CHANGE"), goalId: id.nullish(), extraMonthly: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("EXTRA_DEBT_PAYMENT"), debtId: id.nullish(), extraMonthly: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("DEBT_PAYOFF"), debtId: id, month: z.number().int().min(0).max(60).optional(), fundFromSavingsFirst: z.boolean().optional() }),
  z.object({ type: z.literal("CONTRIBUTION_CHANGE"), monthlyDelta: num, startMonth: z.number().int().min(0).max(60).optional() }),
  z.object({ type: z.literal("HOME_PURCHASE"), price: num, downPayment: num, aprPercent: num, amortisationYears: z.number().int().min(5).max(40), closingCostsPct: num.optional(), propertyTaxAnnual: num.optional(), insuranceAnnual: num.optional(), heatingMonthly: num.optional(), condoFeesMonthly: num.optional(), rentRemovedMonthly: num.optional(), month: z.number().int().min(0).max(60).optional() }),
]) as never;
export const scenarioRunSchema = z.object({ view: z.enum(["my", "household"]).default("household"), months: z.number().int().min(1).max(60).default(12), assumptions: z.array(assumptionSchema).max(25), savingsInterestPct: z.number().min(0).max(30).default(0), investmentReturnPct: z.number().min(-50).max(50).default(0) });

function checkRefs(ctx: FinCtx, a: Assumption[]) {
  for (const x of a) {
    const t = (x as { target?: unknown }).target;
    if (t && typeof t === "object" && "memberId" in (t as object) && !ctx.members.some((m) => m.id === (t as { memberId: string }).memberId)) throw new AppError("VALIDATION_ERROR", "Unknown household member in scenario");
  }
}
export async function runScenarioService(ctx: FinCtx, input: z.infer<typeof scenarioRunSchema>) {
  checkRefs(ctx, input.assumptions);
  const base = await buildBaseline(ctx, { view: input.view, savingsInterestPct: input.savingsInterestPct, investmentReturnPct: input.investmentReturnPct, assetGrowthPct: 0, varMonths: 3 });
  const assumptions = input.view === "household" ? input.assumptions.filter((a) => a.type !== "CONTRIBUTION_CHANGE") : input.assumptions;
  const r = runScenario(base, assumptions, { months: input.months });
  const w = (f: ForecastResult) => wireForecast(f);
  const notes = [...r.notes, ...(assumptions.length < input.assumptions.length ? ["A contribution change between members does not alter household totals, so it was not applied to the household forecast. Switch to My Finances to see its effect on you."] : [])];
  return {
    view: input.view, currency: ctx.base, months: input.months, realRecordsChanged: false, notes,
    current: w(r.current), simulated: w(r.simulated),
    difference: { monthlyCashFlow: m2(r.difference.monthlyCashFlow), savings: m2(r.difference.savings), debt: m2(r.difference.debt), netWorth: m2(r.difference.netWorth), liquid: m2(r.difference.liquid), interest: m2(r.difference.interest) },
    monthly: r.monthly.map((m) => ({ month: m.month, currentNetWorth: m2(m.currentNetWorth), simulatedNetWorth: m2(m.simulatedNetWorth), currentCashFlow: m2(m.currentCashFlow), simulatedCashFlow: m2(m.simulatedCashFlow), currentLiquid: m2(m.currentLiquid), simulatedLiquid: m2(m.simulatedLiquid) })),
    types: SCENARIO_TYPES,
  };
}

export const scenarioSaveSchema = z.object({ name: text(100), description: optText(300), view: z.enum(["my", "household"]).default("household"), horizonMonths: z.number().int().min(1).max(60).default(12), assumptions: z.array(assumptionSchema).max(25) });
// Saved scenarios are private to their creator: they are derived from the creator's permitted data.
export async function listScenarios(ctx: FinCtx) {
  const rows = await db.finScenario.findMany({ where: { householdId: ctx.householdId, createdById: ctx.actor.id, kind: "WHAT_IF" }, orderBy: { updatedAt: "desc" } });
  return rows.map((s) => ({ id: s.id, name: s.name, description: s.description, horizonMonths: s.horizonMonths, assumptions: (s.assumptions as { view?: string; items?: unknown[] }).items ?? [], view: (s.assumptions as { view?: string }).view ?? "household", updatedAt: s.updatedAt.toISOString() }));
}
export async function saveScenario(ctx: FinCtx, input: z.infer<typeof scenarioSaveSchema>, scenarioId?: string) {
  requireWriter(ctx);
  checkRefs(ctx, input.assumptions);
  const data = { name: input.name, description: input.description ?? null, horizonMonths: input.horizonMonths, assumptions: { view: input.view, items: input.assumptions } as never };
  if (scenarioId) {
    const s = await db.finScenario.findFirst({ where: { id: scenarioId, householdId: ctx.householdId, createdById: ctx.actor.id } });
    if (!s) throw new AppError("NOT_FOUND", "Scenario not found");
    await db.finScenario.update({ where: { id: s.id }, data });
    return { id: s.id };
  }
  const s = await db.finScenario.create({ data: { householdId: ctx.householdId, createdById: ctx.actor.id, kind: "WHAT_IF", ...data } });
  await audit(null, ctx.actor, { entity: "FinScenario", entityId: s.id, action: "create", householdId: ctx.householdId });
  return { id: s.id };
}
export async function deleteScenario(ctx: FinCtx, scenarioId: string) {
  const s = await db.finScenario.findFirst({ where: { id: scenarioId, householdId: ctx.householdId, createdById: ctx.actor.id } });
  if (!s) throw new AppError("NOT_FOUND", "Scenario not found");
  await db.finScenario.delete({ where: { id: s.id } });
  return { ok: true };
}
export async function compareScenarios(ctx: FinCtx, ids: string[]) {
  const rows = await db.finScenario.findMany({ where: { id: { in: ids }, householdId: ctx.householdId, createdById: ctx.actor.id } });
  const out = [];
  for (const s of rows) {
    const a = s.assumptions as { view?: "my" | "household"; items?: Assumption[] };
    const r = await runScenarioService(ctx, { view: a.view ?? "household", months: s.horizonMonths, assumptions: (a.items ?? []) as never, savingsInterestPct: 0, investmentReturnPct: 0 });
    out.push({ id: s.id, name: s.name, view: r.view, months: r.months, difference: r.difference, endNetWorth: r.simulated.end.netWorth, currentEndNetWorth: r.current.end.netWorth, endLiquid: r.simulated.end.liquid, endDebt: r.simulated.end.debt, firstShortfallDate: r.simulated.firstShortfallDate });
  }
  return out;
}
export { applyAssumptions, endOfMonth, monthlyAmount, addDays, dateIso };
