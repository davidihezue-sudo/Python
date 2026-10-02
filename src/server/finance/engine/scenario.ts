// What-if scenarios. A scenario is a list of assumptions applied to a COPY of the baseline; the real records are never touched.
import { D, Dec, ZERO, round2, sum, type Dec as DecT, type DecLike } from "./decimal";
import { addMonths, type IsoDate } from "./dates";
import { runForecast, type AmountMod, type Baseline, type DebtItem, type ForecastResult, type OutflowItem } from "./forecast";
import { planMortgage } from "./mortgage";

export type Assumption =
  | { type: "INCOME_CHANGE"; target: "ALL" | { memberId: string } | { incomeId: string }; mode: "PCT" | "AMOUNT"; value: number | string; startMonth?: number }
  | { type: "JOB_LOSS"; target: "ALL" | { memberId: string } | { incomeId: string }; startMonth?: number; durationMonths?: number | null; severance?: number | string }
  | { type: "JOB_CHANGE"; target: { memberId: string } | { incomeId: string }; gapMonths?: number; newNetPerPayment: number | string; startMonth?: number }
  | { type: "ADD_INCOME"; monthlyAmount: number | string; startMonth?: number; durationMonths?: number | null; label?: string }
  | { type: "BONUS"; amount: number | string; month?: number; label?: string }
  | { type: "EXPENSE_CHANGE"; target: { outflowId: string } | { kind: OutflowItem["kind"] | "VARIABLE" } | "ALL_SCHEDULED"; mode: "PCT" | "AMOUNT"; value: number | string; startMonth?: number }
  | { type: "ONE_TIME_EXPENSE"; amount: number | string; month?: number; label?: string }
  | { type: "REDUCE_DISCRETIONARY"; mode: "PCT" | "AMOUNT"; value: number | string; startMonth?: number }
  | { type: "SAVINGS_CHANGE"; goalId?: string | null; extraMonthly: number | string; startMonth?: number }
  | { type: "EXTRA_DEBT_PAYMENT"; debtId?: string | null; extraMonthly: number | string; startMonth?: number }
  | { type: "DEBT_PAYOFF"; debtId: string; month?: number; fundFromSavingsFirst?: boolean }
  | { type: "CONTRIBUTION_CHANGE"; monthlyDelta: number | string; startMonth?: number }
  | { type: "HOME_PURCHASE"; price: number | string; downPayment: number | string; aprPercent: number | string; amortisationYears: number; closingCostsPct?: number | string; propertyTaxAnnual?: number | string; insuranceAnnual?: number | string; heatingMonthly?: number | string; condoFeesMonthly?: number | string; rentRemovedMonthly?: number | string; month?: number };

export const SCENARIO_TYPES: Record<Assumption["type"], string> = {
  INCOME_CHANGE: "Change income (raise or cut)",
  JOB_LOSS: "Lose a job or income",
  JOB_CHANGE: "Change jobs",
  ADD_INCOME: "Add recurring income",
  BONUS: "Receive a bonus",
  EXPENSE_CHANGE: "Change an expense",
  ONE_TIME_EXPENSE: "Large one-time expense",
  REDUCE_DISCRETIONARY: "Reduce discretionary spending",
  SAVINGS_CHANGE: "Change monthly savings",
  EXTRA_DEBT_PAYMENT: "Extra debt payments",
  DEBT_PAYOFF: "Pay off a debt in full",
  CONTRIBUTION_CHANGE: "Change a member contribution to shared costs",
  HOME_PURCHASE: "Buy a home",
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Dec ? { __d: x.toString() } : x)), (_k, x) => (x && typeof x === "object" && "__d" in x ? new Dec(x.__d) : x));

/**
 * Applies assumptions to a copy of the baseline. Month offsets are counted from the baseline date (0 = the first month of the forecast).
 * Returns the modified baseline and plain-language notes describing exactly what changed.
 */
export function applyAssumptions(base: Baseline, assumptions: Assumption[]): { baseline: Baseline; notes: string[] } {
  const b = clone(base);
  const notes: string[] = [];
  const at = (off = 0): IsoDate => addMonths(b.asOf, off);
  const startOf = (off = 0): IsoDate => {
    const d = addMonths(b.asOf, off);
    return off === 0 ? addMonths(b.asOf, 0) : `${d.slice(0, 7)}-01`;
  };
  const addId = (n: number) => `scn-${n}`;
  let n = 0;
  const selectIncomes = (t: "ALL" | { memberId: string } | { incomeId: string }) => b.incomes.filter((i) => t === "ALL" || ("memberId" in t ? i.memberId === t.memberId : i.id === t.incomeId));

  for (const a of assumptions) {
    n++;
    switch (a.type) {
      case "INCOME_CHANGE": {
        const targets = selectIncomes(a.target);
        const mod: AmountMod = a.mode === "PCT" ? { from: startOf(a.startMonth ?? 0), factor: D(1).plus(D(a.value).div(100)) } : { from: startOf(a.startMonth ?? 0), delta: a.value };
        for (const t of targets) (t.mods ??= []).push(mod);
        notes.push(`Income ${a.mode === "PCT" ? `${a.value}%` : `${a.value} per payment`} on ${targets.length} source(s) from month ${(a.startMonth ?? 0) + 1}.`);
        break;
      }
      case "JOB_LOSS": {
        const targets = selectIncomes(a.target);
        const from = startOf(a.startMonth ?? 0);
        const to = a.durationMonths ? addMonths(from, a.durationMonths) : null;
        for (const t of targets) (t.mods ??= []).push({ from, to: to ? addMonths(from, a.durationMonths as number) : null, paused: true });
        if (a.severance && D(a.severance).gt(0)) b.oneOffs.push({ id: addId(n), date: from, amount: D(a.severance), label: "Severance", kind: "INCOME" });
        notes.push(`${targets.length} income source(s) stop from month ${(a.startMonth ?? 0) + 1}${a.durationMonths ? ` for ${a.durationMonths} month(s)` : " indefinitely"}.`);
        break;
      }
      case "JOB_CHANGE": {
        const targets = selectIncomes(a.target);
        const from = startOf(a.startMonth ?? 0);
        const resume = addMonths(from, a.gapMonths ?? 0);
        for (const t of targets) {
          const old = D(t.net);
          if ((a.gapMonths ?? 0) > 0) (t.mods ??= []).push({ from, to: resume, paused: true });
          (t.mods ??= []).push({ from: resume, delta: D(a.newNetPerPayment).minus(old) });
        }
        notes.push(`Job change: net pay becomes ${a.newNetPerPayment} per payment after a ${a.gapMonths ?? 0} month gap.`);
        break;
      }
      case "ADD_INCOME": {
        const from = startOf(a.startMonth ?? 0);
        b.incomes.push({ id: addId(n), name: a.label ?? "Additional income", net: a.monthlyAmount, frequency: "MONTHLY", anchor: from, end: a.durationMonths ? addMonths(from, a.durationMonths) : null });
        notes.push(`Extra income of ${a.monthlyAmount} per month from month ${(a.startMonth ?? 0) + 1}.`);
        break;
      }
      case "BONUS":
        b.oneOffs.push({ id: addId(n), date: at(a.month ?? 1), amount: D(a.amount), label: a.label ?? "Bonus", kind: "INCOME" });
        notes.push(`One-time income of ${a.amount} in month ${(a.month ?? 1) + 1}.`);
        break;
      case "EXPENSE_CHANGE": {
        const from = startOf(a.startMonth ?? 0);
        const mod: AmountMod = a.mode === "PCT" ? { from, factor: D(1).plus(D(a.value).div(100)) } : { from, delta: a.value };
        if (a.target === "ALL_SCHEDULED") for (const o of b.outflows) (o.mods ??= []).push(mod);
        else if ("outflowId" in a.target) for (const o of b.outflows) if (o.id === a.target.outflowId) (o.mods ??= []).push(mod);
        else void 0;
        if (typeof a.target === "object" && "kind" in a.target) {
          if (a.target.kind === "VARIABLE") {
            (b.variableMods ??= []).push(a.mode === "PCT" ? mod : { from, delta: a.value });
          } else for (const o of b.outflows) if (o.kind === (a.target as { kind: string }).kind) (o.mods ??= []).push(mod);
        }
        notes.push(`Expense change of ${a.mode === "PCT" ? `${a.value}%` : `${a.value} each time`} from month ${(a.startMonth ?? 0) + 1}.`);
        break;
      }
      case "ONE_TIME_EXPENSE":
        b.oneOffs.push({ id: addId(n), date: at(a.month ?? 1), amount: D(a.amount).negated(), label: a.label ?? "One-time expense", kind: "EXPENSE" });
        notes.push(`One-time expense of ${a.amount} in month ${(a.month ?? 1) + 1}.`);
        break;
      case "REDUCE_DISCRETIONARY": {
        const from = startOf(a.startMonth ?? 0);
        (b.variableMods ??= []).push(a.mode === "PCT" ? { from, factor: D(1).minus(D(a.value).div(100)) } : { from, delta: D(a.value).negated() });
        notes.push(`Discretionary spending reduced by ${a.mode === "PCT" ? `${a.value}%` : `${a.value} per month`}.`);
        break;
      }
      case "SAVINGS_CHANGE": {
        const from = startOf(a.startMonth ?? 0);
        const goals = a.goalId ? b.goals.filter((g) => g.id === a.goalId) : b.goals.slice(0, 1);
        if (!goals.length) b.goals.push({ id: addId(n), name: "Extra savings", monthly: 0, remaining: null, extra: [{ from, amount: a.extraMonthly }] });
        else for (const g of goals) (g.extra ??= []).push({ from, amount: a.extraMonthly });
        notes.push(`Savings increased by ${a.extraMonthly} per month.`);
        break;
      }
      case "EXTRA_DEBT_PAYMENT": {
        const from = startOf(a.startMonth ?? 0);
        const targets = a.debtId ? b.debts.filter((d) => d.id === a.debtId) : [...b.debts].sort((x, y) => D(y.aprPercent).comparedTo(D(x.aprPercent))).slice(0, 1);
        for (const d of targets) (d.extraMonthly ??= []).push({ from, amount: a.extraMonthly });
        notes.push(`Extra debt payment of ${a.extraMonthly} per month toward ${targets.map((t) => t.name).join(", ") || "no debt"}.`);
        break;
      }
      case "DEBT_PAYOFF": {
        const d = b.debts.find((x) => x.id === a.debtId);
        if (d) b.oneOffs.push({ id: addId(n), date: at(a.month ?? 1), amount: D(d.balance).negated(), label: `Pay off ${d.name}`, kind: "DEBT_LUMP", debtId: d.id, fundFromSavingsFirst: a.fundFromSavingsFirst ?? true });
        notes.push(`Pay off ${d?.name ?? "debt"} in full in month ${(a.month ?? 1) + 1}.`);
        break;
      }
      case "CONTRIBUTION_CHANGE": {
        const from = startOf(a.startMonth ?? 0);
        const delta = D(a.monthlyDelta);
        // a higher contribution is a personal outflow; a lower one frees cash. Between members it is neutral for the household.
        if (delta.gt(0)) b.outflows.push({ id: addId(n), name: "Higher contribution to shared costs", kind: "RECURRING", amount: delta, frequency: "MONTHLY", anchor: from });
        else if (delta.lt(0)) b.incomes.push({ id: addId(n), name: "Lower contribution to shared costs", net: delta.negated(), frequency: "MONTHLY", anchor: from });
        notes.push(`Contribution to shared costs changes by ${delta.toFixed(2)} per month. This is a transfer between members, so it changes an individual forecast but not the household total.`);
        break;
      }
      case "HOME_PURCHASE": {
        const plan = planMortgage({ price: a.price, downPayment: a.downPayment, aprPercent: a.aprPercent, amortisationYears: a.amortisationYears, closingCostsPct: a.closingCostsPct ?? 1.5, propertyTaxAnnual: a.propertyTaxAnnual, insuranceAnnual: a.insuranceAnnual, heatingMonthly: a.heatingMonthly, condoFeesMonthly: a.condoFeesMonthly });
        const date = at(a.month ?? 1);
        b.oneOffs.push({ id: addId(n), date, amount: plan.cashRequired.negated(), label: "Down payment and closing costs", kind: "ASSET_PURCHASE", assetValue: D(a.price), fundFromSavingsFirst: true });
        const mortgage: DebtItem = { id: `${addId(n)}-mortgage`, name: "New mortgage", balance: plan.principal, aprPercent: a.aprPercent, compoundingPerYear: 2, payment: plan.monthlyEquivalent, frequency: "MONTHLY", nextDue: addMonths(date, 1) };
        (b.newDebts ??= []).push(mortgage);
        const addCost = (name: string, amt: DecLike) => {
          if (D(amt).gt(0)) b.outflows.push({ id: `${addId(n)}-${name}`, name, kind: "HOUSING_NEW", amount: amt, frequency: "MONTHLY", anchor: addMonths(date, 1), essential: true });
        };
        addCost("Property tax (new home)", D(a.propertyTaxAnnual).div(12));
        addCost("Home insurance (new home)", D(a.insuranceAnnual).div(12));
        addCost("Heating (new home)", a.heatingMonthly);
        addCost("Condo fees (new home)", a.condoFeesMonthly);
        if (a.rentRemovedMonthly && D(a.rentRemovedMonthly).gt(0)) {
          const from = addMonths(date, 1);
          (b.variableMods ??= []).push({ from, delta: 0 });
          for (const o of b.outflows) if (o.kind === "BILL" && /rent/i.test(o.name)) (o.mods ??= []).push({ from, delta: D(a.rentRemovedMonthly).negated() });
        }
        notes.push(`Buy a home for ${a.price} in month ${(a.month ?? 1) + 1}: ${plan.cashRequired.toFixed(2)} cash needed, mortgage ${plan.principal.toFixed(2)} at ${plan.monthlyEquivalent.toFixed(2)} per month.`);
        break;
      }
    }
  }
  return { baseline: b, notes };
}

export interface ScenarioComparison {
  current: ForecastResult;
  simulated: ForecastResult;
  notes: string[];
  difference: {
    monthlyCashFlow: DecT; // average monthly net cash flow, simulated minus current
    savings: DecT; // end savings difference
    debt: DecT; // end debt difference (negative = less debt)
    netWorth: DecT;
    liquid: DecT;
    interest: DecT;
  };
  monthly: { month: string; currentNetWorth: DecT; simulatedNetWorth: DecT; currentCashFlow: DecT; simulatedCashFlow: DecT; currentLiquid: DecT; simulatedLiquid: DecT }[];
}

export function runScenario(base: Baseline, assumptions: Assumption[], horizon: { months: number }): ScenarioComparison {
  const current = runForecast(base, horizon);
  const { baseline, notes } = applyAssumptions(base, assumptions);
  const simulated = runForecast(baseline, horizon);
  const n = Math.max(1, current.months.length);
  const avg = (f: ForecastResult) => f.totals.netCashFlow.div(n);
  return {
    current,
    simulated,
    notes,
    difference: {
      monthlyCashFlow: round2(avg(simulated).minus(avg(current))),
      savings: round2(simulated.end.savings.minus(current.end.savings)),
      debt: round2(simulated.end.debt.minus(current.end.debt)),
      netWorth: round2(simulated.end.netWorth.minus(current.end.netWorth)),
      liquid: round2(simulated.end.liquid.minus(current.end.liquid)),
      interest: round2(simulated.totals.interest.minus(current.totals.interest)),
    },
    monthly: current.months.map((m, i) => ({ month: m.month, currentNetWorth: m.endNetWorth, simulatedNetWorth: simulated.months[i]?.endNetWorth ?? m.endNetWorth, currentCashFlow: m.netCashFlow, simulatedCashFlow: simulated.months[i]?.netCashFlow ?? m.netCashFlow, currentLiquid: m.endLiquid, simulatedLiquid: simulated.months[i]?.endLiquid ?? m.endLiquid })),
  };
}

export { ZERO, sum };
