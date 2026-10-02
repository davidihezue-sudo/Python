import { monthKey, type IsoDate } from "@/lib/dates";
import { fromCents, toCents } from "@/lib/money";

export interface FuelRow {
  id?: string;
  date: IsoDate;
  odometerKm: number;
  litres: number;
  totalCost: number;
  fullTank: boolean;
  missedPrevious?: boolean;
}

export interface FuelSegment {
  /** id of the full-tank fill that closes the segment */
  endId?: string;
  startKm: number;
  endKm: number;
  date: IsoDate;
  distanceKm: number;
  litres: number;
  cost: number;
  litresPer100Km: number;
  costPerKm: number;
}

/**
 * Full-to-full fuel economy. Consumption is only calculated between two consecutive FULL fills; any partial fills in
 * between add to the litres burned. A fill flagged `missedPrevious` breaks the chain (its litres cover an unknown gap).
 */
export function computeFuelSegments(rowsIn: FuelRow[]): FuelSegment[] {
  const rows = [...rowsIn].sort((a, b) => (a.date === b.date ? a.odometerKm - b.odometerKm : a.date < b.date ? -1 : 1));
  const segs: FuelSegment[] = [];
  let baseline: number | null = null;
  let litres = 0;
  let cents = 0;
  for (const r of rows) {
    if (r.missedPrevious) {
      baseline = r.fullTank ? r.odometerKm : null;
      litres = 0;
      cents = 0;
      continue;
    }
    if (baseline === null) {
      if (r.fullTank) {
        baseline = r.odometerKm;
        litres = 0;
        cents = 0;
      }
      continue;
    }
    litres += r.litres;
    cents += toCents(r.totalCost);
    if (r.fullTank) {
      const dist = r.odometerKm - baseline;
      if (dist > 0 && litres > 0) {
        segs.push({
          endId: r.id,
          startKm: baseline,
          endKm: r.odometerKm,
          date: r.date,
          distanceKm: dist,
          litres,
          cost: fromCents(cents),
          litresPer100Km: (litres / dist) * 100,
          costPerKm: fromCents(cents) / dist,
        });
      }
      baseline = r.odometerKm;
      litres = 0;
      cents = 0;
    }
  }
  return segs;
}

export interface FuelStats {
  segments: FuelSegment[];
  avgLitresPer100Km: number | null;
  avgCostPerKm: number | null;
  bestLitresPer100Km: number | null;
  worstLitresPer100Km: number | null;
  avgDistanceBetweenFills: number | null;
  totalLitres: number;
  totalCost: number;
  avgPricePerLitre: number | null;
  fillCount: number;
  monthlyCost: { month: string; total: number; litres: number }[];
  priceTrend: { date: IsoDate; pricePerL: number }[];
  note: string;
}

export function computeFuelStats(rowsIn: FuelRow[]): FuelStats {
  const rows = [...rowsIn].sort((a, b) => (a.date === b.date ? a.odometerKm - b.odometerKm : a.date < b.date ? -1 : 1));
  const segments = computeFuelSegments(rows);
  const distance = segments.reduce((a, s) => a + s.distanceKm, 0);
  const litres = segments.reduce((a, s) => a + s.litres, 0);
  const cost = segments.reduce((a, s) => a + toCents(s.cost), 0);
  const totalLitres = rows.reduce((a, r) => a + r.litres, 0);
  const totalCents = rows.reduce((a, r) => a + toCents(r.totalCost), 0);
  const monthly = new Map<string, { c: number; l: number }>();
  for (const r of rows) {
    const k = monthKey(r.date);
    const cur = monthly.get(k) ?? { c: 0, l: 0 };
    cur.c += toCents(r.totalCost);
    cur.l += r.litres;
    monthly.set(k, cur);
  }
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) if (!rows[i].missedPrevious && rows[i].odometerKm > rows[i - 1].odometerKm) gaps.push(rows[i].odometerKm - rows[i - 1].odometerKm);
  const per100 = segments.map((s) => s.litresPer100Km);
  return {
    segments,
    avgLitresPer100Km: distance > 0 ? (litres / distance) * 100 : null,
    avgCostPerKm: distance > 0 ? fromCents(cost) / distance : null,
    bestLitresPer100Km: per100.length ? Math.min(...per100) : null,
    worstLitresPer100Km: per100.length ? Math.max(...per100) : null,
    avgDistanceBetweenFills: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    totalLitres,
    totalCost: fromCents(totalCents),
    avgPricePerLitre: totalLitres > 0 ? fromCents(totalCents) / totalLitres : null,
    fillCount: rows.length,
    monthlyCost: [...monthly.entries()].sort().map(([month, v]) => ({ month, total: fromCents(v.c), litres: v.l })),
    priceTrend: rows.filter((r) => r.litres > 0).map((r) => ({ date: r.date, pricePerL: r.totalCost / r.litres })),
    note: segments.length
      ? "Economy is calculated between consecutive full-tank fill-ups (partial fills are included in the litres burned)."
      : "Economy needs at least two full-tank fill-ups with no skipped fill-ups between them.",
  };
}
