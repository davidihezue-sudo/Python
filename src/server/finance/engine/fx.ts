// Currency conversion. Currencies are never combined silently: a missing rate is reported, not guessed.
import { D, Dec, ONE, type Dec as DecT, type DecLike } from "./decimal";
import type { IsoDate } from "./dates";

export interface FxRateRow {
  base: string;
  quote: string;
  rate: DecLike;
  asOf: IsoDate;
  source?: string;
}
export interface Conversion {
  amount: DecT;
  rate: DecT;
  asOf: IsoDate | null;
  source: string;
}

export function makeFx(rates: FxRateRow[]) {
  const sorted = [...rates].sort((a, b) => (a.asOf < b.asOf ? 1 : -1)); // newest first
  const missing = new Set<string>();

  function find(from: string, to: string, on: IsoDate): { rate: DecT; asOf: IsoDate; source: string } | null {
    for (const r of sorted) {
      if (r.asOf > on) continue;
      if (r.base === from && r.quote === to) return { rate: D(r.rate), asOf: r.asOf, source: r.source ?? "manual" };
      if (r.base === to && r.quote === from && !D(r.rate).isZero()) return { rate: ONE.div(D(r.rate)), asOf: r.asOf, source: r.source ?? "manual" };
    }
    return null;
  }

  return {
    /** Converts using the most recent rate on or before `on`. Same currency is always exact. Returns null (and records the pair) if no rate exists. */
    convert(amount: DecLike, from: string, to: string, on: IsoDate): Conversion | null {
      if (from === to) return { amount: D(amount), rate: ONE, asOf: null, source: "same-currency" };
      const f = find(from, to, on);
      if (!f) {
        missing.add(`${from}->${to}`);
        return null;
      }
      return { amount: D(amount).times(f.rate), rate: f.rate, asOf: f.asOf, source: f.source };
    },
    missingPairs: () => [...missing].sort(),
  };
}
export type Fx = ReturnType<typeof makeFx>;
export const noFx = (): Fx => makeFx([]);
export { Dec };
