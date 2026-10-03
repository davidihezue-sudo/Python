// Business use of a vehicle (pure). Rates are reference values per year and must be confirmed with the CRA before filing.
import { D, Dec, ZERO, money, type DecLike } from "./decimal";

export const MILEAGE_RATES: Record<number, { firstKm: number; first: string; after: string }> = {
  2024: { firstKm: 5000, first: "0.70", after: "0.64" },
  2025: { firstKm: 5000, first: "0.72", after: "0.66" },
  2026: { firstKm: 5000, first: "0.72", after: "0.66" },
};
export const MILEAGE_SOURCE = "Reference automobile allowance rates per kilometre. The 2026 figures repeat 2025 until updated. Confirm the current rates at canada.ca. The territories add 4 cents a kilometre.";

export interface MileageClaim { year: number; rateMethod: string | null; percentMethod: string | null; businessPercent: string | null; notes: string[] }

/** Business share of all driving. Unknown (null) when total distance is not known, never guessed. */
export function businessShare(businessKm: DecLike, totalKm: DecLike | null): Dec | null {
  if (totalKm === null) return null;
  const t = D(totalKm);
  if (t.lte(0)) return null;
  const s = D(businessKm).div(t).times(100);
  return s.gt(100) ? D(100) : s;
}

export function mileageClaim(i: { year: number; businessKm: DecLike; totalKm: DecLike | null; runningCosts: DecLike | null }): MileageClaim {
  const r = MILEAGE_RATES[i.year];
  const km = D(i.businessKm);
  const share = businessShare(km, i.totalKm);
  const notes = ["Two common ways to claim: actual costs multiplied by the business share, or a per-kilometre rate for a reasonable allowance. Which one applies depends on your situation, so check the rules or ask your accountant."];
  let rate: string | null = null;
  if (r) {
    const firstPart = Dec.min(km, D(r.firstKm));
    rate = money(firstPart.times(r.first).plus(Dec.max(km.minus(r.firstKm), ZERO).times(r.after)));
  } else notes.push(`No per-kilometre rate is stored for ${i.year}.`);
  if (share === null) notes.push("The business share needs at least two odometer readings in the year.");
  return { year: i.year, rateMethod: rate, percentMethod: share !== null && i.runningCosts !== null ? money(D(i.runningCosts).times(share).div(100)) : null, businessPercent: share ? share.toDecimalPlaces(1).toString() : null, notes };
}
