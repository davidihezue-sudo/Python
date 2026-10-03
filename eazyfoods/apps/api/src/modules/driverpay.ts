// Driver compensation, kept separate from the delivery fee customers pay and from platform margin.
import { toCents, fromCents, pctOf, type Cents } from '../money.js';

export interface PayConfig {
  base: number; per_km: number; per_minute: number; min_guarantee: number;
  peak_windows: { start: string; end: string; bonus: number }[];
  surge: { enabled: boolean; threshold_ratio: number; step: number; max_multiplier: number };
  multi_order_bonus: number; promo_bonus: number; cancellation_compensation: number;
}
export interface PayBreakdown { base: Cents; distance_pay: Cents; time_pay: Cents; peak_bonus: Cents; surge: Cents; multi_order_bonus: Cents; promo_bonus: Cents; guarantee_topup: Cents; total: Cents; surge_multiplier: number }

function localMinutes(d: Date, tz = 'America/Toronto') {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  return (Number(f.find((p) => p.type === 'hour')!.value) % 24) * 60 + Number(f.find((p) => p.type === 'minute')!.value);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

export function computeDriverPay(p: { distanceKm: number; minutes: number; at: Date; demandRatio: number; batchSize: number }, cfg: PayConfig): PayBreakdown {
  const base = toCents(cfg.base);
  const distance_pay = Math.round(cfg.per_km * 100 * p.distanceKm);
  const time_pay = Math.round(cfg.per_minute * 100 * p.minutes);
  const m = localMinutes(p.at);
  const peak = cfg.peak_windows.find((w) => (hm(w.start) <= hm(w.end) ? m >= hm(w.start) && m < hm(w.end) : m >= hm(w.start) || m < hm(w.end)));
  const peak_bonus = peak ? toCents(peak.bonus) : 0;
  let mult = 1;
  if (cfg.surge.enabled && p.demandRatio >= cfg.surge.threshold_ratio) {
    mult = Math.min(cfg.surge.max_multiplier, 1 + cfg.surge.step * (1 + Math.floor((p.demandRatio - cfg.surge.threshold_ratio) / 0.5)));
  }
  const surge = Math.round((base + distance_pay + time_pay) * (mult - 1));
  const multi_order_bonus = Math.max(0, p.batchSize - 1) * toCents(cfg.multi_order_bonus);
  const promo_bonus = toCents(cfg.promo_bonus);
  const subtotal = base + distance_pay + time_pay + peak_bonus + surge + multi_order_bonus + promo_bonus;
  const guarantee_topup = Math.max(0, toCents(cfg.min_guarantee) - subtotal);
  return { base, distance_pay, time_pay, peak_bonus, surge, multi_order_bonus, promo_bonus, guarantee_topup, total: subtotal + guarantee_topup, surge_multiplier: mult };
}
export const payToJson = (b: PayBreakdown) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, k === 'surge_multiplier' ? v : fromCents(v as number)]));
export { pctOf };
