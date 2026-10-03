// Loads everything the pure quote function needs from the database.
import { query, one, pool, type Db } from '../db.js';
import { getSetting } from '../lib/settings.js';
import { geocode } from '../lib/geo.js';
import { toCents } from '../money.js';
import { AppError, badRequest } from '../errors.js';
import { computeQuote } from './quote.js';
import { userSegmentIds } from '../modules/segments.js';
import type { AddressPoint, Choice, QuoteInput, QuoteLine, Quote, VendorInfo, ZoneRow, Promotion } from './types.js';

export interface QuoteRequest {
  userId: string | null;
  items: { variantId: string; qty: number }[];
  addressId?: string | null;
  address?: { lat?: number; lng?: number; region?: string; postal_code?: string; country?: string; city?: string; line1?: string } | null;
  fulfillment?: Record<string, { mode: 'delivery' | 'pickup'; scheduledFor?: string | null }>;
  couponCodes?: string[];
  tipCents?: number;
  useCredit?: boolean;
  now?: Date;
}

let catCache: { at: number; parents: Map<string, string | null> } | null = null;
async function categoryAncestry(db: Db) {
  if (!catCache || Date.now() - catCache.at > 60000) {
    const rows = await query<{ id: string; parent_id: string | null }>('SELECT id, parent_id FROM categories', [], db);
    catCache = { at: Date.now(), parents: new Map(rows.map((r) => [r.id, r.parent_id])) };
  }
  return (cid: string | null): string[] => {
    const out: string[] = [];
    let cur = cid;
    while (cur && out.length < 6) { out.push(cur); cur = catCache!.parents.get(cur) ?? null; }
    return out;
  };
}
export const clearCategoryCache = () => { catCache = null; };

function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)!.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function makeIsOpenAt(tz: string, hours: any[], holidays: string[]) {
  return (d: Date) => {
    const p = localParts(d, tz);
    if (holidays.includes(p.day)) return { open: false, reason: 'holiday' };
    if (!hours.length) return { open: true };
    const h = hours.find((x) => x.weekday === p.weekday);
    if (!h || h.is_closed || !h.opens || !h.closes) return { open: false, reason: 'closed today' };
    const o = toMin(h.opens), c = toMin(h.closes);
    const inside = o <= c ? p.minutes >= o && p.minutes < c : p.minutes >= o || p.minutes < c;
    return inside ? { open: true } : { open: false, reason: `open ${h.opens.slice(0, 5)} to ${h.closes.slice(0, 5)}` };
  };
}

async function loadTax(db: Db) {
  const rows = await query<any>(`SELECT country, region, tax_class, rate FROM tax_rules WHERE active AND (valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date)`, [], db);
  const m = new Map<string, number>();
  for (const r of rows) { const k = `${r.country}:${r.region}:${r.tax_class}`; m.set(k, (m.get(k) ?? 0) + Number(r.rate)); }
  return (region: string | null, country: string, cls: string) => m.get(`${country}:${region}:${cls}`) ?? m.get(`${country}:*:${cls}`) ?? 0;
}

export async function resolveAddress(db: Db, req: QuoteRequest): Promise<{ point: AddressPoint | null; row: any | null }> {
  let row: any = null;
  if (req.addressId) {
    row = await one('SELECT * FROM addresses WHERE id = $1 AND deleted_at IS NULL', [req.addressId], db);
    if (!row || row.user_id !== req.userId) throw badRequest('ADDRESS_NOT_FOUND', 'We could not find that address.');
  } else if (req.address) {
    row = { ...req.address, country: req.address.country ?? 'CA' };
  }
  if (!row) return { point: null, row: null };
  let lat = row.lat, lng = row.lng;
  if (lat == null || lng == null) {
    const g = await geocode({ line1: row.line1, city: row.city, region: row.region, postal_code: row.postal_code, country: row.country });
    if (!g) throw badRequest('ADDRESS_NOT_LOCATED', 'We could not locate that address. Please check the postal code or choose a point on the map.');
    lat = g.lat; lng = g.lng;
    if (row.id) await query('UPDATE addresses SET lat=$2, lng=$3 WHERE id=$1', [row.id, lat, lng], db);
  }
  return { point: { lat, lng, region: row.region ?? '', postal_code: row.postal_code ?? '', country: row.country ?? 'CA' }, row: { ...row, lat, lng } };
}

export async function buildQuote(req: QuoteRequest, db: Db = pool): Promise<{ quote: Quote; input: QuoteInput; address: any | null }> {
  const now = req.now ?? new Date();
  if (!req.items.length) throw badRequest('EMPTY_CART', 'Your cart is empty.');
  const variantIds = req.items.map((i) => i.variantId);
  const rows = await query<any>(
    `SELECT v.id AS variant_id, v.name AS variant_name, v.sku, v.price, v.sale_price, v.is_active AS v_active, v.weight_grams AS v_weight, v.portions,
            p.id AS product_id, p.vendor_id, p.category_id, p.name, p.product_type, p.tax_class, p.weight_grams AS p_weight, p.prep_time_minutes,
            p.min_qty, p.max_qty, p.status, p.deleted_at, p.tracks_inventory, p.currency,
            i.on_hand, i.reserved,
            (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY position LIMIT 1) AS image_url
       FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN inventory i ON i.variant_id = v.id
      WHERE v.id = ANY($1::uuid[])`, [variantIds], db);
  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  const ancestry = await categoryAncestry(db);
  const lines: QuoteLine[] = [];
  for (const it of req.items) {
    const r = byId.get(it.variantId);
    if (!r) throw badRequest('PRODUCT_UNAVAILABLE', 'One of the items in your cart is no longer available.');
    const price = toCents(r.sale_price ?? r.price);
    lines.push({
      key: r.variant_id, variantId: r.variant_id, productId: r.product_id, vendorId: r.vendor_id, categoryIds: ancestry(r.category_id), productType: r.product_type,
      name: r.name, variantName: r.variant_name, sku: r.sku, imageUrl: r.image_url, unitPrice: price, listPrice: toCents(r.price), qty: it.qty, taxClass: r.tax_class,
      weightGrams: r.v_weight ?? r.p_weight ?? 0, portions: r.portions ?? 1, prepMinutes: r.prep_time_minutes, minQty: r.min_qty, maxQty: r.max_qty,
      available: r.tracks_inventory ? Math.max(0, (r.on_hand ?? 0) - (r.reserved ?? 0)) : null,
      active: r.v_active && r.status === 'active' && !r.deleted_at,
    });
  }

  const vendorIds = [...new Set(lines.map((l) => l.vendorId))];
  const [vrows, hours, holidays, zones, platformZones, feeRules, commissionRules, plans, taxRate, settings] = await Promise.all([
    query<any>('SELECT * FROM vendors WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [vendorIds], db),
    query<any>('SELECT * FROM vendor_hours WHERE vendor_id = ANY($1::uuid[])', [vendorIds], db),
    query<any>('SELECT vendor_id, to_char(day, \'YYYY-MM-DD\') AS day FROM vendor_holidays WHERE vendor_id = ANY($1::uuid[]) AND day >= current_date - 1', [vendorIds], db),
    query<any>(`SELECT * FROM delivery_zones WHERE scope = 'vendor' AND vendor_id = ANY($1::uuid[]) AND is_active`, [vendorIds], db),
    query<any>(`SELECT * FROM delivery_zones WHERE scope = 'platform' AND is_active`, [], db),
    query<any>('SELECT * FROM delivery_fee_rules WHERE is_active', [], db),
    query<any>('SELECT * FROM commission_rules WHERE is_active', [], db),
    query<any>(`SELECT vs.vendor_id, vp.commission_discount_pct FROM vendor_subscriptions vs JOIN vendor_plans vp ON vp.id = vs.plan_id WHERE vs.status = 'active' AND vs.current_period_end > now() AND vs.vendor_id = ANY($1::uuid[])`, [vendorIds], db),
    loadTax(db),
    Promise.all([getSetting('service_fee', db), getSetting('commission', db), getSetting('orders', db), getSetting('delivery', db), getSetting('promotions', db), getSetting('weather', db)]),
  ]);
  const [sf, cm, ord, del, promoSet, weather] = settings;
  const vendorCfg = await getSetting('vendors', db);
  const vendors = new Map<string, VendorInfo>();
  for (const v of vrows) {
    vendors.set(v.id, {
      id: v.id, name: v.trading_name, slug: v.slug, lat: v.lat, lng: v.lng, region: v.region, country: v.country,
      acceptsDelivery: v.accepts_delivery, acceptsPickup: v.accepts_pickup, usesOwnDrivers: v.uses_own_drivers, acceptingOrders: v.accepting_orders,
      approved: vendorCfg.approval_required ? v.verification_status === 'approved' : !['suspended', 'rejected'].includes(v.verification_status), minOrder: toCents(v.min_order), commissionOverridePct: v.commission_override_pct != null ? Number(v.commission_override_pct) : null,
      defaultPrep: v.default_prep_minutes, planDiscountPct: Number(plans.find((p) => p.vendor_id === v.id)?.commission_discount_pct ?? 0),
      isOpenAt: makeIsOpenAt(v.timezone, hours.filter((h) => h.vendor_id === v.id), holidays.filter((h) => h.vendor_id === v.id).map((h) => h.day)),
      zones: zones.filter((z) => z.vendor_id === v.id).map(normZone),
    });
  }
  for (const l of lines) if (!vendors.has(l.vendorId)) throw badRequest('PRODUCT_UNAVAILABLE', 'One of the items in your cart is no longer available.');

  const { point, row: addressRow } = await resolveAddress(db, req);

  // customer context
  let isFirstOrder = true; const redemptions = new Map<string, number>(); let creditBalance = 0; let segmentIds = new Set<string>();
  const coupons = (req.couponCodes ?? []).map((c) => c.trim()).filter(Boolean);
  const promoRows = await query<any>(
    `SELECT * FROM promotions WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= $1) AND (ends_at IS NULL OR ends_at > $1)
       AND (auto_apply OR code = ANY($2::citext[]))`, [now, coupons], db);
  // include expired coupons the user typed so they get a helpful message
  const typed = coupons.length ? await query<any>(`SELECT * FROM promotions WHERE code = ANY($1::citext[]) AND NOT (id = ANY($2::uuid[]))`, [coupons, promoRows.map((p) => p.id)], db) : [];
  if (req.userId) {
    isFirstOrder = !(await one(`SELECT 1 FROM orders WHERE user_id = $1 AND status NOT IN ('cancelled','pending_payment') LIMIT 1`, [req.userId], db));
    for (const r of await query<any>(`SELECT promotion_id, count(*)::int AS n FROM promotion_redemptions WHERE user_id = $1 AND status = 'active' GROUP BY 1`, [req.userId], db)) redemptions.set(r.promotion_id, r.n);
    creditBalance = toCents((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now() OR amount < 0)', [req.userId], db))?.b);
    segmentIds = await userSegmentIds(req.userId, [...promoRows, ...typed].map((p) => p.segment_id).filter(Boolean), db);
  }
  const demand = await one<any>(
    `SELECT (SELECT count(*) FROM delivery_jobs WHERE status IN ('awaiting_driver','offered','assigned','at_pickup'))::float AS jobs,
            (SELECT count(*) FROM driver_profiles WHERE availability = 'online' AND verification_status = 'approved')::float AS drivers`, [], db);

  const choices: Record<string, Choice> = {};
  for (const vid of vendorIds) {
    const c = req.fulfillment?.[vid];
    choices[vid] = { mode: c?.mode ?? 'delivery', scheduledFor: c?.scheduledFor ? new Date(c.scheduledFor) : null };
    if (c?.scheduledFor && Number.isNaN(choices[vid].scheduledFor!.getTime())) throw badRequest('BAD_SCHEDULE', 'Please choose a valid delivery time.');
  }
  const input: QuoteInput = {
    now, currency: 'CAD', lines, vendors, choices, address: point,
    promotions: [...promoRows, ...typed].map(normPromo), couponCodes: coupons,
    customer: { isFirstOrder, redemptions, segmentIds, creditBalance, useCredit: !!req.useCredit },
    tip: req.tipCents ?? 0, platformZones: platformZones.map(normZone),
    feeRules: feeRules.map((r) => ({ ...r, amount: r.amount != null ? Number(r.amount) : null, multiplier: r.multiplier != null ? Number(r.multiplier) : null })),
    commissionRules, taxRate, demandRatio: demand!.jobs / Math.max(1, demand!.drivers),
    settings: {
      service_fee: sf, commission: cm, orders: ord, delivery: del, promotions: promoSet, weather, dispatch_wait_minutes: 8,
    },
  };
  return { quote: computeQuote(input), input, address: addressRow };
}

const normZone = (z: any): ZoneRow => ({ ...z, radius_km: z.radius_km != null ? Number(z.radius_km) : null, base_fee: Number(z.base_fee), per_km_fee: Number(z.per_km_fee), free_over: z.free_over != null ? Number(z.free_over) : null, min_order: Number(z.min_order), max_distance_km: z.max_distance_km != null ? Number(z.max_distance_km) : null });
const normPromo = (p: any): Promotion => ({ ...p, value: Number(p.value), max_discount: p.max_discount != null ? Number(p.max_discount) : null, min_order: Number(p.min_order), scope: p.scope ?? {}, config: p.config ?? {} });

/** Serialize a quote for API responses (cents to dollars). */
export function quoteToJson(q: Quote) {
  const d = (c: number) => c / 100;
  return {
    currency: q.currency, canCheckout: q.canCheckout, blockers: q.blockers, warnings: q.warnings, rejectedCoupons: q.rejectedCoupons,
    appliedPromotions: q.appliedPromotions.map((p) => ({ ...p, amount: d(p.amount) })),
    totals: {
      subtotal: d(q.subtotal), vendorDiscount: d(q.vendorDiscount), platformDiscount: d(q.platformDiscount), discount: d(q.discountTotal), tax: d(q.tax),
      deliveryFee: d(q.deliveryFeePayable), deliveryFeeBeforeDiscounts: d(q.deliveryFee), serviceFee: d(q.serviceFee), tip: d(q.tip),
      total: d(q.total), creditApplied: d(q.creditApplied), amountDue: d(q.amountDue),
    },
    groups: q.groups.map((g) => ({
      vendorId: g.vendorId, vendorName: g.vendorName, vendorSlug: g.vendorSlug, fulfillment: g.fulfillmentType, mode: g.mode, scheduledFor: g.scheduledFor,
      etaAt: g.delivery.etaAt, delivery: { ...g.delivery }, prepMinutes: g.prepMinutes, minOrderShortfall: d(g.minOrderShortfall),
      lines: g.lines.map((l) => ({
        variantId: l.variantId, productId: l.productId, name: l.name, variantName: l.variantName, imageUrl: l.imageUrl, qty: l.qty, unitPrice: d(l.unitPrice), listPrice: d(l.listPrice),
        lineSubtotal: d(l.lineSubtotal), discount: d(l.discountVendor + l.discountPlatform), tax: d(l.tax), available: l.available,
      })),
      itemsSubtotal: d(g.itemsSubtotal), discount: d(g.vendorDiscount + g.platformDiscount), tax: d(g.tax), deliveryFee: d(g.deliveryFeePayable),
      deliveryFeeBeforeDiscounts: d(g.deliveryFee), serviceFee: d(g.serviceFee), tip: d(g.tip), customerTotal: d(g.customerTotal),
    })),
  };
}
export { AppError };
