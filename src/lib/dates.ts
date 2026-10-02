// Calendar-date helpers. Dates are handled as ISO "YYYY-MM-DD" strings (no timezone drift) and
// converted to UTC day numbers for arithmetic.
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== "string") return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDayNumber(iso: IsoDate): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY);
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  // a - b in days
  return toDayNumber(a) - toDayNumber(b);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(iso) + Math.round(days));
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const total = y * 12 + mo + months;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addInterval(iso: IsoDate, months?: number | null, days?: number | null): IsoDate {
  let r = iso;
  if (months) r = addMonths(r, months);
  if (days) r = addDays(r, days);
  return r;
}

/** Today's calendar date in an IANA timezone. */
export function todayInTz(tz: string = "UTC", now: Date = new Date()): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (ISO_RE.test(parts)) return parts;
  } catch {
    /* fall through */
  }
  return now.toISOString().slice(0, 10);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function dateToIso(d: Date | null | undefined): IsoDate | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function isoToDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function startOfYear(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 4)}-01-01`;
}

export function monthKey(iso: IsoDate): string {
  return iso.slice(0, 7);
}

/** Rough years/months/days phrase, used for "overdue by 3 months". */
export function humanizeDays(days: number): string {
  const abs = Math.abs(days);
  if (abs < 1) return "today";
  if (abs < 45) return `${abs} day${abs === 1 ? "" : "s"}`;
  if (abs < 365) {
    const m = Math.round(abs / 30.4375);
    return `${m} month${m === 1 ? "" : "s"}`;
  }
  const y = Math.round((abs / 365.25) * 10) / 10;
  return `${y} year${y === 1 ? "" : "s"}`;
}

export function formatDateInTz(iso: IsoDate | Date | string | null | undefined, tz = "UTC", locale = "en-CA"): string {
  if (!iso) return "n/a";
  if (typeof iso === "string" && ISO_RE.test(iso)) {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(isoToDate(iso));
  }
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export type RangeKey = "30d" | "90d" | "ytd" | "12m" | "all" | "custom";
/** Resolves a dashboard date-filter preset to concrete bounds. `from` null means "no lower bound" (all time). */
export function resolveRange(range: RangeKey, today: IsoDate, custom?: { from?: IsoDate; to?: IsoDate }): { from: IsoDate | null; to: IsoDate; label: string } {
  switch (range) {
    case "30d":
      return { from: addDays(today, -29), to: today, label: "Last 30 days" };
    case "90d":
      return { from: addDays(today, -89), to: today, label: "Last 90 days" };
    case "ytd":
      return { from: startOfYear(today), to: today, label: "Year to date" };
    case "12m":
      return { from: addDays(addMonths(today, -12), 1), to: today, label: "Last 12 months" };
    case "custom": {
      const from = custom?.from ?? null;
      const to = custom?.to ?? today;
      return { from, to: from && to < from ? from : to, label: from ? `${from} → ${to}` : `Up to ${to}` };
    }
    default:
      return { from: null, to: today, label: "All time" };
  }
}
