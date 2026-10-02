import { addDays, diffDays, monthKey, type IsoDate } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money";
import { kmAtDate, type Reading } from "./mileage";

export interface ExpenseRow {
  date: IsoDate;
  amount: number;
  category: string;
  vendor?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  currency?: string;
}

export interface CostPerDistance {
  costPerKm: number | null;
  totalCost: number;
  distanceKm: number | null;
  coveredFrom: IsoDate | null;
  coveredTo: IsoDate | null;
  /** Expenses dated outside the odometer-covered window are excluded from the numerator so it matches the denominator. */
  excludedOutsideCoverage: { count: number; amount: number };
  coverage: "full" | "partial" | "none";
  note: string;
}

/**
 * Cost per kilometre = expenses inside the window ÷ distance driven inside the same window.
 * The window is the requested range clamped to the span of recorded odometer readings, so we never divide
 * costs from years with no mileage data by a shorter distance (which would inflate the figure).
 */
export function costPerDistance(
  expenses: ExpenseRow[],
  readings: Reading[],
  range: { from?: IsoDate | null; to?: IsoDate | null },
  filter: { include?: string[]; exclude?: string[] } = {},
): CostPerDistance {
  const rs = [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.valueKm - b.valueKm));
  const none = (note: string): CostPerDistance => ({
    costPerKm: null,
    totalCost: 0,
    distanceKm: null,
    coveredFrom: null,
    coveredTo: null,
    excludedOutsideCoverage: { count: 0, amount: 0 },
    coverage: "none",
    note,
  });
  if (rs.length < 2 || rs[0].date === rs[rs.length - 1].date) return none("At least two odometer readings on different dates are required to calculate cost per distance.");
  const reqFrom = range.from ?? rs[0].date;
  const reqTo = range.to ?? rs[rs.length - 1].date;
  const from = reqFrom < rs[0].date ? rs[0].date : reqFrom;
  const to = reqTo > rs[rs.length - 1].date ? rs[rs.length - 1].date : reqTo;
  if (to <= from) return none("The selected period has no odometer coverage.");
  const kmFrom = kmAtDate(rs, from);
  const kmTo = kmAtDate(rs, to);
  if (kmFrom === null || kmTo === null || kmTo - kmFrom <= 0) return none("No distance was driven in the covered period.");
  const filtered = expenses.filter((e) => (!filter.include || filter.include.includes(e.category)) && !(filter.exclude ?? []).includes(e.category));
  let inC = 0;
  let outC = 0;
  let outN = 0;
  const lo = range.from ?? "0000-01-01";
  const hi = range.to ?? "9999-12-31";
  for (const e of filtered) {
    if (e.date < lo || e.date > hi) continue;
    if (e.date >= from && e.date <= to) inC += toCents(e.amount);
    else {
      outC += toCents(e.amount);
      outN++;
    }
  }
  const dist = kmTo - kmFrom;
  const full = outN === 0 && from === reqFrom && to === reqTo;
  return {
    costPerKm: fromCents(inC) / dist,
    totalCost: fromCents(inC),
    distanceKm: dist,
    coveredFrom: from,
    coveredTo: to,
    excludedOutsideCoverage: { count: outN, amount: fromCents(outC) },
    coverage: full ? "full" : "partial",
    note: full
      ? `Based on ${Math.round(dist)} km driven between ${from} and ${to}.`
      : `Odometer data only covers ${from} to ${to}; costs outside that window were excluded so the figure is not misleading.`,
  };
}

export function sumBy<T>(rows: T[], key: (r: T) => string, amount: (r: T) => number): { key: string; total: number; count: number }[] {
  const m = new Map<string, { c: number; n: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { c: 0, n: 0 };
    cur.c += toCents(amount(r));
    cur.n++;
    m.set(k, cur);
  }
  return [...m.entries()].map(([key, v]) => ({ key, total: fromCents(v.c), count: v.n })).sort((a, b) => b.total - a.total);
}

export const spendByCategory = (rows: ExpenseRow[]) => sumBy(rows, (r) => r.category, (r) => r.amount);
export const spendByProvider = (rows: ExpenseRow[]) => sumBy(rows.filter((r) => r.providerName || r.vendor), (r) => (r.providerName ?? r.vendor) as string, (r) => r.amount);
export const spendByYear = (rows: ExpenseRow[]) => sumBy(rows, (r) => r.date.slice(0, 4), (r) => r.amount).sort((a, b) => (a.key < b.key ? -1 : 1));

/** Month series with zero-filled gaps from `from` to `to` (inclusive months). */
export function spendByMonth(rows: ExpenseRow[], from: IsoDate, to: IsoDate, categories?: string[]): { month: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (categories && !categories.includes(r.category)) continue;
    const k = monthKey(r.date);
    totals.set(k, (totals.get(k) ?? 0) + toCents(r.amount));
  }
  const out: { month: string; total: number }[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 1200; guard++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > end) break;
    out.push({ month: k, total: fromCents(totals.get(k) ?? 0) });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface BudgetStatus {
  budget: number;
  actual: number;
  remaining: number;
  utilizationPct: number;
  projected: number | null;
  projectedPct: number | null;
  projectionNote: string;
  state: "ok" | "approaching" | "exceeded";
}

export function budgetStatus(p: { amount: number; actual: number; periodStart: IsoDate; periodEnd: IsoDate; today: IsoDate; warnAtPct?: number }): BudgetStatus {
  const warn = p.warnAtPct ?? 80;
  const util = p.amount > 0 ? (p.actual / p.amount) * 100 : p.actual > 0 ? 100 : 0;
  const totalDays = diffDays(p.periodEnd, p.periodStart) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, diffDays(p.today, p.periodStart) + 1));
  let projected: number | null = null;
  let note = "";
  if (p.today > p.periodEnd) {
    projected = p.actual;
    note = "Period complete.";
  } else if (elapsed < 1) {
    note = "Period has not started.";
  } else if (elapsed < Math.min(14, totalDays * 0.1)) {
    note = "Too early in the period for a reliable projection.";
  } else {
    projected = fromCents(Math.round((toCents(p.actual) * totalDays) / elapsed));
    note = "Straight-line projection of spending so far across the whole period - maintenance costs are lumpy, so treat as a rough guide.";
  }
  return {
    budget: p.amount,
    actual: p.actual,
    remaining: fromCents(toCents(p.amount) - toCents(p.actual)),
    utilizationPct: Math.round(util * 10) / 10,
    projected,
    projectedPct: projected !== null && p.amount > 0 ? Math.round((projected / p.amount) * 1000) / 10 : null,
    projectionNote: note,
    state: util >= 100 ? "exceeded" : util >= warn ? "approaching" : "ok",
  };
}

export function budgetPeriod(period: "MONTHLY" | "ANNUAL", year: number, month?: number | null): { start: IsoDate; end: IsoDate } {
  if (period === "ANNUAL") return { start: `${year}-01-01`, end: `${year}-12-31` };
  const m = month ?? 1;
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const next = addDays(`${year}-${String(m).padStart(2, "0")}-28`, 4);
  return { start, end: addDays(`${next.slice(0, 7)}-01`, -1) };
}
