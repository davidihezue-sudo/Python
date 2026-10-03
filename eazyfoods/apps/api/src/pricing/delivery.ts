// Delivery eligibility and fee engine: zones (radius, postal, polygon), distance pricing, free thresholds
// and admin configured surcharge / multiplier / discount rules.
import { haversineKm, pointInPolygon, roadKm, minutesFor } from '../lib/geo.js';
import { toCents, type Cents } from '../money.js';
import type { AddressPoint, FeeRule, QuoteInput, VendorInfo, ZoneRow } from './types.js';

export function zoneCovers(z: ZoneRow, vendor: VendorInfo, addr: AddressPoint): boolean {
  const pt = { lat: addr.lat, lng: addr.lng };
  switch (z.zone_type) {
    case 'radius': {
      const c = z.center_lat != null && z.center_lng != null ? { lat: z.center_lat, lng: z.center_lng } : vendor.lat != null && vendor.lng != null ? { lat: vendor.lat, lng: vendor.lng } : null;
      return !!c && z.radius_km != null && roadKm(c, pt) <= Number(z.radius_km);
    }
    case 'postal': {
      const pc = addr.postal_code.replace(/\s/g, '').toUpperCase();
      return z.postal_prefixes.some((p) => pc.startsWith(p.replace(/\s/g, '').toUpperCase()));
    }
    case 'polygon':
      return !!z.polygon && z.polygon.length >= 3 && pointInPolygon(pt, z.polygon);
  }
}

/** Vendor zones take precedence. If a vendor has no zones configured, platform zones apply. Returns covering zones in priority order. */
export function coveringZones(vendor: VendorInfo, platform: ZoneRow[], addr: AddressPoint): ZoneRow[] {
  const pool = vendor.zones.length ? vendor.zones : platform;
  return pool.filter((z) => zoneCovers(z, vendor, addr)).sort((a, b) => b.priority - a.priority || Number(a.base_fee) - Number(b.base_fee));
}
export const pickZone = (vendor: VendorInfo, platform: ZoneRow[], addr: AddressPoint): ZoneRow | null => coveringZones(vendor, platform, addr)[0] ?? null;

function minutesOfDay(d: Date, tz = 'America/Toronto') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')), weekday: wd };
}
const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

export interface FeeContext {
  distanceKm: number; itemsSubtotal: Cents; weightGrams: number; productTypes: string[];
  multiVendor: boolean; at: Date; demandRatio: number; weatherSevere: boolean;
}
export function ruleMatches(r: FeeRule, c: FeeContext): boolean {
  const k = r.conditions ?? {};
  if (k.distance_km_gte != null && c.distanceKm < k.distance_km_gte) return false;
  if (k.distance_km_lt != null && c.distanceKm >= k.distance_km_lt) return false;
  if (k.subtotal_gte != null && c.itemsSubtotal < toCents(k.subtotal_gte)) return false;
  if (k.subtotal_lt != null && c.itemsSubtotal >= toCents(k.subtotal_lt)) return false;
  if (k.weight_kg_gte != null && c.weightGrams < k.weight_kg_gte * 1000) return false;
  if (k.has_product_type && !c.productTypes.includes(k.has_product_type)) return false;
  if (k.multi_vendor != null && k.multi_vendor !== c.multiVendor) return false;
  if (k.demand_ratio_gte != null && c.demandRatio < k.demand_ratio_gte) return false;
  if (k.weather_severe != null && k.weather_severe !== c.weatherSevere) return false;
  if (k.hours || k.weekdays) {
    const { minutes, weekday } = minutesOfDay(c.at);
    if (k.weekdays && !k.weekdays.includes(weekday)) return false;
    if (k.hours) {
      const [s, e] = [hhmm(k.hours[0]), hhmm(k.hours[1])];
      const inside = s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
      if (!inside) return false;
    }
  }
  return true;
}

export function applyFeeRules(base: Cents, rules: FeeRule[], c: FeeContext): { fee: Cents; applied: string[] } {
  let fee = base;
  const applied: string[] = [];
  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    if (!ruleMatches(r, c)) continue;
    if (r.kind === 'multiplier' && r.multiplier) fee = Math.round(fee * Number(r.multiplier));
    else if (r.kind === 'surcharge' && r.amount) fee += toCents(r.amount);
    else if (r.kind === 'discount' && r.amount) fee = Math.max(0, fee - toCents(r.amount));
    else continue;
    applied.push(r.name);
  }
  return { fee: Math.max(0, fee), applied };
}

export interface DeliveryComputation {
  available: boolean; reason?: string; distanceKm: number | null; zone: ZoneRow | null;
  grossFee: Cents; freeByThreshold: boolean; freeFunder: 'vendor' | 'platform' | null; minutes: number | null; applied: string[];
}

/** Compute whether and at what price a vendor can deliver to the address. itemsSubtotal is after item discounts. */
export function computeDelivery(input: QuoteInput, vendor: VendorInfo, ownDelivery: boolean, ctx: Omit<FeeContext, 'distanceKm'>): DeliveryComputation {
  const none = (reason: string, distanceKm: number | null = null): DeliveryComputation =>
    ({ available: false, reason, distanceKm, zone: null, grossFee: 0, freeByThreshold: false, freeFunder: null, minutes: null, applied: [] });
  const addr = input.address;
  if (!addr) return none('Choose a delivery address to see delivery options.');
  if (!vendor.acceptsDelivery) return none('This store does not offer delivery.');
  if (vendor.lat == null || vendor.lng == null) return none('This store has no location configured yet.');
  const distanceKm = roadKm({ lat: vendor.lat, lng: vendor.lng }, { lat: addr.lat, lng: addr.lng });
  const covering = coveringZones(vendor, input.platformZones, addr);
  if (!covering.length) return none('This store does not deliver to your address.', distanceKm);
  // The first covering zone (by priority) whose distance limit accepts this address wins.
  const zone = covering.find((z) => distanceKm <= (z.max_distance_km != null ? Number(z.max_distance_km) : input.settings.delivery.max_distance_km));
  if (!zone) return none('Your address is outside this store\'s delivery range.', distanceKm);
  if (ctx.itemsSubtotal < toCents(zone.min_order)) return { ...none(`Delivery from this store needs a minimum of $${Number(zone.min_order).toFixed(2)}.`, distanceKm), zone };

  let fee = toCents(zone.base_fee) + (zone.fee_model === 'distance' ? Math.round(Number(zone.per_km_fee) * 100 * distanceKm) : 0);
  let applied: string[] = [];
  if (!ownDelivery) {
    const r = applyFeeRules(fee, input.feeRules, { ...ctx, distanceKm });
    fee = r.fee; applied = r.applied;
  }
  const freeByThreshold = zone.free_over != null && ctx.itemsSubtotal >= toCents(zone.free_over);
  const speed = input.settings.delivery.avg_speed_kmh.car ?? 30;
  return {
    available: true, distanceKm, zone, grossFee: fee, freeByThreshold,
    // A free-over threshold set on a vendor's own zone is paid by the vendor; on a platform zone by the platform.
    freeFunder: freeByThreshold ? (zone.scope === 'vendor' ? 'vendor' : 'platform') : null,
    minutes: minutesFor(distanceKm, speed), applied,
  };
}
