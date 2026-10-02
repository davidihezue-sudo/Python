// Expense allocation. A transaction is recorded ONCE. Allocation only decides who it is attributed to, so the household
// totals never change when an expense is split, and the allocations of any transaction always add up to its amount exactly.
import { D, Dec, ZERO, sum, type Dec as DecT, type DecLike } from "./decimal";

export type AllocationMode = "OWNER" | "MEMBER" | "HOUSEHOLD" | "SPLIT";
export interface Allocation {
  /** null = the shared household pool */
  memberId: string | null;
  amount: DecT;
  percent?: DecT | null;
}
export interface SplitPart {
  memberId: string | null;
  amount?: DecLike;
  percent?: DecLike;
}
export class AllocationError extends Error {}

/**
 * Splits `total` (cents) across weights using the largest remainder method, so the parts always sum to the total
 * exactly (no lost or invented cents). Ties go to the earlier entry.
 */
export function apportion(total: DecLike, weights: DecLike[]): DecT[] {
  const t = D(total);
  const w = weights.map(D);
  const sw = sum(w);
  if (!w.length || sw.lte(0)) throw new AllocationError("Nothing to allocate to");
  const cents = t.times(100).abs().toDecimalPlaces(0, Dec.ROUND_HALF_UP);
  const sign = t.isNegative() ? -1 : 1;
  const exact = w.map((x) => cents.times(x).div(sw));
  const floors = exact.map((x) => x.floor());
  let left = cents.minus(sum(floors)).toNumber();
  const order = exact.map((x, i) => ({ i, r: x.minus(floors[i]) })).sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  const out = floors.map((f) => f);
  for (let k = 0; k < left; k++) out[order[k].i] = out[order[k].i].plus(1);
  return out.map((c) => c.div(100).times(sign));
}

export const splitEqually = (total: DecLike, memberIds: (string | null)[]): Allocation[] => apportion(total, memberIds.map(() => 1)).map((amount, i) => ({ memberId: memberIds[i], amount }));

/** Percent splits must total exactly 100. */
export function splitByPercent(total: DecLike, parts: { memberId: string | null; percent: DecLike }[]): Allocation[] {
  const pct = sum(parts.map((p) => p.percent));
  if (!pct.eq(100)) throw new AllocationError(`Percentages add up to ${pct.toString()}, but they must add up to 100`);
  return apportion(total, parts.map((p) => p.percent)).map((amount, i) => ({ memberId: parts[i].memberId, amount, percent: D(parts[i].percent) }));
}

/** Fixed amount splits must add up to the original amount exactly. */
export function splitByAmount(total: DecLike, parts: { memberId: string | null; amount: DecLike }[]): Allocation[] {
  const s = sum(parts.map((p) => p.amount));
  if (!s.eq(D(total))) throw new AllocationError(`The amounts add up to ${s.toFixed(2)}, but the expense is ${D(total).toFixed(2)}`);
  return parts.map((p) => ({ memberId: p.memberId, amount: D(p.amount) }));
}

/** Resolves the allocation rows for a transaction of magnitude `amount` (always positive here; refunds reuse the sign at the caller). */
export function resolveAllocations(i: { amount: DecLike; mode: AllocationMode; ownerId: string | null; allocatedMemberId?: string | null; splits?: SplitPart[] }): Allocation[] {
  const amount = D(i.amount);
  switch (i.mode) {
    case "OWNER":
      return [{ memberId: i.ownerId, amount }];
    case "MEMBER":
      if (!i.allocatedMemberId) throw new AllocationError("Choose the member this expense is allocated to");
      return [{ memberId: i.allocatedMemberId, amount }];
    case "HOUSEHOLD":
      return [{ memberId: null, amount }];
    case "SPLIT": {
      const parts = i.splits ?? [];
      if (parts.length < 2) throw new AllocationError("A split needs at least two parts");
      if (new Set(parts.map((p) => p.memberId)).size !== parts.length) throw new AllocationError("Each member can appear only once in a split");
      const usesPct = parts.every((p) => p.percent !== undefined && p.percent !== null && p.amount === undefined);
      const usesAmt = parts.every((p) => p.amount !== undefined && p.amount !== null && p.percent === undefined);
      if (usesPct) return splitByPercent(amount, parts.map((p) => ({ memberId: p.memberId, percent: p.percent as DecLike })));
      if (usesAmt) return splitByAmount(amount, parts.map((p) => ({ memberId: p.memberId, amount: p.amount as DecLike })));
      if (parts.every((p) => p.amount === undefined && p.percent === undefined)) return splitEqually(amount, parts.map((p) => p.memberId));
      throw new AllocationError("Use either percentages or amounts for a split, not both");
    }
  }
}

/** Scales stored (positive) allocations to a different signed total, for refunds and reimbursements that mirror an expense. */
export const signedAllocations = (allocs: Allocation[], sign: 1 | -1): Allocation[] => allocs.map((a) => ({ ...a, amount: sign === 1 ? a.amount : a.amount.negated() }));
export { ZERO };
