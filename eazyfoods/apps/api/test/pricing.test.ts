import { describe, it, expect } from 'vitest';
import { computeQuote } from '../src/pricing/quote.js';
import { applyPromotions } from '../src/pricing/promotions.js';
import { applyFeeRules, ruleMatches, zoneCovers, coveringZones } from '../src/pricing/delivery.js';
import { allocate, toCents, pctOf } from '../src/money.js';
import { SETTING_DEFS } from '../src/lib/settings.js';
import type { QuoteInput, QuoteLine, VendorInfo, Promotion, ZoneRow } from '../src/pricing/types.js';

const settings = (over: Partial<QuoteInput['settings']> = {}): QuoteInput['settings'] => ({
  service_fee: { percent: 3, min: 0.5, max: 6 }, commission: { percent: 12, fixed_fee: 0 },
  orders: { minimum_order: 0, schedule_min_lead_minutes: 30, schedule_max_days_ahead: 7, schedule_window_minutes: 60, tip_max_percent: 50, max_line_quantity: 50 },
  delivery: { max_distance_km: 25, avg_speed_kmh: { car: 30 }, vendor_prep_buffer_minutes: 5 } as any, promotions: { allow_stacking: true, max_stacked: 2, max_total_discount_pct: 70 }, weather: { severe: false }, dispatch_wait_minutes: 8, ...over,
});
const zone = (o: Partial<ZoneRow> = {}): ZoneRow => ({ id: 'z1', scope: 'platform', name: 'Core', zone_type: 'radius', center_lat: 43.65, center_lng: -79.38, radius_km: 30, postal_prefixes: [], polygon: null, fee_model: 'distance', base_fee: 3.99, per_km_fee: 0.5, free_over: null, min_order: 0, max_distance_km: 30, priority: 1, ...o });
const vendor = (id: string, o: Partial<VendorInfo> = {}): VendorInfo => ({ id, name: `Vendor ${id}`, slug: id, lat: 43.66, lng: -79.4, region: 'ON', country: 'CA', acceptsDelivery: true, acceptsPickup: true, usesOwnDrivers: false, acceptingOrders: true, approved: true, minOrder: 0, commissionOverridePct: null, defaultPrep: 15, planDiscountPct: 0, isOpenAt: () => ({ open: true }), zones: [], ...o });
const line = (variant: string, vendorId: string, price: number, qty = 1, o: Partial<QuoteLine> = {}): QuoteLine => ({ key: variant, variantId: variant, productId: 'p-' + variant, vendorId, categoryIds: ['c1'], productType: 'dry', name: 'Item ' + variant, variantName: null, sku: variant, imageUrl: null, unitPrice: toCents(price), listPrice: toCents(price), qty, taxClass: 'standard', weightGrams: 500, portions: 1, prepMinutes: null, minQty: 1, maxQty: null, available: 100, active: true, ...o });
const promo = (o: Partial<Promotion>): Promotion => ({ id: 'pr' + Math.random(), name: 'Promo', code: null, type: 'percent', value: 10, max_discount: null, min_order: 0, starts_at: null, ends_at: null, usage_limit: null, per_customer_limit: null, vendor_id: null, funded_by: 'platform', scope: {}, segment_id: null, stackable: false, stack_group: null, priority: 0, auto_apply: true, status: 'active', config: {}, redemption_count: 0, ...o });

function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    now: new Date('2026-03-10T15:00:00Z'), currency: 'CAD', lines: [line('a', 'v1', 20, 2)], vendors: new Map([['v1', vendor('v1')]]), choices: {}, address: { lat: 43.67, lng: -79.39, region: 'ON', postal_code: 'M4W 1A1', country: 'CA' },
    promotions: [], couponCodes: [], customer: { isFirstOrder: false, redemptions: new Map(), segmentIds: new Set(), creditBalance: 0, useCredit: false }, tip: 0, platformZones: [zone()], feeRules: [], commissionRules: [],
    taxRate: (region, _c, cls) => (region === 'ON' && cls !== 'zero_rated' ? 13 : 0), demandRatio: 0, settings: settings(), ...over,
  };
}

describe('money helpers', () => {
  it('allocates exactly with largest remainder', () => {
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(Math.random() * 6);
      const total = Math.floor(Math.random() * 100000);
      const weights = Array.from({ length: n }, () => Math.floor(Math.random() * 5000));
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
  it('rounds percentages half up and converts dollars safely', () => {
    expect(pctOf(1005, 13)).toBe(131);
    expect(toCents(0.07)).toBe(7);
    expect(toCents('12.35')).toBe(1235);
    expect(toCents(1.005)).toBe(101);
  });
});

describe('quote totals', () => {
  it('prices a single vendor delivery order with tax, delivery, service fee and commission', () => {
    const q = computeQuote(input());
    const g = q.groups[0];
    expect(g.itemsSubtotal).toBe(4000);
    expect(g.tax).toBe(520);                       // 13% of 40.00
    expect(g.deliveryFee).toBeGreaterThan(399);    // base fee plus distance
    expect(g.serviceFee).toBe(120);                // 3% of 40.00
    expect(g.commission).toBe(480);                // 12% of 40.00
    expect(g.vendorNet).toBe(4000 - 480);
    expect(q.total).toBe(g.itemsSubtotal + g.tax + g.deliveryFeePayable + g.serviceFee);
    expect(q.canCheckout).toBe(true);
  });

  it('clamps the service fee between the configured minimum and maximum', () => {
    expect(computeQuote(input({ lines: [line('a', 'v1', 5)] })).serviceFee).toBe(50);
    expect(computeQuote(input({ lines: [line('a', 'v1', 500)] })).serviceFee).toBe(600);
  });

  it('keeps vendor subtotals, taxes and fees exactly equal to the order totals across vendors', () => {
    const q = computeQuote(input({
      lines: [line('a', 'v1', 9.99, 3), line('b', 'v2', 4.37, 7), line('c', 'v3', 0.99, 11, { taxClass: 'zero_rated' })],
      vendors: new Map([['v1', vendor('v1')], ['v2', vendor('v2', { lat: 43.7, lng: -79.45 })], ['v3', vendor('v3', { lat: 43.62, lng: -79.35 })]]),
      promotions: [promo({ type: 'percent', value: 15, auto_apply: true })], tip: 500,
    }));
    const sum = (f: (g: any) => number) => q.groups.reduce((s, g) => s + f(g), 0);
    expect(q.groups).toHaveLength(3);
    expect(sum((g) => g.customerTotal)).toBe(q.total);
    expect(sum((g) => g.serviceFee)).toBe(q.serviceFee);
    expect(sum((g) => g.tip)).toBe(q.tip);
    expect(sum((g) => g.tax)).toBe(q.tax);
    for (const g of q.groups) expect(g.customerTotal).toBe(g.itemsSubtotal - g.vendorDiscount - g.platformDiscount + g.tax + g.deliveryFeePayable + g.serviceFee + g.tip);
  });

  it('applies zero rated tax to basic groceries and taxes prepared food by destination region', () => {
    const q = computeQuote(input({ lines: [line('a', 'v1', 10, 1, { taxClass: 'zero_rated' }), line('b', 'v1', 10, 1, { taxClass: 'prepared' })] }));
    expect(q.tax).toBe(130);
    const bc = computeQuote(input({ address: { lat: 43.67, lng: -79.39, region: 'BC', postal_code: 'V6B 1A1', country: 'CA' }, taxRate: (r, _c, cls) => (r === 'BC' && cls !== 'zero_rated' ? 12 : 0) }));
    expect(bc.tax).toBe(pctOf(4000, 12));
  });

  it('uses the vendor region for tax on pickup orders', () => {
    const q = computeQuote(input({ choices: { v1: { mode: 'pickup' } }, address: null }));
    expect(q.groups[0].deliveryFee).toBe(0);
    expect(q.groups[0].tax).toBe(520);
    expect(q.canCheckout).toBe(true);
  });

  it('blocks delivery without an address and reports unavailable stock and inactive products', () => {
    expect(computeQuote(input({ address: null })).blockers.map((b) => b.code)).toContain('DELIVERY_UNAVAILABLE');
    const stock = computeQuote(input({ lines: [line('a', 'v1', 10, 5, { available: 2 })] }));
    expect(stock.blockers[0].code).toBe('INSUFFICIENT_STOCK');
    expect(computeQuote(input({ lines: [line('a', 'v1', 10, 1, { active: false })] })).blockers[0].code).toBe('PRODUCT_UNAVAILABLE');
    expect(computeQuote(input({ lines: [line('a', 'v1', 10, 1, { available: 0 })] })).blockers[0].message).toContain('out of stock');
  });

  it('blocks closed, paused and unapproved vendors and enforces minimum orders and quantities', () => {
    expect(computeQuote(input({ vendors: new Map([['v1', vendor('v1', { isOpenAt: () => ({ open: false, reason: 'closed today' }) })]]) })).blockers[0].code).toBe('VENDOR_CLOSED');
    expect(computeQuote(input({ vendors: new Map([['v1', vendor('v1', { acceptingOrders: false })]]) })).blockers[0].code).toBe('VENDOR_PAUSED');
    expect(computeQuote(input({ vendors: new Map([['v1', vendor('v1', { approved: false })]]) })).blockers[0].code).toBe('VENDOR_UNAVAILABLE');
    const min = computeQuote(input({ vendors: new Map([['v1', vendor('v1', { minOrder: 10000 })]]) }));
    expect(min.blockers.find((b) => b.code === 'VENDOR_MIN_ORDER')?.message).toContain('Add $60.00');
    expect(computeQuote(input({ lines: [line('a', 'v1', 10, 2, { minQty: 3 })] })).blockers[0].code).toBe('BELOW_MIN_QTY');
    expect(computeQuote(input({ lines: [line('a', 'v1', 10, 9, { maxQty: 5 })] })).blockers[0].code).toBe('ABOVE_MAX_QTY');
  });

  it('validates scheduled delivery windows', () => {
    const now = new Date('2026-03-10T15:00:00Z');
    const tooSoon = computeQuote(input({ choices: { v1: { mode: 'delivery', scheduledFor: new Date(now.getTime() + 10 * 60000) } } }));
    expect(tooSoon.blockers.map((b) => b.code)).toContain('SCHEDULE_TOO_SOON');
    const tooFar = computeQuote(input({ choices: { v1: { mode: 'delivery', scheduledFor: new Date(now.getTime() + 20 * 86400000) } } }));
    expect(tooFar.blockers.map((b) => b.code)).toContain('SCHEDULE_TOO_FAR');
    const ok = computeQuote(input({ choices: { v1: { mode: 'delivery', scheduledFor: new Date(now.getTime() + 5 * 3600000) } } }));
    expect(ok.canCheckout).toBe(true);
    expect(ok.groups[0].scheduledFor).not.toBeNull();
  });

  it('handles tips: only with platform delivery, capped, allocated exactly', () => {
    const pick = computeQuote(input({ choices: { v1: { mode: 'pickup' } }, tip: 500 }));
    expect(pick.tip).toBe(0);
    expect(pick.warnings.map((w) => w.code)).toContain('TIP_DROPPED');
    const big = computeQuote(input({ tip: 1000000 }));
    expect(big.warnings.map((w) => w.code)).toContain('TIP_CAPPED');
    expect(big.tip).toBeLessThan(1000000);
    const multi = computeQuote(input({ lines: [line('a', 'v1', 10), line('b', 'v2', 10)], vendors: new Map([['v1', vendor('v1')], ['v2', vendor('v2')]]), tip: 501 }));
    expect(multi.groups.map((g) => g.tip).reduce((a, b) => a + b, 0)).toBe(501);
  });

  it('applies store credit but never more than the total', () => {
    const q = computeQuote(input({ customer: { isFirstOrder: false, redemptions: new Map(), segmentIds: new Set(), creditBalance: 999999, useCredit: true } }));
    expect(q.creditApplied).toBe(q.total);
    expect(q.amountDue).toBe(0);
    const part = computeQuote(input({ customer: { isFirstOrder: false, redemptions: new Map(), segmentIds: new Set(), creditBalance: 500, useCredit: true } }));
    expect(part.amountDue).toBe(part.total - 500);
  });
});

describe('commission resolution', () => {
  const base = (rules: any[] = [], v: Partial<VendorInfo> = {}) => computeQuote(input({ commissionRules: rules, vendors: new Map([['v1', vendor('v1', v)]]) })).groups[0];
  it('uses the default, then category, then vendor rules, then a vendor override', () => {
    expect(base().commissionRate).toBe(12);
    expect(base([{ id: 'c', scope: 'category', vendor_id: null, category_id: 'c1', percent: 15, fixed_fee: 0, valid_from: null, valid_to: null }]).commissionRate).toBe(15);
    expect(base([{ id: 'c', scope: 'category', vendor_id: null, category_id: 'c1', percent: 15, fixed_fee: 0, valid_from: null, valid_to: null }, { id: 'v', scope: 'vendor', vendor_id: 'v1', category_id: null, percent: 8, fixed_fee: 1, valid_from: null, valid_to: null }]).commissionRate).toBe(8);
    expect(base([], { commissionOverridePct: 5 }).commissionRate).toBe(5);
  });
  it('honours promotional windows and plan discounts and charges a fixed fee', () => {
    const past = { id: 'p', scope: 'global', vendor_id: null, category_id: null, percent: 3, fixed_fee: 0, valid_from: new Date('2020-01-01'), valid_to: new Date('2020-02-01') };
    expect(base([past]).commissionRate).toBe(12);
    const promoWindow = { ...past, valid_from: new Date('2026-03-01'), valid_to: new Date('2026-04-01') };
    expect(base([promoWindow]).commissionRate).toBe(3);
    expect(base([], { planDiscountPct: 4 }).commissionRate).toBe(8);
    const g = base([{ id: 'g', scope: 'global', vendor_id: null, category_id: null, percent: 10, fixed_fee: 0.5, valid_from: null, valid_to: null }]);
    expect(g.fixedFee).toBe(50);
    expect(g.vendorNet).toBe(4000 - 400 - 50);
  });
});

describe('delivery engine', () => {
  const addr = { lat: 43.67, lng: -79.39, region: 'ON', postal_code: 'M4W 1A1', country: 'CA' };
  it('prices flat and distance zones and honours free over thresholds', () => {
    const flat = computeQuote(input({ platformZones: [zone({ fee_model: 'flat', base_fee: 5, per_km_fee: 9 })] })).groups[0];
    expect(flat.deliveryFee).toBe(500);
    const free = computeQuote(input({ platformZones: [zone({ free_over: 30 })] })).groups[0];
    expect(free.deliveryFeePayable).toBe(0);
    expect(free.deliverySubsidyPlatform).toBeGreaterThan(0);
    const vendorZone = computeQuote(input({ vendors: new Map([['v1', vendor('v1', { zones: [zone({ scope: 'vendor', free_over: 30 })] })]]) })).groups[0];
    expect(vendorZone.deliveryFeePayable).toBe(0);
    expect(vendorZone.deliverySubsidyVendor).toBeGreaterThan(0);
    expect(vendorZone.vendorNet).toBe(4000 - 480 - vendorZone.deliverySubsidyVendor);
  });
  it('rejects addresses outside every zone or beyond the maximum distance', () => {
    const far = computeQuote(input({ address: { ...addr, lat: 45.5, lng: -73.6 } }));
    expect(far.groups[0].delivery.available).toBe(false);
    const tight = computeQuote(input({ platformZones: [zone({ max_distance_km: 0.1 })] }));
    expect(tight.groups[0].delivery.reason).toContain('outside');
  });
  it('supports postal and polygon zones and picks the first feasible zone by priority', () => {
    const v = vendor('v1');
    const postal = zone({ zone_type: 'postal', postal_prefixes: ['M4', 'M5'], radius_km: null });
    expect(zoneCovers(postal, v, addr)).toBe(true);
    expect(zoneCovers(postal, v, { ...addr, postal_code: 'L5B 1A1' })).toBe(false);
    const poly = zone({ zone_type: 'polygon', polygon: [[-79.5, 43.5], [-79.2, 43.5], [-79.2, 43.8], [-79.5, 43.8]] });
    expect(zoneCovers(poly, v, addr)).toBe(true);
    expect(zoneCovers(poly, v, { ...addr, lat: 44.5 })).toBe(false);
    const a = zone({ id: 'near', priority: 10, max_distance_km: 0.2 }), b = zone({ id: 'wide', priority: 1, max_distance_km: 40 });
    expect(coveringZones(v, [b, a], addr).map((z) => z.id)).toEqual(['near', 'wide']);
    expect(computeQuote(input({ platformZones: [a, b] })).groups[0].delivery.zoneId).toBe('wide');
  });
  it('applies surcharge, multiplier and discount rules from configuration', () => {
    const ctx = { distanceKm: 6, itemsSubtotal: 5000, weightGrams: 20000, productTypes: ['frozen'], multiVendor: true, at: new Date('2026-03-10T22:30:00Z'), demandRatio: 2.4, weatherSevere: false };
    const rules: any[] = [
      { id: '1', name: 'Dinner', kind: 'surcharge', amount: 1.5, multiplier: null, conditions: { hours: ['17:00', '20:00'] }, priority: 1 },
      { id: '2', name: 'Heavy', kind: 'surcharge', amount: 3, multiplier: null, conditions: { weight_kg_gte: 15 }, priority: 2 },
      { id: '3', name: 'Demand', kind: 'multiplier', amount: null, multiplier: 1.2, conditions: { demand_ratio_gte: 2 }, priority: 3 },
      { id: '4', name: 'Multi', kind: 'discount', amount: 1, multiplier: null, conditions: { multi_vendor: true }, priority: 4 },
      { id: '5', name: 'Weather', kind: 'surcharge', amount: 3, multiplier: null, conditions: { weather_severe: true }, priority: 5 },
    ];
    const r = applyFeeRules(500, rules, ctx);
    expect(r.applied).toEqual(['Dinner', 'Heavy', 'Demand', 'Multi']);
    expect(r.fee).toBe(Math.round((500 + 150 + 300) * 1.2) - 100);
    expect(ruleMatches(rules[4], { ...ctx, weatherSevere: true })).toBe(true);
    expect(ruleMatches(rules[0], { ...ctx, at: new Date('2026-03-10T15:00:00Z') })).toBe(false);
  });
  it('does not charge platform fee rules on vendor delivered orders', () => {
    const q = computeQuote(input({ vendors: new Map([['v1', vendor('v1', { usesOwnDrivers: true })]]), feeRules: [{ id: 'x', name: 'S', kind: 'surcharge', amount: 10, multiplier: null, conditions: {}, priority: 1 }] }));
    expect(q.groups[0].fulfillmentType).toBe('delivery_vendor');
    expect(q.groups[0].deliveryFee).toBeLessThan(1000);
  });
});

describe('promotion engine', () => {
  const run = (promos: Promotion[], over: Partial<QuoteInput> = {}) => computeQuote(input({ promotions: promos, ...over }));
  it('applies percent and fixed discounts with caps and minimum spend', () => {
    expect(run([promo({ type: 'percent', value: 10 })]).platformDiscount).toBe(400);
    expect(run([promo({ type: 'percent', value: 50, max_discount: 5 })]).platformDiscount).toBe(500);
    expect(run([promo({ type: 'fixed', value: 7 })]).platformDiscount).toBe(700);
    expect(run([promo({ type: 'fixed', value: 500 })]).platformDiscount).toBe(2800); // capped at 70% of the subtotal by the global guard rail
    const min = run([promo({ type: 'percent', value: 10, min_order: 100, code: 'BIG', auto_apply: false })], { couponCodes: ['BIG'] });
    expect(min.platformDiscount).toBe(0);
    expect(min.warnings.some((w) => w.message.includes('Spend at least $100.00'))).toBe(true);
  });
  it('requires coupons to be entered unless auto applied, and reports unknown codes', () => {
    const p = promo({ type: 'percent', value: 10, auto_apply: false, code: 'SAVE10' });
    expect(run([p]).platformDiscount).toBe(0);
    expect(run([p], { couponCodes: ['save10'] }).platformDiscount).toBe(400);
    const bad = run([p], { couponCodes: ['NOPE'] });
    expect(bad.rejectedCoupons[0].reason).toContain('not valid');
  });
  it('rejects expired, unstarted, exhausted and per customer limited promotions', () => {
    const now = new Date('2026-03-10T15:00:00Z');
    expect(run([promo({ ends_at: new Date(now.getTime() - 1000) })]).platformDiscount).toBe(0);
    expect(run([promo({ starts_at: new Date(now.getTime() + 1000) })]).platformDiscount).toBe(0);
    expect(run([promo({ usage_limit: 5, redemption_count: 5, code: 'X', auto_apply: false })], { couponCodes: ['X'] }).rejectedCoupons[0].reason).toContain('usage limit');
    const p = promo({ per_customer_limit: 1, code: 'ONCE', auto_apply: false });
    const used = run([p], { couponCodes: ['ONCE'], customer: { isFirstOrder: false, redemptions: new Map([[p.id, 1]]), segmentIds: new Set(), creditBalance: 0, useCredit: false } });
    expect(used.platformDiscount).toBe(0);
    expect(used.rejectedCoupons[0].reason).toContain('maximum number');
  });
  it('limits first order and segment promotions to the right customers', () => {
    const first = promo({ type: 'first_order', value: 20, config: { discount_type: 'percent' } });
    expect(run([first]).platformDiscount).toBe(0);
    expect(run([first], { customer: { isFirstOrder: true, redemptions: new Map(), segmentIds: new Set(), creditBalance: 0, useCredit: false } }).platformDiscount).toBe(800);
    const seg = promo({ segment_id: 's1' });
    expect(run([seg]).platformDiscount).toBe(0);
    expect(run([seg], { customer: { isFirstOrder: false, redemptions: new Map(), segmentIds: new Set(['s1']), creditBalance: 0, useCredit: false } }).platformDiscount).toBeGreaterThan(0);
  });
  it('targets eligible vendors, categories, products and product types only', () => {
    const lines = [line('a', 'v1', 10, 2), line('b', 'v2', 10, 2, { categoryIds: ['c2'], productType: 'frozen' })];
    const vendors = new Map([['v1', vendor('v1')], ['v2', vendor('v2')]]);
    const vOnly = run([promo({ value: 50, scope: { vendor_ids: ['v2'] } })], { lines, vendors });
    expect(vOnly.groups.find((g) => g.vendorId === 'v1')!.platformDiscount).toBe(0);
    expect(vOnly.groups.find((g) => g.vendorId === 'v2')!.platformDiscount).toBe(1000);
    expect(run([promo({ value: 50, scope: { category_ids: ['c2'] } })], { lines, vendors }).platformDiscount).toBe(1000);
    expect(run([promo({ value: 50, scope: { product_ids: ['p-a'] } })], { lines, vendors }).platformDiscount).toBe(1000);
    expect(run([promo({ value: 50, scope: { product_types: ['frozen'] } })], { lines, vendors }).platformDiscount).toBe(1000);
  });
  it('handles buy one get one, spend X get Y and free delivery', () => {
    const bogo = run([promo({ type: 'bogo', config: { buy_qty: 1, get_qty: 1, get_percent: 100 } })], { lines: [line('a', 'v1', 10, 4)] });
    expect(bogo.platformDiscount).toBe(2000);
    const bogo3 = run([promo({ type: 'bogo', config: { buy_qty: 2, get_qty: 1 } })], { lines: [line('a', 'v1', 10, 5)] });
    expect(bogo3.platformDiscount).toBe(1000);
    const spend = run([promo({ type: 'spend_get', config: { spend: 30, reward: { type: 'fixed', value: 5 } } })]);
    expect(spend.platformDiscount).toBe(500);
    expect(run([promo({ type: 'spend_get', config: { spend: 100, reward: { type: 'fixed', value: 5 } } })]).platformDiscount).toBe(0);
    const free = run([promo({ type: 'free_delivery' })]);
    expect(free.groups[0].deliveryFeePayable).toBe(0);
    expect(free.groups[0].deliverySubsidyPlatform).toBe(free.groups[0].deliveryFee);
  });
  it('funds vendor promotions from the vendor share and platform promotions from the platform', () => {
    const vp = run([promo({ funded_by: 'vendor', value: 10, vendor_id: 'v1' })]);
    expect(vp.groups[0].vendorDiscount).toBe(400);
    expect(vp.groups[0].platformDiscount).toBe(0);
    expect(vp.groups[0].commission).toBe(pctOf(3600, 12));        // commission is on the price after vendor funded discounts
    const pp = run([promo({ funded_by: 'platform', value: 10 })]);
    expect(pp.groups[0].platformDiscount).toBe(400);
    expect(pp.groups[0].commission).toBe(pctOf(4000, 12));        // vendor is made whole for platform promotions
  });
  it('prevents invalid combinations: non stackable promotions are exclusive and stack groups do not combine', () => {
    const a = promo({ name: 'A', value: 10, stackable: false }), b = promo({ name: 'B', value: 5, stackable: false });
    const q = run([a, b]);
    expect(q.appliedPromotions).toHaveLength(1);
    expect(q.appliedPromotions[0].name).toBe('A');
    const s1 = promo({ name: 'S1', value: 10, stackable: true, stack_group: 'item' }), s2 = promo({ name: 'S2', value: 5, stackable: true, stack_group: 'item' }), s3 = promo({ name: 'S3', type: 'free_delivery', stackable: true, stack_group: 'delivery' });
    const stacked = run([s1, s2, s3]);
    expect(stacked.appliedPromotions.map((p) => p.name).sort()).toEqual(['S1', 'S3']);
    expect(run([s1, s3], { settings: settings({ promotions: { allow_stacking: false, max_stacked: 2, max_total_discount_pct: 70 } }) }).appliedPromotions).toHaveLength(1);
  });
  it('never discounts more than the cap or below zero and keeps line discounts exact', () => {
    const q = run([promo({ type: 'fixed', value: 1000, stackable: true, stack_group: 'a' }), promo({ type: 'percent', value: 90, stackable: true, stack_group: 'b' })], { lines: [line('a', 'v1', 3.33, 3), line('b', 'v1', 7.01, 2)] });
    const g = q.groups[0];
    const lineDiscount = g.lines.reduce((s, l) => s + l.discountPlatform + l.discountVendor, 0);
    expect(lineDiscount).toBe(g.platformDiscount + g.vendorDiscount);
    expect(g.platformDiscount).toBeLessThanOrEqual(Math.floor(g.itemsSubtotal * 0.7));
    expect(g.lines.every((l) => l.lineSubtotal - l.discountPlatform - l.discountVendor >= 0)).toBe(true);
    expect(q.total).toBeGreaterThanOrEqual(0);
  });
});

describe('settings registry', () => {
  it('exposes the business rules that must not be hardcoded', () => {
    for (const key of ['commission', 'service_fee', 'delivery', 'driver_pay', 'dispatch', 'payouts', 'refunds', 'orders', 'promotions', 'vendors', 'tax', 'loyalty', 'abandoned_cart', 'fraud', 'inventory', 'payments', 'privacy']) {
      expect(SETTING_DEFS).toHaveProperty(key);
    }
  });
});
