// Promotion engine. Pure: given the cart lines and candidate promotions it decides which apply,
// how much each saves, who funds it, and which promotions are rejected and why.
import { allocate, pctOf, toCents, type Cents } from '../money.js';
import type { Promotion, QuoteInput, QuoteLine } from './types.js';

export interface PromoLine { idx: number; line: QuoteLine; base: Cents; vendorDisc: Cents; platformDisc: Cents }
export interface PromoGroup { vendorId: string; deliveryPayable: Cents; platformDelivery: boolean; deliveryDiscVendor: Cents; deliveryDiscPlatform: Cents }
export interface AppliedPromo { promo: Promotion; amount: Cents }
export interface PromoResult { applied: AppliedPromo[]; rejected: { code: string; name: string; reason: string }[] }

export const lineEligible = (p: Promotion, l: QuoteLine): boolean => {
  const s = p.scope ?? {};
  if (p.vendor_id && l.vendorId !== p.vendor_id) return false;
  if (s.vendor_ids?.length && !s.vendor_ids.includes(l.vendorId)) return false;
  if (s.category_ids?.length && !s.category_ids.some((c) => l.categoryIds.includes(c))) return false;
  if (s.product_ids?.length && !s.product_ids.includes(l.productId)) return false;
  if (s.product_types?.length && !s.product_types.includes(l.productType)) return false;
  return true;
};

export function promoWindowReason(p: Promotion, now: Date): string | null {
  if (p.status !== 'active') return 'This promotion is not active.';
  if (p.starts_at && new Date(p.starts_at) > now) return 'This promotion has not started yet.';
  if (p.ends_at && new Date(p.ends_at) <= now) return 'This promotion has expired.';
  return null;
}

const compatible = (a: Promotion, b: Promotion, allow: boolean) =>
  allow && a.stackable && b.stackable && (!a.stack_group || a.stack_group !== b.stack_group);

export function applyPromotions(input: QuoteInput, lines: PromoLine[], groups: PromoGroup[]): PromoResult {
  const { now, customer, settings } = input;
  const rejected: PromoResult['rejected'] = [];
  const entered = new Set(input.couponCodes.map((c) => c.trim().toUpperCase()));
  const itemsSubtotal = lines.reduce((s, l) => s + l.base, 0);
  const discountCap = Math.floor((itemsSubtotal * settings.promotions.max_total_discount_pct) / 100);
  let itemDiscountUsed = 0;

  // 1. Eligibility
  type Cand = { promo: Promotion; reason?: string };
  const cands: Cand[] = [];
  const known = new Set<string>();
  for (const p of input.promotions) {
    const code = p.code?.toUpperCase() ?? null;
    if (code) known.add(code);
    if (!p.auto_apply && !(code && entered.has(code))) continue; // coupon not entered
    const label = p.code ?? p.name;
    const fail = (reason: string) => { rejected.push({ code: p.code ?? '', name: label, reason }); };
    const win = promoWindowReason(p, now);
    if (win) { fail(win); continue; }
    if (p.usage_limit != null && p.redemption_count >= p.usage_limit) { fail('This promotion has reached its usage limit.'); continue; }
    if (p.per_customer_limit != null && (customer.redemptions.get(p.id) ?? 0) >= p.per_customer_limit) { fail('You have already used this promotion the maximum number of times.'); continue; }
    if (p.segment_id && !customer.segmentIds.has(p.segment_id)) { fail('This promotion is not available for your account.'); continue; }
    if (p.type === 'first_order' && !customer.isFirstOrder) { fail('This promotion is for first orders only.'); continue; }
    const elig = lines.filter((l) => lineEligible(p, l.line));
    const platformDeliveryEligible = groups.some((g) => g.platformDelivery && (!p.vendor_id || g.vendorId === p.vendor_id) && (!p.scope?.vendor_ids?.length || p.scope.vendor_ids.includes(g.vendorId)));
    if (p.type === 'free_delivery' ? !platformDeliveryEligible : elig.length === 0) { fail('Nothing in your cart qualifies for this promotion.'); continue; }
    const eligSubtotal = p.type === 'free_delivery' ? itemsSubtotal : elig.reduce((s, l) => s + l.base, 0);
    if (eligSubtotal < toCents(p.min_order)) { fail(`Spend at least $${Number(p.min_order).toFixed(2)} on eligible items to use this promotion.`); continue; }
    cands.push({ promo: p });
  }
  for (const c of entered) if (!known.has(c)) rejected.push({ code: c, name: c, reason: 'That code is not valid.' });

  // 2. Rank by standalone value, higher priority first
  const standalone = (p: Promotion) => simulate(p, lines.map((l) => ({ ...l })), groups.map((g) => ({ ...g })), 0, Infinity).total;
  const ranked = cands
    .map((c) => ({ ...c, value: standalone(c.promo) }))
    .sort((a, b) => b.promo.priority - a.promo.priority || b.value - a.value);

  // 3. Greedy selection honoring stackability, then sequentially apply on the remaining balances
  const selected: Promotion[] = [];
  const applied: AppliedPromo[] = [];
  for (const c of ranked) {
    const p = c.promo;
    const clash = selected.find((s) => !compatible(s, p, settings.promotions.allow_stacking));
    if (clash) { rejected.push({ code: p.code ?? '', name: p.code ?? p.name, reason: `This promotion can not be combined with ${clash.code ?? clash.name}.` }); continue; }
    if (selected.length >= Math.max(1, settings.promotions.max_stacked)) { rejected.push({ code: p.code ?? '', name: p.code ?? p.name, reason: 'Too many promotions in one order.' }); continue; }
    const res = simulate(p, lines, groups, itemDiscountUsed, discountCap, true);
    if (res.total <= 0) { rejected.push({ code: p.code ?? '', name: p.code ?? p.name, reason: 'This promotion does not reduce your total right now.' }); continue; }
    itemDiscountUsed += res.items;
    selected.push(p);
    applied.push({ promo: p, amount: res.total });
  }
  return { applied, rejected };
}

/** Compute (and when commit=true, record) the discount of one promotion on the remaining balances. */
function simulate(p: Promotion, lines: PromoLine[], groups: PromoGroup[], used: Cents, cap: Cents, commit = false): { total: Cents; items: Cents } {
  const funded = p.funded_by;
  const maxD = p.max_discount != null ? toCents(p.max_discount) : Infinity;
  const remaining = (l: PromoLine) => l.base - l.vendorDisc - l.platformDisc;
  const elig = lines.filter((l) => lineEligible(p, l.line) && remaining(l) > 0);
  const room = Math.max(0, cap - used);

  const spread = (amount: Cents, targets: PromoLine[]) => {
    const amt = Math.max(0, Math.min(amount, targets.reduce((s, l) => s + remaining(l), 0), maxD, room));
    if (amt <= 0) return 0;
    const parts = allocate(amt, targets.map(remaining));
    targets.forEach((l, i) => {
      const d = Math.min(parts[i], remaining(l));
      if (!commit) return;
      if (funded === 'vendor') l.vendorDisc += d; else l.platformDisc += d;
    });
    return amt;
  };
  const freeDelivery = (limit: Cents) => {
    let total = 0;
    for (const g of groups) {
      if (!g.platformDelivery || g.deliveryPayable <= 0) continue;
      if (p.vendor_id && g.vendorId !== p.vendor_id) continue;
      if (p.scope?.vendor_ids?.length && !p.scope.vendor_ids.includes(g.vendorId)) continue;
      const d = Math.min(g.deliveryPayable, limit - total);
      if (d <= 0) break;
      total += d;
      if (commit) {
        g.deliveryPayable -= d;
        if (funded === 'vendor') g.deliveryDiscVendor += d; else g.deliveryDiscPlatform += d;
      }
    }
    return total;
  };

  let items = 0, delivery = 0;
  const reward = (type: string, value: number) => {
    if (type === 'percent') items = spread(pctOf(elig.reduce((s, l) => s + remaining(l), 0), value), elig);
    else if (type === 'fixed') items = spread(toCents(value), elig);
    else if (type === 'free_delivery') delivery = freeDelivery(maxD);
  };
  switch (p.type) {
    case 'percent': reward('percent', p.value); break;
    case 'fixed': reward('fixed', p.value); break;
    case 'free_delivery': reward('free_delivery', 0); break;
    case 'first_order': reward(p.config.discount_type === 'fixed' ? 'fixed' : 'percent', p.value); break;
    case 'spend_get': {
      const spend = toCents(p.config.spend ?? 0);
      if (elig.reduce((s, l) => s + l.base, 0) >= spend) reward(p.config.reward?.type ?? 'fixed', Number(p.config.reward?.value ?? p.value));
      break;
    }
    case 'bogo': {
      const buy = Math.max(1, Number(p.config.buy_qty ?? 1)), get = Math.max(1, Number(p.config.get_qty ?? 1)), pct = Number(p.config.get_percent ?? 100);
      let amount = 0;
      const perLine: [PromoLine, Cents][] = [];
      for (const l of elig) {
        const freeUnits = Math.floor(l.line.qty / (buy + get)) * get;
        const d = Math.min(remaining(l), pctOf(freeUnits * l.line.unitPrice, pct));
        if (d > 0) { perLine.push([l, d]); amount += d; }
      }
      const amt = Math.min(amount, maxD, room);
      if (amt > 0) {
        const parts = allocate(amt, perLine.map(([, d]) => d));
        perLine.forEach(([l], i) => { if (commit) { if (funded === 'vendor') l.vendorDisc += parts[i]; else l.platformDisc += parts[i]; } });
        items = amt;
      }
      break;
    }
  }
  return { total: items + delivery, items };
}
