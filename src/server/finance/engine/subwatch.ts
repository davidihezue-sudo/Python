// Subscription watch (pure): spot duplicates, price creep and regular charges that are not on the list.
import { D, Dec, money, type DecLike } from "./decimal";

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(inc|ltd|llc|corp|co|the|com|ca|subscription|membership|monthly|annual|plan|premium|standard)\b/g, " ").replace(/\s+/g, " ").trim();

export interface SubLite { id: string; name: string; provider?: string | null; amount: DecLike; active: boolean }
/** Two active subscriptions with the same name or provider are probably paying for the same thing twice. */
export function findDuplicates(subs: SubLite[]): { names: string[]; ids: string[]; reason: string }[] {
  const act = subs.filter((s) => s.active);
  const groups = new Map<string, SubLite[]>();
  for (const s of act) for (const k of new Set([normName(s.name), s.provider ? normName(s.provider) : ""].filter((x) => x.length >= 3))) groups.set(k, [...(groups.get(k) ?? []), s]);
  const seen = new Set<string>(), out: { names: string[]; ids: string[]; reason: string }[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const ids = [...new Set(list.map((s) => s.id))].sort();
    if (ids.length < 2) continue;
    const key = ids.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ids, names: ids.map((id) => list.find((s) => s.id === id)!.name), reason: `Both look like "${k}".` });
  }
  return out;
}

export interface Charge { date: string; amount: DecLike }
/** Compares the latest charge with the first of the recent charges. Charges are positive amounts. */
export function priceChange(charges: Charge[]): { from: string; to: string; since: string; change: string; percent: string; yearlyImpact: string } | null {
  const c = charges.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (c.length < 2) return null;
  const last = D(c[c.length - 1].amount);
  // use the most common earlier amount as the baseline so one odd charge does not trigger it
  const earlier = c.slice(0, -1).map((x) => D(x.amount).toFixed(2));
  const tally = new Map<string, number>();
  for (const e of earlier) tally.set(e, (tally.get(e) ?? 0) + 1);
  const base = D([...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0]);
  if (last.lte(base) || base.lte(0)) return null;
  const diff = last.minus(base);
  const pct = diff.div(base).times(100);
  if (pct.lt(2)) return null;
  return { from: money(base), to: money(last), since: c[c.length - 1].date, change: money(diff), percent: pct.toDecimalPlaces(1).toString(), yearlyImpact: money(diff.times(12)) };
}

export interface MerchantCharges { merchant: string; charges: Charge[] }
/** Regular, similar charges in at least three different months that match nothing in the subscription list. */
export function findUntracked(groups: MerchantCharges[], subs: SubLite[]): { merchant: string; typical: string; months: number }[] {
  const known = subs.map((s) => normName(s.name));
  const out: { merchant: string; typical: string; months: number }[] = [];
  for (const g of groups) {
    const n = normName(g.merchant);
    if (!n || known.some((k) => k && (k.includes(n) || n.includes(k)))) continue;
    const months = new Set(g.charges.map((c) => c.date.slice(0, 7)));
    if (months.size < 3 || g.charges.length > months.size * 2) continue;
    const amts = g.charges.map((c) => D(c.amount));
    const lo = Dec.min(...amts), hi = Dec.max(...amts);
    if (lo.lte(0) || hi.minus(lo).div(lo).gt("0.15")) continue;
    out.push({ merchant: g.merchant, typical: money(amts.reduce((a, b) => a.plus(b), D(0)).div(amts.length)), months: months.size });
  }
  return out.sort((a, b) => b.months - a.months);
}
