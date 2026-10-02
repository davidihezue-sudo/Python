// Payment frequencies. Biweekly (26 pays a year) and semi-monthly (24 pays a year) are deliberately different.
import { Dec, D, ZERO, type Dec as DecT, type DecLike } from "./decimal";
import { addDays, addMonths, daysInMonth, endOfMonth, isMonthEnd, startOfMonth, ymd, type IsoDate } from "./dates";

export type Frequency = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "QUARTERLY" | "SEMI_ANNUALLY" | "ANNUALLY" | "IRREGULAR" | "ONE_TIME";

/** Payments per year. 52 is the payroll convention for weekly pay (not 365.25 / 7). IRREGULAR and ONE_TIME have no fixed rate. */
export const PER_YEAR: Record<Frequency, number | null> = { WEEKLY: 52, BIWEEKLY: 26, SEMI_MONTHLY: 24, MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUALLY: 2, ANNUALLY: 1, IRREGULAR: null, ONE_TIME: null };
export const FREQUENCY_LABEL: Record<Frequency, string> = { WEEKLY: "Weekly", BIWEEKLY: "Biweekly (every 2 weeks)", SEMI_MONTHLY: "Semi-monthly (twice a month)", MONTHLY: "Monthly", QUARTERLY: "Quarterly", SEMI_ANNUALLY: "Twice a year", ANNUALLY: "Annually", IRREGULAR: "Irregular", ONE_TIME: "One time" };

export const isFixedFrequency = (f: Frequency) => PER_YEAR[f] !== null;

/** Annual total for `amount` paid at `freq`. Irregular/one-time amounts are not annualised (returns null). */
export function annualAmount(amount: DecLike, freq: Frequency): DecT | null {
  const n = PER_YEAR[freq];
  return n === null ? null : D(amount).times(n);
}
/** Average monthly amount for `amount` paid at `freq`, or null when it cannot be derived from the frequency alone. */
export function monthlyAmount(amount: DecLike, freq: Frequency): DecT | null {
  const a = annualAmount(amount, freq);
  return a === null ? null : a.div(12);
}

function dayClamped(y: number, m: number, d: number): IsoDate {
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
}

/**
 * All occurrence dates of a recurring item in [from, to] (inclusive), anchored on `anchor`.
 * Month based frequencies re-derive each date from the anchor so that Jan 31 gives Feb 28 and then Mar 31 (no drift).
 * `end` optionally stops the series. Occurrences before the anchor are never produced.
 */
export function occurrences(freq: Frequency, anchor: IsoDate, from: IsoDate, to: IsoDate, end?: IsoDate | null): IsoDate[] {
  const limit = end && end < to ? end : to;
  if (limit < from) return [];
  const out: IsoDate[] = [];
  const push = (d: IsoDate) => {
    if (d >= anchor && d >= from && d <= limit) out.push(d);
  };
  switch (freq) {
    case "ONE_TIME":
    case "IRREGULAR":
      push(anchor);
      return out;
    case "WEEKLY":
    case "BIWEEKLY": {
      const step = freq === "WEEKLY" ? 7 : 14;
      let d = anchor;
      if (from > anchor) {
        const gap = Math.floor((new Dec(Date.parse(from) - Date.parse(anchor)).div(86_400_000).toNumber()) / step) * step;
        d = addDays(anchor, gap);
      }
      for (; d <= limit; d = addDays(d, step)) push(d);
      return out;
    }
    case "SEMI_MONTHLY": {
      // Two fixed paydays a month. Common conventions are handled explicitly: anchored on the 15th or the last day means
      // "15th and last day"; anchored on the 1st means "1st and 15th". Any other day pairs with the day 15 days away.
      const a = ymd(anchor);
      const monthEndAnchor = isMonthEnd(anchor) || a.d === 15;
      let cur = startOfMonth(anchor);
      while (cur <= limit) {
        const { y, m } = ymd(cur);
        const days = monthEndAnchor ? [15, daysInMonth(y, m)] : a.d === 1 ? [1, 15] : a.d <= 15 ? [a.d, a.d + 15] : [a.d - 15, a.d];
        for (const d of days) push(dayClamped(y, m, d));
        cur = addMonths(cur, 1);
      }
      return out.sort();
    }
    case "MONTHLY":
    case "QUARTERLY":
    case "SEMI_ANNUALLY":
    case "ANNUALLY": {
      const step = freq === "MONTHLY" ? 1 : freq === "QUARTERLY" ? 3 : freq === "SEMI_ANNUALLY" ? 6 : 12;
      const startK = from > anchor ? Math.max(0, Math.floor(((+from.slice(0, 4) - +anchor.slice(0, 4)) * 12 + (+from.slice(5, 7) - +anchor.slice(5, 7))) / step) - 1) : 0;
      for (let k = startK; ; k++) {
        const d = addMonths(anchor, k * step);
        if (d > limit) break;
        push(d);
      }
      return out;
    }
  }
}

/** First occurrence strictly after `after` (or on it when inclusive). Null when the series is finished or one-off in the past. */
export function nextOccurrence(freq: Frequency, anchor: IsoDate, after: IsoDate, opts: { inclusive?: boolean; end?: IsoDate | null } = {}): IsoDate | null {
  const start = opts.inclusive ? after : addDays(after, 1);
  if (freq === "ONE_TIME" || freq === "IRREGULAR") return anchor >= start && (!opts.end || anchor <= opts.end) ? anchor : null;
  const horizon = addMonths(start, 14);
  return occurrences(freq, anchor, start, horizon, opts.end)[0] ?? null;
}

export { ZERO, endOfMonth };
