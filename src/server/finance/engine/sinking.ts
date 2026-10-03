// Sinking funds (pure): save a little each month toward a known future cost so the bill never hurts.
import { D, Dec, ZERO, money, type DecLike } from "./decimal";
import { diffDays, type IsoDate } from "./dates";

export interface SinkingInput { target: DecLike; saved: DecLike; dueDate: IsoDate; today: IsoDate; plannedMonthly?: DecLike }
export interface SinkingResult { remaining: string; monthsLeft: number; perMonth: string; perPayPeriod: string; fundedPercent: string; status: "funded" | "on_track" | "behind" | "overdue" }

export function sinkingNeed(i: SinkingInput): SinkingResult {
  const target = D(i.target), saved = D(i.saved);
  const remaining = Dec.max(target.minus(saved), ZERO);
  const days = diffDays(i.dueDate, i.today);
  const monthsLeft = Math.max(1, Math.ceil(days / 30.4375));
  const perMonth = remaining.div(monthsLeft).toDecimalPlaces(2, Dec.ROUND_UP);
  const planned = D(i.plannedMonthly ?? 0);
  const status = remaining.isZero() ? "funded" : days < 0 ? "overdue" : planned.gte(perMonth) ? "on_track" : "behind";
  return { remaining: money(remaining), monthsLeft, perMonth: money(perMonth), perPayPeriod: money(perMonth.div(2).toDecimalPlaces(2, Dec.ROUND_UP)), fundedPercent: target.gt(0) ? Dec.min(saved.div(target).times(100), D(100)).toDecimalPlaces(1).toString() : "0", status };
}
