// Forecasting engine: a deterministic day-by-day projection from a Baseline (a snapshot of real household data) plus assumptions.
// It never reads or writes the database and never mutates its inputs, so scenarios can safely reuse it.
// A forecast is an estimate built from scheduled items and historical averages. It is not a guaranteed outcome.
import { D, Dec, ZERO, round2, sum, type Dec as DecT, type DecLike } from "./decimal";
import { addDays, addMonths, daysInMonth, diffDays, endOfMonth, isMonthEnd, monthOf, ymd, type IsoDate } from "./dates";
import { occurrences, type Frequency } from "./frequency";
import { periodicRate } from "./debt";
import { PER_YEAR } from "./frequency";
import { isLiabilityType } from "./ledger";

/** Time-boxed multiplier/offset applied to a scheduled amount (used by scenarios). */
export interface AmountMod {
  from: IsoDate;
  to?: IsoDate | null;
  factor?: DecLike; // multiply
  delta?: DecLike; // add (per occurrence) after the factor
  paused?: boolean;
}
export interface IncomeItem {
  id: string;
  name: string;
  memberId?: string | null;
  net: DecLike; // per payment, base currency
  frequency: Frequency;
  anchor: IsoDate; // a known pay date
  start?: IsoDate | null;
  end?: IsoDate | null;
  pausedFrom?: IsoDate | null;
  pausedUntil?: IsoDate | null;
  mods?: AmountMod[];
}
export type OutflowKind = "BILL" | "SUBSCRIPTION" | "INSURANCE" | "RECURRING" | "HOUSING_NEW";
export interface OutflowItem {
  id: string;
  name: string;
  kind: OutflowKind;
  amount: DecLike; // positive, per occurrence
  frequency: Frequency;
  anchor: IsoDate;
  end?: IsoDate | null;
  essential?: boolean;
  mods?: AmountMod[];
}
export interface DebtItem {
  id: string;
  name: string;
  balance: DecLike; // positive amount owed
  aprPercent: DecLike;
  compoundingPerYear: number;
  payment: DecLike; // regular payment per period
  frequency: Frequency;
  nextDue: IsoDate | null;
  extraMonthly?: { from: IsoDate; amount: DecLike }[];
}
export interface GoalItem {
  id: string;
  name: string;
  monthly: DecLike;
  remaining: DecLike | null; // null = no cap
  extra?: { from: IsoDate; amount: DecLike }[];
}
export interface OneOff {
  id: string;
  date: IsoDate;
  amount: DecLike; // signed: positive inflow, negative outflow
  label: string;
  kind: "INCOME" | "EXPENSE" | "DEBT_LUMP" | "ASSET_PURCHASE";
  debtId?: string;
  assetValue?: DecLike; // for purchases that create an asset
  fundFromSavingsFirst?: boolean;
}
export interface AssetItem {
  id: string;
  name: string;
  kind: string;
  value: DecLike;
}
export interface Baseline {
  asOf: IsoDate;
  currency: string;
  liquid: DecLike; // chequing + cash balances, pooled
  savings: DecLike; // savings account balances, pooled
  investments: DecLike;
  otherAssets: DecLike; // other asset accounts + property + vehicles + valuables
  assets: AssetItem[]; // breakdown of the above property/vehicle/valuable items (informational and growth)
  incomes: IncomeItem[];
  outflows: OutflowItem[];
  debts: DebtItem[];
  goals: GoalItem[];
  oneOffs: OneOff[];
  variableMonthly: DecLike; // average discretionary spending per month not covered by scheduled items
  variableMods?: AmountMod[];
  irregularIncomeMonthly: DecLike; // average monthly income from irregular sources
  newDebts?: DebtItem[];
  assumptions: {
    savingsInterestPct: DecLike;
    investmentReturnPct: DecLike;
    assetGrowthPct: DecLike;
    variableSpendingMonthsBasis: number;
    notes: string[];
  };
}

export interface ForecastMonth {
  month: string;
  partial: boolean;
  income: DecT;
  expenses: DecT; // scheduled + variable + interest
  interest: DecT;
  netCashFlow: DecT; // income - expenses (transfers excluded, as in the ledger)
  debtPrincipalPaid: DecT;
  savingsContributions: DecT;
  endLiquid: DecT;
  endSavings: DecT;
  endInvestments: DecT;
  endOtherAssets: DecT;
  endDebt: DecT;
  endNetWorth: DecT;
}
export interface ForecastResult {
  from: IsoDate;
  to: IsoDate;
  months: ForecastMonth[];
  daily: { date: IsoDate; liquid: DecT }[];
  start: { liquid: DecT; savings: DecT; debt: DecT; netWorth: DecT };
  end: { liquid: DecT; savings: DecT; debt: DecT; netWorth: DecT };
  totals: { income: DecT; expenses: DecT; netCashFlow: DecT; debtPrincipalPaid: DecT; savingsContributions: DecT; interest: DecT };
  firstShortfallDate: IsoDate | null;
  lowestLiquid: { date: IsoDate; amount: DecT };
  debtFreeDate: IsoDate | null;
  warnings: string[];
  assumptions: string[];
}

const applyMods = (amount: DecLike, mods: AmountMod[] | undefined, on: IsoDate): DecT | null => {
  let v = D(amount);
  for (const m of mods ?? []) {
    if (on < m.from || (m.to && on > m.to)) continue;
    if (m.paused) return null;
    if (m.factor !== undefined) v = v.times(D(m.factor));
    if (m.delta !== undefined) v = v.plus(D(m.delta));
  }
  return round2(v);
};

/** Cent-exact share of a monthly amount for one day: cumulative rounding makes the days of a full month sum to exactly the monthly figure. */
const dailyShare = (monthly: DecT, day: number, dim: number): DecT => round2(monthly.times(day).div(dim)).minus(round2(monthly.times(day - 1).div(dim)));

interface Ev {
  kind: "income" | "expense" | "interest_expense" | "debt_pay" | "goal" | "oneoff";
  amount: DecT;
  id?: string;
  essential?: boolean;
}

export function runForecast(b: Baseline, horizon: { days?: number; months?: number }): ForecastResult {
  const from = addDays(b.asOf, 1);
  const to = horizon.months ? addMonths(b.asOf, horizon.months) : addDays(b.asOf, horizon.days ?? 365);
  const warnings: string[] = [];

  let liquid = D(b.liquid),
    savings = D(b.savings),
    investments = D(b.investments),
    other = D(b.otherAssets);
  const debts = [...b.debts, ...(b.newDebts ?? [])].map((d) => ({ ...d, bal: D(d.balance), pay: D(d.payment), rate: periodicRate(d.aprPercent, d.compoundingPerYear, PER_YEAR[d.frequency] ?? 12), done: false, paidOffOn: null as IsoDate | null }));
  const goals = b.goals.map((g) => ({ ...g, remaining: g.remaining === null ? null : D(g.remaining) }));

  // Build the event calendar.
  const cal = new Map<IsoDate, Ev[]>();
  const add = (d: IsoDate, e: Ev) => {
    const a = cal.get(d);
    if (a) a.push(e);
    else cal.set(d, [e]);
  };
  for (const inc of b.incomes) {
    if (inc.frequency === "IRREGULAR") continue; // covered by irregularIncomeMonthly
    const start = inc.start && inc.start > from ? inc.start : from;
    for (const d of occurrences(inc.frequency, inc.anchor, start, to, inc.end)) {
      if (inc.pausedFrom && d >= inc.pausedFrom && (!inc.pausedUntil || d <= inc.pausedUntil)) continue;
      const amt = applyMods(inc.net, inc.mods, d);
      if (amt && amt.gt(0)) add(d, { kind: "income", amount: amt, id: inc.id });
    }
  }
  for (const o of b.outflows) {
    for (const d of occurrences(o.frequency, o.anchor, from, to, o.end)) {
      const amt = applyMods(o.amount, o.mods, d);
      if (amt && amt.gt(0)) add(d, { kind: "expense", amount: amt, id: o.id, essential: o.essential });
    }
  }
  for (const d of debts) {
    if (!d.nextDue || d.pay.lte(0)) continue;
    for (const day of occurrences(d.frequency, d.nextDue, from, to)) add(day, { kind: "debt_pay", amount: d.pay, id: d.id });
  }
  for (const g of goals) {
    const firstOfNext = `${addMonths(from, from.endsWith("-01") ? 0 : 1).slice(0, 7)}-01`;
    for (const day of occurrences("MONTHLY", firstOfNext, from, to)) add(day, { kind: "goal", amount: D(g.monthly), id: g.id });
  }
  for (const o of b.oneOffs) if (o.date >= from && o.date <= to) add(o.date, { kind: "oneoff", amount: D(o.amount), id: o.id });
  const oneOffById = new Map(b.oneOffs.map((o) => [o.id, o]));

  const months = new Map<string, { income: DecT; expenses: DecT; interest: DecT; principal: DecT; savings: DecT; lastDate: IsoDate; endLiquid: DecT; endSavings: DecT; endInv: DecT; endOther: DecT; endDebt: DecT }>();
  const bucket = (k: string) => {
    let m = months.get(k);
    if (!m) {
      m = { income: ZERO, expenses: ZERO, interest: ZERO, principal: ZERO, savings: ZERO, lastDate: from, endLiquid: ZERO, endSavings: ZERO, endInv: ZERO, endOther: ZERO, endDebt: ZERO };
      months.set(k, m);
    }
    return m;
  };

  const savingsRate = D(b.assumptions.savingsInterestPct).div(100).div(12);
  const invRate = D(b.assumptions.investmentReturnPct).div(100).div(12);
  const assetRate = D(b.assumptions.assetGrowthPct).div(100).div(12);
  const varMonthly = D(b.variableMonthly);
  const irregMonthly = D(b.irregularIncomeMonthly);
  const daily: { date: IsoDate; liquid: DecT }[] = [];
  let firstShortfall: IsoDate | null = null;
  let lowest = { date: from, amount: liquid };
  const debtTotal = () => sum(debts.map((d) => d.bal));
  const startNW = liquid.plus(savings).plus(investments).plus(other).minus(debtTotal());
  const startDebt = debtTotal();
  const startLiquid = liquid,
    startSavings = savings;

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const m = bucket(monthOf(d));
    const { y, m: mm } = ymd(d);
    const dim = daysInMonth(y, mm);
    // spending that is not scheduled, spread evenly over the month
    const vMod = applyMods(varMonthly, b.variableMods, d);
    if (vMod && vMod.gt(0)) {
      const v = dailyShare(vMod, ymd(d).d, dim);
      liquid = liquid.minus(v);
      m.expenses = m.expenses.plus(v);
    }
    if (irregMonthly.gt(0)) {
      const v = dailyShare(irregMonthly, ymd(d).d, dim);
      liquid = liquid.plus(v);
      m.income = m.income.plus(v);
    }
    for (const e of cal.get(d) ?? []) {
      switch (e.kind) {
        case "income":
          liquid = liquid.plus(e.amount);
          m.income = m.income.plus(e.amount);
          break;
        case "expense":
          liquid = liquid.minus(e.amount);
          m.expenses = m.expenses.plus(e.amount);
          break;
        case "debt_pay": {
          const dbt = debts.find((x) => x.id === e.id);
          if (!dbt || dbt.bal.lte(0)) break;
          const extra = (dbt.extraMonthly ?? []).filter((x) => d >= x.from).reduce((t, x) => t.plus(D(x.amount)), ZERO);
          // extra payments are monthly: spread by frequency so a biweekly debt does not double-count
          const perYear = PER_YEAR[dbt.frequency] ?? 12;
          const total = e.amount.plus(extra.times(12).div(perYear));
          const interest = dbt.bal.times(dbt.rate).toDecimalPlaces(2);
          let principal = total.minus(interest);
          let paid = total;
          if (principal.gte(dbt.bal)) {
            principal = dbt.bal;
            paid = principal.plus(interest);
          }
          if (principal.lt(0)) {
            // payment below interest: the balance grows
            dbt.bal = dbt.bal.minus(principal);
            principal = ZERO;
          } else dbt.bal = dbt.bal.minus(principal);
          liquid = liquid.minus(paid);
          m.expenses = m.expenses.plus(interest);
          m.interest = m.interest.plus(interest);
          m.principal = m.principal.plus(principal);
          if (dbt.bal.lte(0) && !dbt.done) {
            dbt.done = true;
            dbt.paidOffOn = d;
          }
          break;
        }
        case "goal": {
          const g = goals.find((x) => x.id === e.id);
          if (!g) break;
          const extra = (g.extra ?? []).filter((x) => d >= x.from).reduce((t, x) => t.plus(D(x.amount)), ZERO);
          let amt = e.amount.plus(extra);
          if (g.remaining !== null) amt = Dec.min(amt, Dec.max(g.remaining, ZERO));
          if (amt.lte(0)) break;
          if (g.remaining !== null) g.remaining = g.remaining.minus(amt);
          liquid = liquid.minus(amt);
          savings = savings.plus(amt);
          m.savings = m.savings.plus(amt);
          break;
        }
        case "oneoff": {
          const o = oneOffById.get(e.id as string);
          if (!o) break;
          if (o.kind === "INCOME") {
            liquid = liquid.plus(e.amount);
            m.income = m.income.plus(e.amount);
          } else if (o.kind === "EXPENSE") {
            liquid = liquid.plus(e.amount); // amount is negative
            m.expenses = m.expenses.minus(e.amount);
          } else if (o.kind === "DEBT_LUMP") {
            const dbt = debts.find((x) => x.id === o.debtId);
            const want = e.amount.abs();
            const pay = dbt ? Dec.min(want, dbt.bal) : ZERO;
            if (dbt && pay.gt(0)) {
              dbt.bal = dbt.bal.minus(pay);
              m.principal = m.principal.plus(pay);
              if (o.fundFromSavingsFirst) {
                const fromSav = Dec.min(savings, pay);
                savings = savings.minus(fromSav);
                liquid = liquid.minus(pay.minus(fromSav));
              } else liquid = liquid.minus(pay);
              if (dbt.bal.lte(0) && !dbt.done) {
                dbt.done = true;
                dbt.paidOffOn = d;
              }
            }
          } else if (o.kind === "ASSET_PURCHASE") {
            // cash leaves, an asset of the stated value appears (down payment, closing costs are an expense folded in by the scenario)
            const cost = e.amount.abs();
            const fromSav = o.fundFromSavingsFirst ? Dec.min(savings, cost) : ZERO;
            savings = savings.minus(fromSav);
            liquid = liquid.minus(cost.minus(fromSav));
            other = other.plus(D(o.assetValue));
          }
          break;
        }
      }
    }
    if (isMonthEnd(d) || d === to) {
      if (savingsRate.gt(0) && savings.gt(0)) {
        const i = savings.times(savingsRate).toDecimalPlaces(2);
        savings = savings.plus(i);
        m.income = m.income.plus(i);
      }
      if (invRate.gt(0)) investments = investments.plus(round2(investments.times(invRate)));
      if (assetRate.gt(0)) other = other.plus(round2(other.times(assetRate)));
    }
    m.lastDate = d;
    m.endLiquid = liquid;
    m.endSavings = savings;
    m.endInv = investments;
    m.endOther = other;
    m.endDebt = debtTotal();
    daily.push({ date: d, liquid });
    if (liquid.isNegative() && !firstShortfall) firstShortfall = d;
    if (liquid.lt(lowest.amount)) lowest = { date: d, amount: liquid };
  }

  const rows: ForecastMonth[] = [...months.entries()].sort(([a], [c]) => (a < c ? -1 : 1)).map(([k, m]) => ({
    month: k,
    partial: (k === monthOf(from) && !from.endsWith("-01")) || (k === monthOf(to) && !isMonthEnd(to)),
    income: m.income,
    expenses: m.expenses,
    interest: m.interest,
    netCashFlow: m.income.minus(m.expenses),
    debtPrincipalPaid: m.principal,
    savingsContributions: m.savings,
    endLiquid: m.endLiquid,
    endSavings: m.endSavings,
    endInvestments: m.endInv,
    endOtherAssets: m.endOther,
    endDebt: m.endDebt,
    endNetWorth: m.endLiquid.plus(m.endSavings).plus(m.endInv).plus(m.endOther).minus(m.endDebt),
  }));
  const last = rows[rows.length - 1];
  const debtFree = debts.length && debts.every((x) => x.done || x.bal.lte(0)) ? debts.map((x) => x.paidOffOn).filter(Boolean).sort().pop() ?? null : null;
  if (firstShortfall) warnings.push(`Projected cash falls below zero on ${firstShortfall}. Review upcoming bills, income timing, or move money from savings.`);
  for (const d of debts) if (d.pay.gt(0) && !d.done && d.bal.times(d.rate).gte(d.pay)) warnings.push(`The regular payment on ${d.name} does not cover its interest, so its balance does not fall.`);
  const assumptions = [
    `Projection runs from ${from} to ${to} using data recorded up to ${b.asOf}. It is an estimate, not a guaranteed outcome.`,
    `Scheduled items used: ${b.incomes.length} income source(s), ${b.outflows.length} bill, subscription, insurance and recurring item(s), ${b.debts.length} debt(s), ${b.goals.length} savings goal(s).`,
    `Spending not covered by a schedule is estimated at ${D(b.variableMonthly).toFixed(2)} ${b.currency} per month (average of the previous ${b.assumptions.variableSpendingMonthsBasis} month(s)) and spread evenly across each month.`,
    D(b.irregularIncomeMonthly).gt(0) ? `Irregular income is estimated at ${D(b.irregularIncomeMonthly).toFixed(2)} ${b.currency} per month (trailing twelve month average).` : "No irregular income is assumed.",
    `Savings interest ${D(b.assumptions.savingsInterestPct).toString()}%, investment return ${D(b.assumptions.investmentReturnPct).toString()}%, property and asset growth ${D(b.assumptions.assetGrowthPct).toString()}% per year. Defaults are zero so the projection does not assume market returns.`,
    "Debt interest is calculated on each payment date from the outstanding balance using the stored rate and compounding. Credit card spending is assumed to be paid in the month it occurs.",
    "No inflation, raises, tax changes or rate changes are applied unless a scenario adds them. Cash is treated as one pooled balance.",
    ...b.assumptions.notes,
  ];
  void isLiabilityType;
  return {
    from,
    to,
    months: rows,
    daily,
    start: { liquid: startLiquid, savings: startSavings, debt: startDebt, netWorth: startNW },
    end: { liquid: liquid, savings, debt: debtTotal(), netWorth: last?.endNetWorth ?? startNW },
    totals: { income: sum(rows.map((r) => r.income)), expenses: sum(rows.map((r) => r.expenses)), netCashFlow: sum(rows.map((r) => r.netCashFlow)), debtPrincipalPaid: sum(rows.map((r) => r.debtPrincipalPaid)), savingsContributions: sum(rows.map((r) => r.savingsContributions)), interest: sum(rows.map((r) => r.interest)) },
    firstShortfallDate: firstShortfall,
    lowestLiquid: lowest,
    debtFreeDate: debtFree,
    warnings,
    assumptions,
  };
}

/** Average monthly spending over a window, for the baseline builder. */
export const averagePerMonth = (total: DecLike, months: number): DecT => (months > 0 ? D(total).div(months) : ZERO);
export { diffDays };
