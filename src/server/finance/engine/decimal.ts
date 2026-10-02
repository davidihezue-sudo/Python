// Decimal-safe arithmetic for every monetary calculation. Floating point is never used for money.
import Decimal from "decimal.js";

export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;
export type DecLike = Dec | Decimal | string | number | bigint | { toString(): string } | null | undefined;

export const ZERO = new Dec(0);
export const ONE = new Dec(1);

/** Converts anything numeric (including Prisma.Decimal) into a Dec. null/undefined/"" become 0. */
export function D(v: DecLike): Dec {
  if (v === null || v === undefined || v === "") return ZERO;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Non-finite number cannot be used as money");
    return new Dec(v);
  }
  if (v instanceof Dec) return v;
  const d = new Dec(typeof v === "bigint" ? v.toString() : (v as { toString(): string }).toString());
  if (!d.isFinite()) throw new Error("Non-finite value cannot be used as money");
  return d;
}

/** Removes the sign of a negative zero so that "-0.00" is never displayed or stored. */
export const clean = (d: Dec): Dec => (d.isZero() ? ZERO : d);
export const round2 = (v: DecLike): Dec => clean(D(v).toDecimalPlaces(2, Dec.ROUND_HALF_UP));
/** Canonical wire/storage representation: a plain string with exactly two decimals. */
export const money = (v: DecLike): string => round2(v).toFixed(2);
export const sum = (vals: Iterable<DecLike>): Dec => {
  let t = ZERO;
  for (const v of vals) t = t.plus(D(v));
  return t;
};
export const sumBy = <T>(items: Iterable<T>, f: (t: T) => DecLike): Dec => {
  let t = ZERO;
  for (const i of items) t = t.plus(D(f(i)));
  return t;
};
export const max0 = (v: DecLike): Dec => (D(v).isNegative() ? ZERO : D(v));
export const min = (a: DecLike, b: DecLike): Dec => Dec.min(D(a), D(b));
export const max = (a: DecLike, b: DecLike): Dec => Dec.max(D(a), D(b));

/** a / b as a percentage with 2 dp, or null when b is zero (never divide silently by zero). */
export function pct(a: DecLike, b: DecLike): Dec | null {
  const den = D(b);
  if (den.isZero()) return null;
  return D(a).div(den).times(100).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
}
/** Safe division returning null for a zero denominator. */
export function div(a: DecLike, b: DecLike): Dec | null {
  const den = D(b);
  return den.isZero() ? null : D(a).div(den);
}
export const num = (v: DecLike): number => D(v).toNumber();
