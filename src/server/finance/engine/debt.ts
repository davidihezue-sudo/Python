// Debt maths: periodic rates, level payments, amortisation, payoff projections and repayment strategies.
import { D, Dec, ZERO, ONE, sum, type Dec as DecT, type DecLike } from "./decimal";
import { addMonths, type IsoDate } from "./dates";
import { PER_YEAR, type Frequency } from "./frequency";

const R2 = (v: DecLike) => D(v).toDecimalPlaces(2, Dec.ROUND_HALF_UP);

/**
 * Effective interest rate per payment period for a nominal annual rate (percent) compounded `compoundingPerYear` times a year.
 * Canadian fixed mortgages compound semi-annually (2); most loans and cards compound monthly (12).
 * periodic = (1 + apr / n) ^ (n / paymentsPerYear) - 1
 */
export function periodicRate(aprPercent: DecLike, compoundingPerYear: number, paymentsPerYear: number): DecT {
  const apr = D(aprPercent).div(100);
  if (apr.isZero()) return ZERO;
  const n = new Dec(compoundingPerYear);
  return ONE.plus(apr.div(n)).pow(n.div(paymentsPerYear)).minus(1);
}

/** Level payment that fully amortises `principal` over `periods` payments. Zero rate divides evenly. */
export function levelPayment(principal: DecLike, rate: DecLike, periods: number): DecT {
  const p = D(principal),
    r = D(rate);
  if (periods <= 0) return p;
  if (r.isZero()) return R2(p.div(periods));
  const f = ONE.plus(r).pow(-periods);
  return R2(p.times(r).div(ONE.minus(f)));
}

export interface ScheduleRow {
  n: number;
  date: IsoDate | null;
  opening: DecT;
  payment: DecT;
  interest: DecT;
  principal: DecT;
  closing: DecT;
}
export interface Amortisation {
  rows: ScheduleRow[];
  periods: number;
  totalInterest: DecT;
  totalPaid: DecT;
  payoffDate: IsoDate | null;
  paidOff: boolean; // false when the payment does not cover interest or the cap was hit
  reason?: string;
}

const MAX_PERIODS = 1200;

/** Projects a balance forward with a fixed payment (plus optional extra) until it reaches zero. */
export function amortise(p: {
  balance: DecLike;
  aprPercent: DecLike;
  compoundingPerYear?: number;
  frequency?: Frequency;
  payment: DecLike;
  extra?: DecLike;
  startDate?: IsoDate | null; // date of the first payment
  maxPeriods?: number;
}): Amortisation {
  const freq = p.frequency ?? "MONTHLY";
  const ppy = PER_YEAR[freq] ?? 12;
  const r = periodicRate(p.aprPercent, p.compoundingPerYear ?? 12, ppy);
  let bal = R2(p.balance);
  const pay = R2(D(p.payment).plus(D(p.extra)));
  const rows: ScheduleRow[] = [];
  let totalInterest = ZERO,
    totalPaid = ZERO;
  const cap = p.maxPeriods ?? MAX_PERIODS;
  if (bal.lte(0)) return { rows, periods: 0, totalInterest, totalPaid, payoffDate: p.startDate ?? null, paidOff: true };
  const firstInterest = R2(bal.times(r));
  if (pay.lte(firstInterest) && r.gt(0)) {
    return { rows, periods: 0, totalInterest, totalPaid, payoffDate: null, paidOff: false, reason: "The payment does not cover the interest, so the balance never falls." };
  }
  if (pay.lte(0)) return { rows, periods: 0, totalInterest, totalPaid, payoffDate: null, paidOff: false, reason: "No payment is set." };
  for (let n = 1; n <= cap && bal.gt(0); n++) {
    const interest = R2(bal.times(r));
    let payment = pay;
    let principal = payment.minus(interest);
    if (principal.gte(bal)) {
      principal = bal;
      payment = bal.plus(interest);
    }
    const closing = bal.minus(principal);
    const date = p.startDate ? dateForPeriod(p.startDate, freq, n - 1) : null;
    rows.push({ n, date, opening: bal, payment, interest, principal, closing });
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(payment);
    bal = closing;
  }
  const done = bal.lte(0);
  return { rows, periods: rows.length, totalInterest, totalPaid, payoffDate: done ? (rows[rows.length - 1].date ?? null) : null, paidOff: done, reason: done ? undefined : "Not repaid within 100 years at this payment." };
}

function dateForPeriod(start: IsoDate, freq: Frequency, k: number): IsoDate {
  switch (freq) {
    case "WEEKLY":
      return new Date(Date.parse(start) + k * 7 * 86_400_000).toISOString().slice(0, 10);
    case "BIWEEKLY":
      return new Date(Date.parse(start) + k * 14 * 86_400_000).toISOString().slice(0, 10);
    case "SEMI_MONTHLY":
      return addMonths(start, Math.floor(k / 2)); // approximation, shown as an estimate
    case "QUARTERLY":
      return addMonths(start, k * 3);
    case "SEMI_ANNUALLY":
      return addMonths(start, k * 6);
    case "ANNUALLY":
      return addMonths(start, k * 12);
    default:
      return addMonths(start, k);
  }
}

/** Splits one payment into interest and principal for a balance (one period of interest, never more than the payment). */
export function splitPayment(p: { balance: DecLike; aprPercent: DecLike; compoundingPerYear?: number; frequency?: Frequency; total: DecLike }): { interest: DecT; principal: DecT } {
  const bal = D(p.balance);
  const total = D(p.total);
  const r = periodicRate(p.aprPercent, p.compoundingPerYear ?? 12, PER_YEAR[p.frequency ?? "MONTHLY"] ?? 12);
  let interest = R2(bal.times(r));
  if (interest.gt(total)) interest = total;
  let principal = total.minus(interest);
  if (principal.gt(bal)) principal = bal;
  return { interest, principal };
}

export type Strategy = "AVALANCHE" | "SNOWBALL" | "CUSTOM";
export interface StrategyDebt {
  id: string;
  name: string;
  balance: DecLike;
  aprPercent: DecLike;
  compoundingPerYear?: number;
  minimumPayment: DecLike;
}
export interface StrategyResult {
  strategy: Strategy;
  months: number;
  debtFreeDate: IsoDate | null;
  totalInterest: DecT;
  totalPaid: DecT;
  payoffOrder: { id: string; name: string; month: number; date: IsoDate | null }[];
  timeline: { month: number; date: IsoDate | null; totalBalance: DecT }[];
  completed: boolean;
  reason?: string;
}

/**
 * Monthly simulation of paying several debts at once. Every debt always receives its minimum payment, and the total budget
 * (sum of minimums + extra) is held constant so that payments freed by a finished debt roll to the next target.
 * Avalanche targets the highest rate first, snowball the smallest balance first, custom follows the supplied order.
 */
export function simulateStrategy(p: { debts: StrategyDebt[]; strategy: Strategy; extraMonthly?: DecLike; customOrder?: string[]; startDate?: IsoDate | null; maxMonths?: number }): StrategyResult {
  const cap = p.maxMonths ?? 600;
  const state = p.debts
    .map((d) => ({ ...d, bal: R2(d.balance), r: periodicRate(d.aprPercent, d.compoundingPerYear ?? 12, 12), min: R2(d.minimumPayment), done: false, month: 0 }))
    .filter((d) => d.bal.gt(0));
  const budget = sum(state.map((d) => d.min)).plus(D(p.extraMonthly));
  const order = (): typeof state => {
    const live = state.filter((d) => !d.done);
    if (p.strategy === "AVALANCHE") return live.sort((a, b) => D(b.aprPercent).comparedTo(D(a.aprPercent)) || a.bal.comparedTo(b.bal));
    if (p.strategy === "SNOWBALL") return live.sort((a, b) => a.bal.comparedTo(b.bal) || D(b.aprPercent).comparedTo(D(a.aprPercent)));
    const idx = new Map((p.customOrder ?? []).map((id, i) => [id, i]));
    return live.sort((a, b) => (idx.get(a.id) ?? 9999) - (idx.get(b.id) ?? 9999));
  };
  let totalInterest = ZERO,
    totalPaid = ZERO;
  const timeline: StrategyResult["timeline"] = [];
  const payoffOrder: StrategyResult["payoffOrder"] = [];
  let month = 0;
  if (state.length && budget.lte(0)) return { strategy: p.strategy, months: 0, debtFreeDate: null, totalInterest, totalPaid, payoffOrder, timeline, completed: false, reason: "No payments are set." };
  const dateOf = (m: number) => (p.startDate ? addMonths(p.startDate, m - 1) : null);
  while (state.some((d) => !d.done) && month < cap) {
    month++;
    for (const d of state) if (!d.done) { const i = R2(d.bal.times(d.r)); d.bal = d.bal.plus(i); totalInterest = totalInterest.plus(i); }
    let pool = budget;
    // minimums first
    for (const d of state) {
      if (d.done) continue;
      const pay = Dec.min(d.min, d.bal);
      d.bal = d.bal.minus(pay);
      pool = pool.minus(pay);
      totalPaid = totalPaid.plus(pay);
    }
    // everything left goes to the target, then the next target
    for (const d of order()) {
      if (pool.lte(0)) break;
      const pay = Dec.min(pool, d.bal);
      d.bal = d.bal.minus(pay);
      pool = pool.minus(pay);
      totalPaid = totalPaid.plus(pay);
    }
    for (const d of state) {
      if (!d.done && d.bal.lte(0)) {
        d.done = true;
        d.month = month;
        payoffOrder.push({ id: d.id, name: d.name, month, date: dateOf(month) });
      }
    }
    timeline.push({ month, date: dateOf(month), totalBalance: sum(state.map((d) => (d.done ? 0 : d.bal))) });
  }
  const completed = !state.some((d) => !d.done);
  return { strategy: p.strategy, months: month, debtFreeDate: completed ? dateOf(month) : null, totalInterest, totalPaid, payoffOrder, timeline, completed, reason: completed ? undefined : "Not repaid within 50 years. Raise the payments or add an extra amount." };
}

export { Dec, ZERO };
