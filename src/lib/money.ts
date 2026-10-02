// Decimal-safe money arithmetic using integer minor units (cents).
export function toCents(n: number | string | null | undefined): number {
  if (n === null || n === undefined || n === "") return 0;
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * 100);
}
export function fromCents(c: number): number {
  return Math.round(c) / 100;
}
export function sumMoney(values: Array<number | string | null | undefined>): number {
  return fromCents(values.reduce<number>((a, v) => a + toCents(v), 0));
}
/** total = parts + labour + tax − discount (never negative) */
export function computeTotal(p: { partsCost?: number | null; laborCost?: number | null; tax?: number | null; discount?: number | null }): number {
  const c = toCents(p.partsCost) + toCents(p.laborCost) + toCents(p.tax) - toCents(p.discount);
  return fromCents(Math.max(0, c));
}
export function formatMoney(amount: number | null | undefined, currency = "CAD", locale = "en-CA"): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
