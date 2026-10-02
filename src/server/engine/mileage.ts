import { addDays, diffDays, type IsoDate } from "@/lib/dates";

export interface Reading {
  date: IsoDate;
  valueKm: number;
}

export type ReadingCheck =
  | { ok: true; warnings: string[] }
  | { ok: false; code: "BACKWARD_FROM_PREVIOUS" | "BELOW_NEXT_READING"; message: string; conflict: Reading; requiresConfirmation: true };

const sortReadings = (rs: Reading[]) => [...rs].sort((a, b) => (a.date === b.date ? a.valueKm - b.valueKm : a.date < b.date ? -1 : 1));

/**
 * Validates that a reading keeps the odometer monotonic over time.
 * A reading must be >= every reading on EARLIER dates and <= every reading on LATER dates.
 * Several readings on the same day are allowed.
 * `excludeIndex`-style edits: pass the list WITHOUT the entry being edited.
 */
export function validateReading(existing: Reading[], candidate: Reading, opts: { maxKmPerDay?: number } = {}): ReadingCheck {
  const maxKmPerDay = opts.maxKmPerDay ?? 2500;
  const earlier = existing.filter((r) => r.date < candidate.date);
  const later = existing.filter((r) => r.date > candidate.date);
  const prevMax = earlier.reduce<Reading | null>((m, r) => (!m || r.valueKm > m.valueKm ? r : m), null);
  if (prevMax && candidate.valueKm < prevMax.valueKm) {
    return {
      ok: false,
      code: "BACKWARD_FROM_PREVIOUS",
      message: `Odometer ${candidate.valueKm} km on ${candidate.date} is lower than the ${prevMax.valueKm} km recorded on ${prevMax.date}.`,
      conflict: prevMax,
      requiresConfirmation: true,
    };
  }
  const nextMin = later.reduce<Reading | null>((m, r) => (!m || r.valueKm < m.valueKm ? r : m), null);
  if (nextMin && candidate.valueKm > nextMin.valueKm) {
    return {
      ok: false,
      code: "BELOW_NEXT_READING",
      message: `Odometer ${candidate.valueKm} km on ${candidate.date} is higher than the ${nextMin.valueKm} km recorded later on ${nextMin.date}.`,
      conflict: nextMin,
      requiresConfirmation: true,
    };
  }
  const warnings: string[] = [];
  const prevLatest = sortReadings(earlier).at(-1);
  if (prevLatest) {
    const days = Math.max(1, diffDays(candidate.date, prevLatest.date));
    const perDay = (candidate.valueKm - prevLatest.valueKm) / days;
    if (perDay > maxKmPerDay) warnings.push(`That implies ${Math.round(perDay)} km/day since ${prevLatest.date}, which is unusually high - please double-check the reading.`);
  }
  return { ok: true, warnings };
}

export interface UsageStats {
  /** Average km per day over the sampling window, or null when there isn't enough data. */
  avgDailyKm: number | null;
  avgMonthlyKm: number | null;
  avgYearlyKm: number | null;
  windowStart: IsoDate | null;
  windowEnd: IsoDate | null;
  windowDays: number;
  readingsUsed: number;
  totalKm: number;
  confidence: "none" | "low" | "ok";
  note: string;
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Average usage. Uses the trailing `windowDays` (default 365) ending at the latest reading when that window has
 * at least two readings spanning >= 14 days; otherwise falls back to all readings.
 */
export function computeUsage(readingsIn: Reading[], opts: { windowDays?: number } = {}): UsageStats {
  const windowDays = opts.windowDays ?? 365;
  const rs = sortReadings(readingsIn);
  const empty = (note: string): UsageStats => ({
    avgDailyKm: null,
    avgMonthlyKm: null,
    avgYearlyKm: null,
    windowStart: null,
    windowEnd: null,
    windowDays: 0,
    readingsUsed: rs.length,
    totalKm: rs.length > 1 ? rs[rs.length - 1].valueKm - rs[0].valueKm : 0,
    confidence: "none",
    note,
  });
  if (rs.length < 2) return empty("At least two odometer readings on different dates are needed to estimate driving habits.");
  const last = rs[rs.length - 1];
  const cutoff = addDays(last.date, -windowDays);
  let set = rs.filter((r) => r.date >= cutoff);
  // Anchor the window start by interpolating between the readings either side of the cutoff.
  const atCutoff = cutoff > rs[0].date ? kmAtDate(rs, cutoff) : null;
  if (atCutoff !== null && !set.some((r) => r.date === cutoff)) set = [{ date: cutoff, valueKm: atCutoff }, ...set];
  if (set.length < 2 || diffDays(set[set.length - 1].date, set[0].date) < 14) set = rs;
  const first = set[0];
  const end = set[set.length - 1];
  const span = diffDays(end.date, first.date);
  if (span < 1) return empty("Odometer readings are all on the same date.");
  const daily = Math.max(0, (end.valueKm - first.valueKm) / span);
  return {
    avgDailyKm: daily,
    avgMonthlyKm: daily * DAYS_PER_MONTH,
    avgYearlyKm: daily * 365.25,
    windowStart: first.date,
    windowEnd: end.date,
    windowDays: span,
    readingsUsed: set.length,
    totalKm: end.valueKm - first.valueKm,
    confidence: span < 30 ? "low" : "ok",
    note: span < 30 ? "Based on less than 30 days of readings - treat estimates as rough." : `Based on ${span} days of readings.`,
  };
}

export function projectKm(current: Reading | null, targetDate: IsoDate, avgDailyKm: number | null): number | null {
  if (!current || avgDailyKm === null) return null;
  const days = diffDays(targetDate, current.date);
  return current.valueKm + Math.max(0, days) * avgDailyKm;
}

/** Estimated calendar date at which the odometer reaches `targetKm`. Null if unknowable. */
export function estimateDateForKm(targetKm: number, current: Reading | null, avgDailyKm: number | null, today: IsoDate): IsoDate | null {
  if (!current) return null;
  const remaining = targetKm - current.valueKm;
  if (remaining <= 0) return today;
  if (!avgDailyKm || avgDailyKm <= 0) return null;
  const from = current.date > today ? current.date : today;
  return addDays(from, Math.ceil(remaining / avgDailyKm));
}

/** Linear interpolation of the odometer at a date, or null when outside the recorded range. */
export function kmAtDate(readingsIn: Reading[], date: IsoDate): number | null {
  const rs = sortReadings(readingsIn);
  if (rs.length === 0) return null;
  if (date < rs[0].date || date > rs[rs.length - 1].date) return null;
  let lo = rs[0];
  for (const r of rs) {
    if (r.date === date) return r.valueKm;
    if (r.date < date) lo = r;
    else {
      const span = diffDays(r.date, lo.date);
      if (span <= 0) return r.valueKm;
      return lo.valueKm + ((r.valueKm - lo.valueKm) * diffDays(date, lo.date)) / span;
    }
  }
  return null;
}

/** Monthly distance driven series (interpolated at month boundaries where possible). */
export function monthlyDistance(readingsIn: Reading[]): { month: string; km: number }[] {
  const rs = sortReadings(readingsIn);
  if (rs.length < 2) return [];
  const out: { month: string; km: number }[] = [];
  const firstM = rs[0].date.slice(0, 7);
  const lastM = rs[rs.length - 1].date.slice(0, 7);
  const months: string[] = [];
  let [y, m] = firstM.split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= lastM) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  for (const mk of months) {
    const start = `${mk}-01`;
    const nextStart = addDays(`${mk}-28`, 4).slice(0, 7) + "-01";
    const from = start < rs[0].date ? rs[0].date : start;
    const toRaw = nextStart;
    const to = toRaw > rs[rs.length - 1].date ? rs[rs.length - 1].date : toRaw;
    const a = kmAtDate(rs, from);
    const b = kmAtDate(rs, to);
    if (a !== null && b !== null && to > from) out.push({ month: mk, km: Math.max(0, b - a) });
  }
  return out;
}
