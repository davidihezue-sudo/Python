// "Safe to spend": what can be spent from everyday money between now and the next pay day without missing anything already committed. Pure.
import { D, ZERO, money, type DecLike } from "./decimal";
import { diffDays, type IsoDate } from "./dates";

export interface SafeSpendInput {
  /** money in everyday accounts (chequing and cash) */
  cash: DecLike;
  /** committed outflows before the horizon: bills, subscriptions, debt payments, goal contributions, planned items */
  committed: { date: IsoDate; amount: DecLike; label: string }[];
  today: IsoDate;
  /** the day before the next pay day (or the end of the month when no pay day is known) */
  horizonEnd: IsoDate;
  /** money the person wants to keep untouched */
  buffer?: DecLike;
}
export interface SafeSpendResult {
  cash: string;
  committed: string;
  buffer: string;
  safe: string;
  days: number;
  perDay: string;
  status: "ok" | "tight" | "short";
  items: { date: IsoDate; amount: string; label: string }[];
}

export function safeToSpend(i: SafeSpendInput): SafeSpendResult {
  const within = i.committed.filter((c) => c.date >= i.today && c.date <= i.horizonEnd).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  const committed = within.reduce((a, c) => a.plus(D(c.amount).abs()), ZERO);
  const buffer = D(i.buffer ?? 0);
  const safe = D(i.cash).minus(committed).minus(buffer);
  const days = Math.max(1, diffDays(i.horizonEnd, i.today) + 1);
  const perDay = safe.div(days);
  return {
    cash: money(i.cash), committed: money(committed), buffer: money(buffer), safe: money(safe), days, perDay: money(perDay),
    status: safe.lt(0) ? "short" : perDay.lt(10) ? "tight" : "ok",
    items: within.map((c) => ({ date: c.date, amount: money(D(c.amount).abs()), label: c.label })),
  };
}
