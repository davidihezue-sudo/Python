// Admin configuration engine. Every business rule that might change lives here, with defaults in code
// and overrides in the app_settings table. Nothing below is hardcoded elsewhere.
import { query, one, type Db, pool } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export const SETTING_DEFS = {
  site: {
    group: 'Platform', label: 'Site',
    description: 'Brand, default currency and region.',
    default: { name: 'EAZyfoods', currency: 'CAD', default_region: 'ON', default_country: 'CA', support_email: 'support@eazyfoods.ca', timezone: 'America/Toronto' },
  },
  commission: {
    group: 'Fees', label: 'Default marketplace commission',
    description: 'Percent of vendor item sales (after vendor funded discounts) plus an optional fixed fee per suborder. Vendor and category rules override this.',
    default: { percent: 12, fixed_fee: 0 },
  },
  service_fee: {
    group: 'Fees', label: 'Customer service fee',
    description: 'Shown to customers as a separate line. Percent of item subtotal, clamped between min and max (dollars).',
    default: { percent: 3, min: 0.5, max: 6 },
  },
  orders: {
    group: 'Orders', label: 'Order rules',
    description: 'Minimums, reservation timeout, cancellation windows and scheduling.',
    default: { minimum_order: 0, reservation_ttl_minutes: 15, cancel_after_accept_minutes: 5, max_line_quantity: 50, schedule_min_lead_minutes: 30, schedule_max_days_ahead: 7, schedule_window_minutes: 60, tip_max_percent: 50, vendor_accept_timeout_minutes: 15, auto_complete_minutes: 0 },
  },
  inventory: {
    group: 'Orders', label: 'Inventory workflow',
    description: 'commit_stage: when reserved stock is committed (payment or vendor_accept).',
    default: { commit_stage: 'payment' },
  },
  payments: {
    group: 'Payments', label: 'Payment capture',
    description: 'capture_mode: automatic captures at checkout. on_acceptance authorizes first and captures when a vendor accepts.',
    default: { capture_mode: 'automatic' },
  },
  refunds: {
    group: 'Payments', label: 'Refund rules',
    description: 'window_days: how long after delivery customers can request refunds. default_bearer: who funds a refund (vendor or platform).',
    default: { window_days: 14, default_bearer: 'vendor', support_auto_limit: 25 },
  },
  payouts: {
    group: 'Payments', label: 'Payout schedule',
    description: 'Weekly cadence, a hold period after completion, and a minimum payout (dollars).',
    default: { frequency_days: 7, hold_days: 2, min_amount: 10 },
  },
  vendors: {
    group: 'Onboarding', label: 'Vendor onboarding',
    description: 'approval_required: unapproved vendors cannot sell. require_documents: required compliance documents must be verified before approval.',
    default: { approval_required: true, require_documents: true },
  },
  delivery: {
    group: 'Delivery', label: 'Delivery engine',
    description: 'Distance limits, vehicle speeds (km/h) used for ETAs, and proof of delivery requirements (pin, photo, gps, signature).',
    default: {
      max_distance_km: 25,
      avg_speed_kmh: { car: 30, van: 28, scooter: 25, ebike: 20, bike: 15 },
      proof_required: ['pin'], gps_radius_m: 250, pin_attempts: 5,
      tip_presets: [10, 15, 20], vendor_prep_buffer_minutes: 5,
    },
  },
  driver_pay: {
    group: 'Delivery', label: 'Driver compensation',
    description: 'Driver pay is separate from the fee customers pay. All amounts in dollars.',
    default: {
      base: 3.5, per_km: 0.7, per_minute: 0.2, min_guarantee: 5,
      peak_windows: [{ start: '11:30', end: '13:30', bonus: 1.5 }, { start: '17:00', end: '20:00', bonus: 2 }],
      surge: { enabled: true, threshold_ratio: 1.5, step: 0.25, max_multiplier: 2 },
      multi_order_bonus: 1.25, promo_bonus: 0, cancellation_compensation: 4,
    },
  },
  dispatch: {
    group: 'Delivery', label: 'Dispatch and batching',
    description: 'Driver eligibility, offer timing, scoring weights and batching constraints.',
    default: {
      offer_timeout_seconds: 45, max_pickup_km: 10, max_active_jobs: 3, location_fresh_minutes: 15,
      retry_seconds: 30, alert_after_minutes: 15,
      weights: { distance: 1, load: 2, acceptance: 3 },
      batching: { enabled: true, max_batch: 3, max_pickup_gap_km: 2, max_dropoff_gap_km: 4, max_detour_minutes: 15, max_ready_gap_minutes: 10, cold_max_minutes: 30 },
    },
  },
  privacy: {
    group: 'Delivery', label: 'Driver and customer privacy',
    description: 'Controls what drivers can see and for how long.',
    default: { driver_full_address_after_accept: true, hide_customer_after_complete: true, show_driver_location_to_customer: true },
  },
  promotions: {
    group: 'Marketing', label: 'Promotion rules',
    description: 'Global guard rails for stacking and the maximum share of a subtotal that discounts may remove.',
    default: { allow_stacking: true, max_stacked: 2, max_total_discount_pct: 70 },
  },
  loyalty: {
    group: 'Marketing', label: 'Loyalty and referrals',
    description: 'Points earn and redeem values, tiers (min lifetime points) and referral rewards in dollars of store credit.',
    default: {
      enabled: true, points_per_dollar: 1, redeem_points: 100, redeem_value: 1,
      tiers: [{ key: 'bronze', min_points: 0 }, { key: 'silver', min_points: 500 }, { key: 'gold', min_points: 2000 }],
      referral_reward: 10, referee_reward: 10, referral_min_order: 25,
    },
  },
  abandoned_cart: {
    group: 'Marketing', label: 'Abandoned cart reminders',
    description: 'Reminder timing and limits. Only customers who opted in to marketing receive promotional reminders.',
    default: { enabled: true, first_after_minutes: 60, max_reminders: 2, gap_hours: 24, promo_code: '' },
  },
  fraud: {
    group: 'Risk', label: 'Risk signal thresholds',
    description: 'Thresholds that raise a signal for human review. Nothing is automatically blocked.',
    default: { refunds_30d: 3, coupon_redemptions_7d: 5, cancellations_30d: 4, shared_phone_accounts: 2, driver_gps_mismatch_m: 1000 },
  },
  weather: {
    group: 'Delivery', label: 'Weather flag',
    description: 'Set severe=true to let delivery fee rules with weather conditions apply.',
    default: { severe: false },
  },
  tax: {
    group: 'Fees', label: 'Tax handling',
    description: 'marketplace_facilitator: the platform collects and remits tax collected on behalf of vendors.',
    default: { marketplace_facilitator: true },
  },
  compliance: {
    group: 'Onboarding', label: 'Compliance',
    description: 'Default jurisdiction used to look up required documents. Rules are managed as data.',
    default: { jurisdiction: 'CA-ON' },
  },
};

export type SettingKey = keyof typeof SETTING_DEFS;
type Defaults = { [K in SettingKey]: (typeof SETTING_DEFS)[K]['default'] };

const cache = new Map<string, { at: number; value: any }>();
const TTL = config.isTest ? 0 : 5000;

function merge(base: any, over: any): any {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out: any = { ...base };
  for (const k of Object.keys(over ?? {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export async function getSetting<K extends SettingKey>(key: K, db: Db = pool): Promise<Defaults[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const row = await one<{ value: any }>('SELECT value FROM app_settings WHERE key = $1', [key], db);
  const value = merge(SETTING_DEFS[key].default, row?.value ?? {});
  cache.set(key, { at: Date.now(), value });
  return value;
}

function shapeCheck(def: any, val: any, path: string) {
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) throw new AppError('INVALID_SETTING', 400, `${path} must be a list.`);
    return;
  }
  if (typeof def === 'object' && def !== null) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) throw new AppError('INVALID_SETTING', 400, `${path} must be an object.`);
    for (const k of Object.keys(val)) if (k in def) shapeCheck(def[k], val[k], `${path}.${k}`);
    return;
  }
  if (typeof def !== typeof val) throw new AppError('INVALID_SETTING', 400, `${path} must be a ${typeof def}.`);
  if (typeof val === 'number' && (!Number.isFinite(val) || val < 0)) throw new AppError('INVALID_SETTING', 400, `${path} must be zero or more.`);
}

export async function setSetting(key: SettingKey, value: any, userId: string | null, db: Db = pool) {
  if (!(key in SETTING_DEFS)) throw new AppError('NOT_FOUND', 404, 'Unknown setting.');
  shapeCheck(SETTING_DEFS[key].default, value, key);
  const before = await getSetting(key, db);
  const merged = merge(SETTING_DEFS[key].default, value);
  await query(
    `INSERT INTO app_settings(key, value, updated_by) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(merged), userId], db);
  cache.delete(key);
  return { before, after: merged };
}

export function clearSettingsCache() { cache.clear(); }

export async function listSettings() {
  const out: any[] = [];
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    out.push({ key, group: def.group, label: def.label, description: def.description, default: def.default, value: await getSetting(key as SettingKey) });
  }
  return out;
}
