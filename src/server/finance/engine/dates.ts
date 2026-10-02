// Calendar helpers for the finance engine. All dates are ISO "YYYY-MM-DD" strings (no timezone drift).
import { addDays, addMonths, diffDays, fromDayNumber, toDayNumber, type IsoDate } from "@/lib/dates";
import { Dec, ZERO, type Dec as DecT } from "./decimal";

export { addDays, addMonths, diffDays, fromDayNumber, toDayNumber };
export type { IsoDate };

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m1to12: number) => new Date(Date.UTC(y, m1to12, 0)).getUTCDate();
export const ymd = (iso: IsoDate) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });
export const startOfMonth = (iso: IsoDate): IsoDate => `${iso.slice(0, 7)}-01`;
export const endOfMonth = (iso: IsoDate): IsoDate => {
  const { y, m } = ymd(iso);
  return `${iso.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
};
export const isMonthEnd = (iso: IsoDate) => endOfMonth(iso) === iso;
export const monthOf = (iso: IsoDate) => iso.slice(0, 7);
/** Monday-based week start. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const dow = (toDayNumber(iso) + 3) % 7; // 1970-01-01 was a Thursday; Monday = 0
  return addDays(iso, -dow);
}
export function dayOfWeek(iso: IsoDate): number {
  return (toDayNumber(iso) + 4) % 7; // 0 = Sunday
}

/** Inclusive list of "YYYY-MM" keys from the month of `from` to the month of `to`. */
export function monthKeys(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  let cur = startOfMonth(from);
  const last = startOfMonth(to);
  while (cur <= last) {
    out.push(cur.slice(0, 7));
    cur = addMonths(cur, 1);
  }
  return out;
}
export const monthBounds = (key: string): { from: IsoDate; to: IsoDate } => ({ from: `${key}-01`, to: endOfMonth(`${key}-01`) });

/** Calendar months between two dates, fractional (whole months plus the remaining days over that month's length). */
export function monthsBetween(a: IsoDate, b: IsoDate): DecT {
  if (b <= a) return ZERO;
  let m = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  while (m > 0 && addMonths(a, m) > b) m--;
  const anchor = addMonths(a, m);
  const next = addMonths(a, m + 1);
  const span = diffDays(next, anchor) || 1;
  return new Dec(m).plus(new Dec(diffDays(b, anchor)).div(span));
}

export type RangePreset = "current_month" | "previous_month" | "last_3_months" | "last_6_months" | "last_12_months" | "year_to_date" | "custom";
/** Resolves dashboard presets. "Last N months" covers N calendar months ending with the current (partial) month. */
export function resolveRange(preset: RangePreset, today: IsoDate, custom?: { from?: string; to?: string }): { from: IsoDate; to: IsoDate; label: string } {
  const som = startOfMonth(today);
  switch (preset) {
    case "current_month":
      return { from: som, to: endOfMonth(today), label: "Current month" };
    case "previous_month": {
      const p = addMonths(som, -1);
      return { from: p, to: endOfMonth(p), label: "Previous month" };
    }
    case "last_3_months":
      return { from: addMonths(som, -2), to: endOfMonth(today), label: "Last three months" };
    case "last_6_months":
      return { from: addMonths(som, -5), to: endOfMonth(today), label: "Last six months" };
    case "last_12_months":
      return { from: addMonths(som, -11), to: endOfMonth(today), label: "Last twelve months" };
    case "year_to_date":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "Year to date" };
    default: {
      const from = custom?.from ?? som;
      const to = custom?.to && custom.to >= from ? custom.to : endOfMonth(from);
      return { from, to, label: "Custom range" };
    }
  }
}
/** The period of equal length immediately before [from, to]. */
export function previousPeriod(from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  const isWholeMonths = from.endsWith("-01") && isMonthEnd(to);
  if (isWholeMonths) {
    const n = monthKeys(from, to).length;
    return { from: addMonths(from, -n), to: endOfMonth(addMonths(from, -1)) };
  }
  const len = diffDays(to, from) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
