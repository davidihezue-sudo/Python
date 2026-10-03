// Monetary helpers. All calculations use integer cents; the database stores NUMERIC(12,2).
export type Cents = number;
export const toCents = (n: number | string | null | undefined): Cents => Math.round(Number(n ?? 0) * 100 + 1e-9 * Math.sign(Number(n ?? 0)));
export const fromCents = (c: Cents): number => Math.round(c) / 100;
export const fmt = (c: Cents, currency = 'CAD') =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(c / 100);

/** Percent of an amount, rounded half up, in cents. pct is a plain percentage (12 = 12%). */
export const pctOf = (c: Cents, pct: number): Cents => Math.round((c * pct) / 100 + 1e-9);

/** Split `total` across weights so the parts sum exactly to total (largest remainder). */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    out[0] += total - base * weights.length;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floors[order[k].i] += 1;
  return floors;
}

export class CurrencyMismatch extends Error {}
export function assertSameCurrency(...cs: string[]) {
  if (new Set(cs).size > 1) throw new CurrencyMismatch(`Currency mismatch: ${cs.join(', ')}`);
}
