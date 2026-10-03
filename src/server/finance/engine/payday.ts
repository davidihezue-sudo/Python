// Splitting a paycheck (pure). Percent lines are rounded to the cent and the leftover is whatever remains, so nothing is created or lost.
import { D, ZERO, money, type DecLike } from "./decimal";

export interface PaydayLine { label: string; mode: "AMOUNT" | "PERCENT"; value: DecLike }
export interface PaydayResolved { lines: { label: string; amount: string }[]; total: string; leftover: string; over: boolean }

export function resolvePayday(paycheck: DecLike, lines: PaydayLine[]): PaydayResolved {
  const pay = D(paycheck);
  const out = lines.map((l) => ({ label: l.label, amount: l.mode === "PERCENT" ? pay.times(D(l.value)).div(100).toDecimalPlaces(2) : D(l.value).toDecimalPlaces(2) }));
  const total = out.reduce((a, l) => a.plus(l.amount), ZERO);
  return { lines: out.map((l) => ({ label: l.label, amount: money(l.amount) })), total: money(total), leftover: money(pay.minus(total)), over: total.gt(pay) };
}
