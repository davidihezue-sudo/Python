// Budget performance: budgeted vs actual, remaining, pace based forecast and rollover.
import { D, Dec, ZERO, sum, type Dec as DecT, type DecLike } from "./decimal";
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth, startOfWeek, type IsoDate } from "./dates";

export type BudgetPeriodKind = "WEEKLY" | "MONTHLY" | "ANNUAL" | "CUSTOM";

/** Concrete [start, end] for a period kind containing `ref` (custom periods must be supplied by the caller). */
export function periodBoundsFor(kind: Exclude<BudgetPeriodKind, "CUSTOM">, ref: IsoDate): { from: IsoDate; to: IsoDate } {
  if (kind === "WEEKLY") {
    const s = startOfWeek(ref);
    return { from: s, to: addDays(s, 6) };
  }
  if (kind === "MONTHLY") return { from: startOfMonth(ref), to: endOfMonth(ref) };
  return { from: `${ref.slice(0, 4)}-01-01`, to: `${ref.slice(0, 4)}-12-31` };
}
/** Same-length period immediately after [from, to]. */
export function nextPeriod(kind: BudgetPeriodKind, from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  if (kind === "MONTHLY") return periodBoundsFor("MONTHLY", addDays(to, 1));
  if (kind === "WEEKLY") return { from: addDays(to, 1), to: addDays(to, 7) };
  if (kind === "ANNUAL") return periodBoundsFor("ANNUAL", addDays(to, 1));
  const len = diffDays(to, from) + 1;
  return { from: addDays(to, 1), to: addDays(to, len) };
}
export function previousPeriodOf(kind: BudgetPeriodKind, from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  if (kind === "MONTHLY") return periodBoundsFor("MONTHLY", addDays(from, -1));
  if (kind === "WEEKLY") return { from: addDays(from, -7), to: addDays(from, -1) };
  if (kind === "ANNUAL") return periodBoundsFor("ANNUAL", addDays(from, -1));
  const len = diffDays(to, from) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export type LineState = "ok" | "approaching" | "over" | "unfunded";
export interface LineInput {
  categoryId: string;
  amount: DecLike;
  rollover?: boolean;
  warnAtPct?: number;
}
export interface LineResult {
  categoryId: string;
  budgeted: DecT;
  carriedOver: DecT;
  available: DecT; // budgeted + carry
  actual: DecT;
  remaining: DecT;
  percentUsed: DecT | null;
  previousActual: DecT | null;
  forecast: DecT; // expected spend by the end of the period at the current pace
  forecastOver: boolean;
  state: LineState;
}
export interface BudgetResult {
  lines: LineResult[];
  unbudgeted: DecT;
  totals: { budgeted: DecT; actual: DecT; remaining: DecT; percentUsed: DecT | null; forecast: DecT };
}

/** Linear pace forecast: spend so far scaled to the whole period. Finished or not-yet-started periods forecast actual. */
export function paceForecast(actual: DecLike, from: IsoDate, to: IsoDate, today: IsoDate): DecT {
  const a = D(actual);
  if (today >= to || today < from) return a;
  const total = diffDays(to, from) + 1;
  const elapsed = Math.max(1, diffDays(today, from) + 1);
  return a.times(total).div(elapsed).toDecimalPlaces(2);
}

export function evaluateBudget(p: {
  lines: LineInput[];
  actualByLine: Map<string, DecT>; // already attributed to the budgeted category (children rolled in)
  unbudgetedActual: DecLike;
  previousByLine?: Map<string, DecT>;
  carryByLine?: Map<string, DecT>; // unused amount from the previous period for rollover lines (may be negative)
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
}): BudgetResult {
  const lines: LineResult[] = p.lines.map((l) => {
    const budgeted = D(l.amount);
    const carry = l.rollover ? (p.carryByLine?.get(l.categoryId) ?? ZERO) : ZERO;
    const available = budgeted.plus(carry);
    const actual = p.actualByLine.get(l.categoryId) ?? ZERO;
    const remaining = available.minus(actual);
    const percentUsed = available.lte(0) ? null : actual.div(available).times(100).toDecimalPlaces(2);
    const forecast = paceForecast(actual, p.from, p.to, p.today);
    const warn = l.warnAtPct ?? 85;
    let state: LineState = "ok";
    if (available.lte(0) && actual.gt(0)) state = "unfunded";
    else if (actual.gt(available)) state = "over";
    else if (percentUsed !== null && percentUsed.gte(warn)) state = "approaching";
    return { categoryId: l.categoryId, budgeted, carriedOver: carry, available, actual, remaining, percentUsed, previousActual: p.previousByLine?.get(l.categoryId) ?? null, forecast, forecastOver: forecast.gt(available) && available.gt(0), state };
  });
  const budgeted = sum(lines.map((l) => l.available));
  const actual = sum(lines.map((l) => l.actual));
  return { lines, unbudgeted: D(p.unbudgetedActual), totals: { budgeted, actual, remaining: budgeted.minus(actual), percentUsed: budgeted.isZero() ? null : actual.div(budgeted).times(100).toDecimalPlaces(2), forecast: sum(lines.map((l) => l.forecast)) } };
}

export { Dec, addMonths };
