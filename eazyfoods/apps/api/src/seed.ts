// Seeds a realistic demo marketplace. Orders are created by running the real checkout, vendor, dispatch and delivery
// services, then back dating timestamps, so ledgers, payouts, earnings and analytics are all consistent.
import { pool, query, one, tx } from './db.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { seedRbac, assignRole } from './lib/rbac.js';
import { createUser, saveAddress } from './modules/accounts.js';
import { createVendor, setHours, submitForReview, reviewVendor } from './modules/vendors.js';
import { applyDriver, submitDriver, reviewDriver } from './modules/drivers.js';
import { addDocument, reviewDocument, scanDocumentExpiry } from './modules/compliance.js';
import { createProduct } from './modules/catalog.js';
import { saveCategory } from './modules/catalog.js';
import { savePromotion, promotionInput, saveCampaign, saveAd, saveHomepageSection, saveArticle } from './modules/marketing.js';
import { checkout, quoteForUser, PaymentFailed } from './modules/orders/checkout.js';
import { acceptSuborder, startPreparing, markReady, collectPickup, vendorDeliveryStep, vendorCancel, customerCancel } from './modules/orders/fulfillment.js';
import { dispatchJob, acceptOffer, arrivedAtPickup, confirmPickup, startTransit, completeDelivery, updateDriverLocation } from './modules/deliveries.js';
import { refundSuborder } from './modules/orders/refunds.js';
import { createReview } from './modules/reviews.js';
import { openDispute, vendorRespondDispute, resolveDispute, createTicket } from './modules/support.js';
import { runPayoutCycle, processPayout, holdPayout } from './modules/payouts.js';
import { scanOrder, scanPlatform } from './modules/fraud.js';
import { saveRecipeSeed } from './seed/recipes.js';
import { runDueJobs } from './lib/jobs.js';
import { registerAllJobs } from './jobs-registry.js';
import { refreshPopularity } from './modules/recommendations.js';
import { ensureReferralCode } from './modules/loyalty.js';
import { rollupDay } from './modules/insights.js';
import { CATEGORIES, VENDORS, CUSTOMERS, DRIVERS, STAFF, TAX, type SeedVendor } from './seed/data.js';
import { SYSTEM, type Actor } from './lib/audit.js';
import { clearSettingsCache, setSetting } from './lib/settings.js';
import type { AuthCtx } from './lib/auth.js';

const log = (...a: any[]) => console.log('[seed]', ...a);
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261003);
const choice = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const PASSWORD = config.demoPassword;
const dayMs = 86400000;
const actorOf = (userId: string, role: string): Actor => ({ userId, role });

/** Today (or N days ago) at a given local hour, in the Toronto timezone, as a Date. */
function torontoTime(daysAgo: number, hour: number, minute = 0): Date {
  const base = new Date(Date.now() - daysAgo * dayMs);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(base);
  const probe = new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const offset = (new Date(probe.toLocaleString('en-US', { timeZone: 'America/Toronto' })).getTime() - new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime());
  return new Date(probe.getTime() - offset);
}

async function ledgerShift(c: any, interval: string, orderId: string) {
  await c.query('ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_no_update');
  await c.query(`UPDATE ledger_entries SET created_at = created_at - $2::interval WHERE order_id = $1 OR refund_id IN (SELECT id FROM refunds WHERE order_id = $1)`, [orderId, interval]);
  await c.query('ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_no_update');
}

/** Move every timestamp of an order back in time. Seed only. */
async function backdate(orderId: string, to: Date) {
  const placed = (await one<any>('SELECT placed_at FROM orders WHERE id = $1', [orderId]))!.placed_at as Date;
  const ms = placed.getTime() - to.getTime();
  if (ms <= 0) return;
  const iv = `${Math.round(ms / 1000)} seconds`;
  await tx(async (c) => {
    const subs = (await c.query('SELECT id FROM suborders WHERE order_id = $1', [orderId])).rows.map((r: any) => r.id);
    const jobs = (await c.query('SELECT id FROM delivery_jobs WHERE order_id = $1', [orderId])).rows.map((r: any) => r.id);
    const q = (sql: string, p: any[] = []) => c.query(sql, [orderId, iv, ...p]);
    await q(`UPDATE orders SET placed_at = placed_at - $2::interval, updated_at = updated_at - $2::interval, payment_deadline = payment_deadline - $2::interval WHERE id = $1`);
    await q(`UPDATE suborders SET created_at = created_at - $2::interval, updated_at = updated_at - $2::interval, accepted_at = accepted_at - $2::interval, ready_at = ready_at - $2::interval, picked_up_at = picked_up_at - $2::interval,
              delivered_at = delivered_at - $2::interval, completed_at = completed_at - $2::interval, cancelled_at = cancelled_at - $2::interval, estimated_ready_at = estimated_ready_at - $2::interval, promised_at = promised_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE payments SET created_at = created_at - $2::interval, authorized_at = authorized_at - $2::interval, captured_at = captured_at - $2::interval, voided_at = voided_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE payment_transactions SET created_at = created_at - $2::interval WHERE payment_id IN (SELECT id FROM payments WHERE order_id = $1)`);
    await q(`UPDATE refunds SET created_at = created_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE promotion_redemptions SET created_at = created_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE loyalty_ledger SET created_at = created_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE customer_credit_entries SET created_at = created_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE inventory_movements SET created_at = created_at - $2::interval WHERE ref_type = 'order' AND ref_id = $1::text`);
    await q(`UPDATE order_status_history SET at = at - $2::interval WHERE (entity_type = 'order' AND entity_id = $1) OR (entity_type = 'suborder' AND entity_id = ANY($3::uuid[])) OR (entity_type = 'delivery' AND entity_id = ANY($4::uuid[]))`, [subs, jobs]);
    await q(`UPDATE delivery_jobs SET created_at = created_at - $2::interval, updated_at = updated_at - $2::interval, ready_at = ready_at - $2::interval, assigned_at = assigned_at - $2::interval, picked_up_at = picked_up_at - $2::interval, delivered_at = delivered_at - $2::interval WHERE order_id = $1`);
    await q(`UPDATE delivery_offers SET offered_at = offered_at - $2::interval, expires_at = expires_at - $2::interval, responded_at = responded_at - $2::interval WHERE $1::uuid IS NOT NULL AND job_id = ANY($3::uuid[])`, [jobs]);
    await q(`UPDATE driver_earnings SET created_at = created_at - $2::interval WHERE $1::uuid IS NOT NULL AND job_id = ANY($3::uuid[])`, [jobs]);
    await q(`UPDATE driver_locations SET recorded_at = recorded_at - $2::interval WHERE $1::uuid IS NOT NULL AND delivery_job_id = ANY($3::uuid[])`, [jobs]);
    await q(`UPDATE notifications SET created_at = created_at - $2::interval, read_at = created_at - $2::interval + interval '2 minutes' WHERE data->>'orderId' = $1::text OR data->>'suborderId' = ANY(SELECT unnest($3::text[]))`, [subs.map(String)]);
    await q(`UPDATE analytics_events SET created_at = created_at - $2::interval WHERE entity_type = 'order' AND entity_id = $1::text`);
    await q(`UPDATE audit_logs SET created_at = created_at - $2::interval WHERE entity_id = $1::text OR entity_id = ANY($3::text[])`, [subs.map(String)]);
    await ledgerShift(c, iv, orderId);
  });
}

async function cleanup(label: string) {
  log(label);
}

export async function seed(opts: { force?: boolean; orders?: number } = {}) {
  registerAllJobs();
  await migrate();
  const existing = await one<any>('SELECT count(*)::int AS n FROM users');
  if (existing.n > 0 && !opts.force) { log('Database already has data. Run `npm run reset` to start over.'); return null; }
  const t0 = Date.now();
  await seedRbac();
  await setSetting('delivery', { proof_required: ['pin'] }, null);
  clearSettingsCache();

  // ---------- reference data ----------
  for (const t of TAX) for (const [name, rate] of t.rules) for (const cls of t.cls) await query(`INSERT INTO tax_rules(country, region, tax_class, name, rate) VALUES ('CA',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [t.region, cls, name, rate]);
  const rules: [string, string, string, string, boolean][] = [
    ['CA-ON', 'vendor', 'business_licence', 'Business licence', true], ['CA-ON', 'vendor', 'food_handler_certificate', 'Food handler certificate', true], ['CA-ON', 'vendor', 'insurance', 'Liability insurance', true], ['CA-ON', 'vendor', 'inspection_report', 'Public health inspection report', false],
    ['CA-ON', 'chef', 'food_handler_certificate', 'Food handler certificate', true], ['CA-ON', 'chef', 'kitchen_approval', 'Kitchen approval or permit', true], ['CA-ON', 'chef', 'insurance', 'Liability insurance', false],
    ['CA-ON', 'driver', 'drivers_licence', "Driver's licence", true], ['CA-ON', 'driver', 'vehicle_insurance', 'Vehicle insurance', true], ['CA-ON', 'driver', 'vehicle_registration', 'Vehicle registration', true], ['CA-ON', 'driver', 'background_check', 'Background check', false],
    ['*', 'vendor', 'business_licence', 'Business licence', true], ['*', 'chef', 'food_handler_certificate', 'Food handler certificate', true], ['*', 'driver', 'drivers_licence', "Driver's licence", true],
  ];
  for (const [j, a, d, l, r] of rules) await query('INSERT INTO compliance_rules(jurisdiction, applies_to, doc_type, label, required) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [j, a, d, l, r]);
  for (const [k, l, m] of [['homepage_hero', 'Homepage hero', 1], ['homepage_banner', 'Homepage banner', 2], ['category_banner', 'Category banner', 1], ['search_results', 'Search results sponsored slot', 2], ['product_recommendations', 'Product recommendations', 3], ['vendor_page', 'Vendor page', 1], ['checkout', 'Checkout', 1], ['recipe_pages', 'Recipe pages', 2]] as const)
    await query('INSERT INTO ad_placements(key, label, max_slots) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [k, l, m]);
  for (const [k, n, p, d] of [['starter', 'Starter', 0, 0], ['growth', 'Growth', 49, 2], ['premium', 'Premium', 129, 4]] as const)
    await query('INSERT INTO vendor_plans(key, name, monthly_price, commission_discount_pct, features) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [k, n, p, d, JSON.stringify(k === 'starter' ? { analytics: 'basic' } : { analytics: 'premium', featured_listing: k === 'premium' })]);
  for (const [t, s] of [['garri', ['gari', 'cassava flour']], ['jollof', ['jolof', 'jellof']], ['okra', ['okro', 'ila']], ['plantain', ['dodo', 'plantains']], ['egusi', ['melon seeds', 'egushi']], ['suya', ['kilishi', 'yaji']], ['ayamase', ['designer stew']], ['injera', ['enjera']], ['yam', ['isu']], ['jerk', ['jamaican bbq']], ['coffee', ['buna']]] as const)
    await query('INSERT INTO search_synonyms(term, synonyms) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t, s]);

  // ---------- accounts ----------
  const staff: Record<string, string> = {};
  for (const s of STAFF) { const u = await createUser({ email: s.email, password: PASSWORD, full_name: s.name }, s.role, SYSTEM); staff[s.role] = u.id; }
  const admin = actorOf(staff.super_admin, 'super_admin');
  const customers: { id: string; name: string; email: string; addressId: string }[] = [];
  for (const c of CUSTOMERS) {
    const u = await createUser({ email: c.email, password: PASSWORD, full_name: c.name, phone: c.phone, marketing_opt_in: c.marketing }, 'customer', SYSTEM);
    await ensureReferralCode(u.id);
    const a = await saveAddress(u.id, { label: 'Home', recipient_name: c.name, line1: c.line1, city: c.city, region: 'ON', postal_code: c.postal, instructions: 'Please call from the app on arrival.' });
    customers.push({ id: u.id, name: c.name, email: c.email, addressId: a.id });
  }
  await saveAddress(customers[0].id, { label: 'Work', line1: '100 King Street West', city: 'Toronto', region: 'ON', postal_code: 'M5H 1J9' });

  // ---------- categories ----------
  const catIds: Record<string, string> = {};
  for (const c of CATEGORIES.filter((x) => !x.parent)) catIds[c.slug] = (await saveCategory({ name: c.name, description: c.desc, image_url: `/img/food/${c.img}.svg` }, admin)).id;
  for (const c of CATEGORIES.filter((x) => x.parent)) catIds[c.slug] = (await saveCategory({ name: c.name, parent_id: catIds[c.parent!], description: c.desc, image_url: `/img/food/${c.img}.svg` }, admin)).id;
  await query(`UPDATE categories SET slug = $2 WHERE id = $1`, [catIds['pantry'], 'pantry']);
  for (const c of CATEGORIES) await query('UPDATE categories SET slug = $2 WHERE id = $1', [catIds[c.slug], c.slug]);

  // ---------- platform delivery zones, fee rules, commission ----------
  await query(`INSERT INTO delivery_zones(scope, name, zone_type, center_lat, center_lng, radius_km, fee_model, base_fee, per_km_fee, free_over, min_order, max_distance_km, priority) VALUES
    ('platform','Toronto core','radius',43.6532,-79.3832,18,'distance',3.99,0.60,75,0,22,10),
    ('platform','Greater Toronto Area','radius',43.7000,-79.5000,45,'distance',5.99,0.80,95,0,45,5)`);
  await query(`INSERT INTO delivery_fee_rules(name, kind, amount, multiplier, conditions, priority) VALUES
    ('Dinner rush surcharge','surcharge',1.50,NULL,'{"hours":["17:00","20:00"]}',10),
    ('Heavy order surcharge','surcharge',3.00,NULL,'{"weight_kg_gte":15}',20),
    ('Cold chain handling','surcharge',1.50,NULL,'{"has_product_type":"frozen"}',30),
    ('Multi store order discount','discount',1.00,NULL,'{"multi_vendor":true}',40),
    ('High demand pricing','multiplier',NULL,1.20,'{"demand_ratio_gte":2}',50)`);
  await query(`INSERT INTO delivery_fee_rules(name, kind, amount, conditions, priority, is_active) VALUES ('Severe weather surcharge','surcharge',3.00,'{"weather_severe":true}',60,true)`);
  await query(`INSERT INTO commission_rules(name, scope, percent, fixed_fee) VALUES ('Marketplace default','global',12,0)`);
  await query(`INSERT INTO commission_rules(name, scope, category_id, percent) VALUES ('Prepared meals','category',$1,15)`, [catIds['prepared-meals']]);

  // ---------- drivers ----------
  const drivers: { id: string; name: string; base: { lat: number; lng: number }; online: boolean; status: string }[] = [];
  for (const d of DRIVERS) {
    const u = await createUser({ email: d.email, password: PASSWORD, full_name: d.name, phone: d.phone }, 'customer', SYSTEM);
    await applyDriver(u.id, { legal_name: d.name, phone: d.phone, city: 'Toronto', region: 'ON', postal_code: 'M5V 2T6', licence_number: 'D' + String(between(1000000, 9999999)), licence_expiry: '2029-06-30', vehicle: { vehicle_type: d.vehicle, make: d.make, model: d.model, plate: d.plate, year: 2020, has_cold_storage: d.cold, insurance_expiry: '2027-03-31' } }, SYSTEM);
    for (const [type, exp] of [['drivers_licence', '2029-06-30'], ['vehicle_insurance', d.name === 'Emeka Nwosu' ? new Date(Date.now() + 18 * dayMs).toISOString().slice(0, 10) : '2027-03-31'], ['vehicle_registration', '2027-08-31']] as const) {
      if (d.vehicle === 'ebike' && type !== 'drivers_licence') { /* e-bike riders do not need vehicle registration */ }
      const doc = await addDocument({ ownerType: 'driver', ownerId: u.id, docType: type, reference: 'DOC-' + between(10000, 99999), issueDate: '2024-01-15', expiryDate: exp }, SYSTEM);
      if (d.status !== 'submitted') await reviewDocument(doc.id, 'verified', undefined, admin);
    }
    if (d.status !== 'draft') await submitDriver(u.id, { userId: u.id, role: 'driver' });
    if (d.status === 'approved') { await reviewDriver(u.id, 'start_review', undefined, admin); await reviewDriver(u.id, 'approve', undefined, admin); }
    if (d.status === 'suspended') { await reviewDriver(u.id, 'start_review', undefined, admin); await reviewDriver(u.id, 'approve', undefined, admin); await reviewDriver(u.id, 'suspend', 'Repeated late deliveries pending review', admin); }
    await query('UPDATE driver_profiles SET rating_avg = $2, rating_count = $3 WHERE user_id = $1', [u.id, d.status === 'approved' ? (4.5 + rand() * 0.5).toFixed(2) : 0, d.status === 'approved' ? between(12, 80) : 0]);
    if (d.online) { await query("UPDATE driver_profiles SET availability = 'online' WHERE user_id = $1", [u.id]); }
    await updateDriverLocation(u.id, d.lat, d.lng);
    await query("UPDATE driver_profiles SET payout_account_ref = $2 WHERE user_id = $1", [u.id, `acct_demo_${u.id.slice(0, 8)}`]);
    drivers.push({ id: u.id, name: d.name, base: { lat: d.lat, lng: d.lng }, online: d.online, status: d.status });
  }

  // ---------- vendors, chefs, catalog ----------
  const vend: Record<string, { id: string; userId: string; v: SeedVendor; products: Record<string, { id: string; variants: { id: string; name: string; price: number }[] }> }> = {};
  for (const sv of VENDORS) {
    const owner = await createUser({ email: `owner+${sv.key}@demo.eazyfoods.test`, password: PASSWORD, full_name: sv.owner, phone: sv.phone }, 'customer', SYSTEM);
    const actor = actorOf(owner.id, sv.type === 'chef' ? 'chef' : 'vendor');
    const v = await createVendor(owner.id, {
      seller_type: sv.type, legal_name: sv.legal, trading_name: sv.trading, description: sv.desc, email: sv.email, phone: sv.phone, owner_name: sv.owner, tax_number: 'RT' + between(100000000, 999999999),
      line1: sv.line1, city: sv.city, region: sv.region, postal_code: sv.postal, cuisines: sv.cuisines, accepts_delivery: true, accepts_pickup: sv.pickup ?? true, uses_own_drivers: sv.key === 'sahel',
      chef: sv.chef ? { display_name: sv.chef.display, bio: sv.chef.bio, specialties: sv.chef.specialties, daily_capacity: sv.chef.daily, hourly_capacity: sv.chef.hourly } : undefined,
    }, actor);
    await query('UPDATE vendors SET default_prep_minutes = $2, min_order = $3, logo_url = $4, cover_url = $5, commission_override_pct = $6, bank_account_last4 = $7, payout_account_ref = $8 WHERE id = $1',
      [v.id, sv.prep, sv.minOrder, `/img/brand/${sv.logo ?? 'logo-default'}.svg`, `/img/food/${sv.cover ?? 'cover-market'}.svg`, sv.commission ?? null, String(between(1000, 9999)), `acct_demo_${v.id.slice(0, 8)}`]);
    if (sv.chef) await query('UPDATE chefs SET operating_days = $2 WHERE vendor_id = $1', [v.id, sv.chef.days]);
    const open = sv.hours ?? ['11:00', '21:00'];
    await setHours(v.id, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opens: open[0], closes: open[1], is_closed: sv.type === 'chef' && sv.chef ? !sv.chef.days.includes(d) : d === 0 && sv.key === 'island' })), actor);
    if (sv.status !== 'draft') {
      const reqs = sv.type === 'chef' ? ['food_handler_certificate', 'kitchen_approval'] : ['business_licence', 'food_handler_certificate', 'insurance'];
      for (const type of reqs) {
        const expiry = sv.key === 'nkechi' && type === 'food_handler_certificate' ? new Date(Date.now() + 25 * dayMs).toISOString().slice(0, 10) : '2027-' + String(between(1, 12)).padStart(2, '0') + '-28';
        const doc = await addDocument({ ownerType: 'vendor', ownerId: v.id, docType: type, reference: 'REF-' + between(100000, 999999), issueDate: '2025-01-10', expiryDate: expiry }, actor);
        if (sv.status !== 'submitted') await reviewDocument(doc.id, 'verified', undefined, admin);
      }
      await submitForReview(v.id, actor);
      if (sv.status === 'approved' || sv.status === 'suspended') { await reviewVendor(v.id, 'start_review', undefined, admin); await reviewVendor(v.id, 'approve', undefined, admin); }
      if (sv.status === 'suspended') await reviewVendor(v.id, 'suspend', 'Food safety inspection follow up in progress', admin);
    }
    if (sv.key === 'sahel') await query(`INSERT INTO delivery_zones(scope, vendor_id, name, zone_type, center_lat, center_lng, radius_km, fee_model, base_fee, per_km_fee, free_over, min_order, max_distance_km) VALUES ('vendor',$1,'Sahel own delivery','radius',43.5931,-79.6413,25,'flat',6.99,0,80,25,25)`, [v.id]);
    if (sv.key === 'lagos') await query(`INSERT INTO delivery_zones(scope, vendor_id, name, zone_type, postal_prefixes, fee_model, base_fee, per_km_fee, free_over, min_order, priority) VALUES ('vendor',$1,'Downtown and west end','postal',$2,'distance',3.49,0.50,60,20,10)`, [v.id, ['M5', 'M6', 'M4', 'M8', 'M9', 'M3', 'M2']]);
    const entry = { id: v.id, userId: owner.id, v: sv, products: {} as any };
    vend[sv.key] = entry;
    for (const p of sv.products) {
      const prepared = p.type === 'prepared' || p.type === 'chef_meal';
      const created = await createProduct(v.id, {
        name: p.name, short_description: p.desc.split('. ')[0], description: p.desc, product_type: p.type, category_id: catIds[p.cat], brand: p.brand, country_of_origin: p.country, cuisine: p.cuisine,
        tags: p.tags ?? [], unit: p.unit ?? 'each', weight_grams: p.weight, tax_class: p.tax ?? 'standard', prep_time_minutes: p.prep ?? (prepared ? 30 : undefined), shelf_life_days: p.shelf, storage_instructions: p.storage,
        ingredients_text: p.ingredients, allergens: p.allergens ?? [], dietary: p.dietary ?? [], tracks_inventory: !prepared, daily_capacity: p.cap ?? null, status: sv.status === 'approved' || sv.status === 'suspended' ? 'active' : 'draft',
        images: [{ url: `/img/food/${p.img}.svg`, alt: p.name }],
        variants: p.variants.map(([name, price, stock, sale], i) => ({ name, price, sale_price: sale ?? null, stock, portions: prepared ? Math.max(1, /Family|serves 4/i.test(name) ? 4 : /Party|serves 8|serves 10/i.test(name) ? 8 : /serves 20/i.test(name) ? 20 : /10 skewers|30 pieces/i.test(name) ? 2 : 1) : 1, is_default: i === 0, reorder_threshold: prepared ? 0 : 6, barcode: !prepared ? String(6290000000000 + between(10000000, 99999999)) : undefined, weight_grams: p.weight })),
      }, actor);
      const vs = await query<any>('SELECT id, name, price FROM product_variants WHERE product_id = $1 ORDER BY position', [created.id]);
      entry.products[p.name] = { id: created.id, variants: vs.map((x: any) => ({ id: x.id, name: x.name, price: Number(x.price) })) };
      if (p.popular) await query('UPDATE products SET popularity = $2 WHERE id = $1', [created.id, p.popular]);
    }
  }
  // Realistic stock situations for the vendor dashboards
  await query(`UPDATE inventory SET on_hand = 3 WHERE variant_id IN (SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name = 'Ofada Rice' AND v.name = '10 kg')`);
  await query(`UPDATE inventory SET on_hand = 0 WHERE variant_id IN (SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name = 'Frozen Bitterleaf (Washed)')`);
  await query(`UPDATE inventory SET on_hand = 4 WHERE variant_id IN (SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.name = 'Fresh Injera')`);
  await saveRecipeSeed(vend);
  await query("INSERT INTO vendor_subscriptions(vendor_id, plan_id, current_period_end) SELECT $1, id, now() + interval '20 days' FROM vendor_plans WHERE key = 'growth'", [vend.nkechi.id]);

  // ---------- marketing content ----------
  const marketing = actorOf(staff.marketing_manager, 'marketing_manager');
  const segs: Record<string, string> = {};
  for (const [k, name, rule] of [
    ['new', 'New customers (no orders yet)', { type: 'new_customers' }], ['lapsed', 'Lapsed customers (45 days)', { type: 'lapsed', days: 45 }], ['value', 'High value (90 days)', { type: 'high_value', days: 90, min_spend: 200 }],
    ['prepared', 'Prepared meal lovers', { type: 'interest_prepared', min_orders: 2 }], ['grocery', 'Grocery regulars', { type: 'interest_groceries', min_orders: 2 }], ['freq', 'High frequency (30 days)', { type: 'high_frequency', days: 30, min_orders: 3 }],
  ] as const) segs[k] = (await one<any>('INSERT INTO segments(name, rule, created_by) VALUES ($1,$2,$3) RETURNING id', [name, JSON.stringify(rule), staff.marketing_manager]))!.id;
  const now = Date.now();
  const promo = async (p: any, vendorId?: string) => savePromotion(promotionInput.parse(p), { vendorId }, marketing);
  const welcome = await promo({ name: 'Welcome: 10% off your first order', code: 'WELCOME10', type: 'first_order', value: 10, max_discount: 15, min_order: 20, per_customer_limit: 1, funded_by: 'platform', stackable: true, stack_group: 'item', status: 'active', config: { discount_type: 'percent' }, starts_at: new Date(now - 60 * dayMs) });
  await promo({ name: 'Free delivery over $35', code: 'FREESHIP35', type: 'free_delivery', min_order: 35, funded_by: 'platform', stackable: true, stack_group: 'delivery', status: 'active', max_discount: 8, starts_at: new Date(now - 30 * dayMs), ends_at: new Date(now + 60 * dayMs) });
  await promo({ name: '$5 off a $40 spice haul', code: 'SPICE5', type: 'spend_get', min_order: 40, status: 'active', config: { spend: 40, reward: { type: 'fixed', value: 5 } }, scope: { category_ids: [catIds['spices-seasonings']] }, funded_by: 'platform', starts_at: new Date(now - 20 * dayMs), usage_limit: 500 });
  const summer = await promo({ name: 'Summer cookout 20% off proteins', code: 'COOKOUT20', type: 'percent', value: 20, max_discount: 25, min_order: 30, status: 'active', scope: { category_ids: [catIds['meat-poultry'], catIds['fish-seafood']] }, starts_at: new Date(now - 50 * dayMs), ends_at: new Date(now - 10 * dayMs), funded_by: 'platform' });
  await promo({ name: 'Comeback: 15% off for lapsed customers', code: 'COMEBACK15', type: 'percent', value: 15, max_discount: 20, min_order: 25, status: 'active', segment_id: segs.lapsed, starts_at: new Date(now - 5 * dayMs), funded_by: 'platform' });
  await promo({ name: 'Flash Friday: 25% off prepared meals', code: 'FLASHFRI', type: 'percent', value: 25, max_discount: 20, min_order: 20, status: 'active', scope: { product_types: ['prepared', 'chef_meal'] }, starts_at: new Date(now + 3 * dayMs), ends_at: new Date(now + 3 * dayMs + 6 * 3600000), funded_by: 'platform' });
  await promo({ name: 'Garri: buy 2 get 1 free', code: 'GARRI3', type: 'bogo', status: 'active', config: { buy_qty: 2, get_qty: 1, get_percent: 100 }, scope: { vendor_ids: [vend.nkechi.id] }, funded_by: 'vendor', starts_at: new Date(now - 10 * dayMs) }, vend.nkechi.id);
  await promo({ name: 'Mama Nkechi: 5% off orders over $50', code: 'NKECHI5', type: 'percent', value: 5, min_order: 50, status: 'active', starts_at: new Date(now - 10 * dayMs) }, vend.nkechi.id);

  const campaign = await saveCampaign({ name: 'Taste of Lagos Week', description: 'A week celebrating Nigerian food: jollof, suya and soups with free delivery over $35.', starts_at: new Date(now - 4 * dayMs), ends_at: new Date(now + 3 * dayMs), segment_id: null, promotion_id: (await one<any>("SELECT id FROM promotions WHERE code = 'FREESHIP35'"))!.id, landing_slug: 'taste-of-lagos-week', tracking: { utm_source: 'eazy', utm_campaign: 'lagos_week' }, status: 'active' }, undefined, marketing);
  await saveCampaign({ name: 'Cookout season', description: 'Summer grilling proteins.', starts_at: new Date(now - 50 * dayMs), ends_at: new Date(now - 10 * dayMs), promotion_id: summer.id, status: 'ended' }, undefined, marketing);
  await saveAd({ placement_key: 'homepage_hero', campaign_id: campaign.id, title: 'Taste of Lagos Week', subtitle: 'Party jollof, suya and soups from Toronto kitchens. Free delivery over $35.', image_url: '/img/food/hero-lagos.svg', cta_label: 'Shop the week', click_url: '/c/taste-of-lagos-week', status: 'active', cost_model: 'flat' }, undefined, marketing);
  await saveAd({ placement_key: 'homepage_banner', title: 'Cook with the cooks who know it', subtitle: 'Meet the independent chefs on EAZyfoods.', image_url: '/img/food/hero-chefs.svg', cta_label: 'Meet the chefs', click_url: '/chefs', status: 'active' }, undefined, marketing);
  await saveAd({ placement_key: 'homepage_banner', advertiser_type: 'vendor', advertiser_vendor_id: vend.sahel.id, advertiser_name: 'Sahel Specialty Foods', title: 'Fresh injera, baked daily', subtitle: 'Sponsored by Sahel Specialty Foods.', image_url: '/img/food/hero-spice.svg', cta_label: 'Shop now', click_url: '/stores/sahel-specialty-foods', status: 'active', cost_model: 'cpc', rate: 0.35, budget: 150 }, undefined, marketing);
  await saveAd({ placement_key: 'search_results', advertiser_type: 'vendor', advertiser_vendor_id: vend.nkechi.id, advertiser_name: 'Mama Nkechi African Market', title: 'Stock the pantry: rice, garri and palm oil', image_url: '/img/food/grains.svg', cta_label: 'Shop pantry', click_url: '/c/pantry', status: 'active', cost_model: 'cpc', rate: 0.25, budget: 100 }, undefined, marketing);
  await saveAd({ placement_key: 'checkout', title: 'Add a bag of plantain chips', subtitle: 'The snack that never makes it home.', image_url: '/img/food/snacks.svg', cta_label: 'See snacks', click_url: '/c/snacks', status: 'active' }, undefined, marketing);

  const collections: Record<string, string> = {};
  for (const [slug, title, desc, names] of [
    ['jollof-essentials', 'Jollof essentials', 'Everything for a pot of party jollof.', ['Long Grain Parboiled Rice', 'Red Palm Oil', 'Scotch Bonnet Peppers', 'Seasoning Cubes (Chicken)', 'Ground Crayfish', 'Ripe Plantain (Dodo)']],
    ['suya-night', 'Suya night', 'Spice, protein and sides for a backyard suya night.', ['Suya Spice (Yaji)', 'Frozen Goat Meat (Cut)', 'Beef Suya Skewers', 'Zobo (Hibiscus Drink)', 'Plantain Chips (Salted)']],
    ['ethiopian-table', 'The Ethiopian table', 'Berbere, teff and injera for a shared platter.', ['Berbere Spice Blend', 'Teff Flour (Ivory)', 'Fresh Injera', 'Niter Kibbeh (Spiced Butter)', 'Shiro Powder', 'Ethiopian Yirgacheffe Coffee Beans']],
  ] as const) {
    const col = await one<any>('INSERT INTO collections(slug, title, description, is_active) VALUES ($1,$2,$3,true) RETURNING id', [slug, title, desc]);
    collections[slug] = col.id;
    let pos = 0;
    for (const n of names) { const p = await one<any>('SELECT id FROM products WHERE name = $1', [n]); if (p) await query('INSERT INTO collection_items(collection_id, product_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [col.id, p.id, pos++]); }
  }
  const sec = (s: any) => saveHomepageSection(s, undefined, marketing);
  let pos = 0;
  await sec({ kind: 'hero', position: pos += 10 });
  await sec({ kind: 'search', title: 'Find food from home', position: pos += 10 });
  await sec({ kind: 'shop_modes', title: 'How do you want to eat?', position: pos += 10 });
  await sec({ kind: 'category_rail', title: 'Shop by category', position: pos += 10, config: { limit: 10 } });
  await sec({ kind: 'product_rail', title: 'Trending this week', subtitle: 'What neighbours are ordering right now.', position: pos += 10, config: { source: 'trending', limit: 8 } });
  await sec({ kind: 'chef_rail', title: 'Independent chefs near you', subtitle: 'Small batch cooking, made to order.', position: pos += 10, config: { limit: 6 } });
  await sec({ kind: 'banner', position: pos += 10 });
  await sec({ kind: 'vendor_rail', title: 'Stores near you', position: pos += 10, config: { limit: 6 } });
  await sec({ kind: 'collection', title: 'Seasonal: Jollof essentials', position: pos += 10, config: { slug: 'jollof-essentials', limit: 8 } });
  await sec({ kind: 'product_rail', title: 'Deals', subtitle: 'Sale prices from your local stores.', position: pos += 10, config: { source: 'deals', limit: 8 } });
  await sec({ kind: 'cuisine_grid', title: 'Shop by cuisine', position: pos += 10, config: { limit: 8 } });
  await sec({ kind: 'country_grid', title: 'Shop by country', position: pos += 10, config: { limit: 8 } });
  await sec({ kind: 'product_rail', title: 'Prepared meals, ready to eat', position: pos += 10, config: { source: 'prepared', limit: 8 } });
  await sec({ kind: 'product_rail', title: 'Recommended for you', position: pos += 10, config: { source: 'recommended', limit: 8 } });
  await sec({ kind: 'product_rail', title: 'Buy it again', position: pos += 10, config: { source: 'frequently_purchased', limit: 8 } });
  await sec({ kind: 'product_rail', title: 'Recently viewed', position: pos += 10, config: { source: 'recently_viewed', limit: 8 } });
  await sec({ kind: 'product_rail', title: 'New arrivals', position: pos += 10, config: { source: 'new_arrivals', limit: 8 } });
  await sec({ kind: 'collection', title: 'The Ethiopian table', position: pos += 10, config: { slug: 'ethiopian-table', limit: 8 } });
  await sec({ kind: 'editorial', title: 'From the EAZyfoods kitchen', subtitle: 'Recipes and guides with ingredients you can add to your cart.', position: pos += 10, config: { limit: 4 } });

  const content = actorOf(staff.content_manager, 'content_manager');
  const pid = async (n: string) => (await one<any>('SELECT id FROM products WHERE name = $1', [n]))!.id as string;
  const art = (a: any) => saveArticle({ status: 'published', products: [], excerpt: null, ...a }, undefined, content);
  await art({ kind: 'recipe', title: 'Party Jollof Rice', excerpt: 'Smoky, deep red jollof with the crackling bottom pot everyone fights for.', hero_image: '/img/food/meal.svg', body: 'Jollof is a celebration dish, and the secret is patience. Blend the tomatoes, peppers and onion, then fry the base until the oil floats and the raw tomato smell is gone. Toast the rice in the stew, add stock, seal the pot with foil and cook low until tender. Finish with a spoon of butter and leave a few minutes for the base to turn smoky.', recipe: { servings: 8, prep_minutes: 25, cook_minutes: 60, cuisine: 'Nigerian', steps: ['Blend tomatoes, red peppers, scotch bonnet and onion until smooth.', 'Fry the blended base in palm oil for 25 minutes until thick and the oil floats.', 'Stir in seasoning, thyme and curry, then add washed parboiled rice.', 'Pour in hot stock until it just covers the rice. Cover with foil and a lid.', 'Cook on the lowest heat for 35 minutes. Stir once, finish with butter and rest.'] }, products: [{ product_id: await pid('Long Grain Parboiled Rice'), label: 'Parboiled rice, 5 kg', quantity: 1 }, { product_id: await pid('Red Palm Oil'), label: 'Palm oil', quantity: 1 }, { product_id: await pid('Scotch Bonnet Peppers'), label: 'Scotch bonnet peppers', quantity: 1 }, { product_id: await pid('Seasoning Cubes (Chicken)'), label: 'Seasoning cubes', quantity: 1 }, { product_id: await pid('Ripe Plantain (Dodo)'), label: 'Ripe plantain to serve', quantity: 1 }], seo_title: 'Party Jollof Rice recipe with shoppable ingredients' });
  await art({ kind: 'recipe', title: 'Egusi Soup with Pounded Yam', excerpt: 'Thick, nutty melon seed soup with assorted meat.', hero_image: '/img/food/soup.svg', body: 'Egusi should be rich and clustered, not smooth. Fry the ground melon with palm oil until it forms curds, then add stock, meat, crayfish and greens.', recipe: { servings: 6, prep_minutes: 20, cook_minutes: 45, cuisine: 'Nigerian', steps: ['Heat palm oil and fry sliced onion until soft.', 'Stir in ground egusi and fry for 5 minutes until it clumps.', 'Add stock, crayfish, pepper and seasoning. Simmer 20 minutes.', 'Add cooked meat and bitterleaf or spinach. Simmer 10 minutes.', 'Serve with pounded yam.'] }, products: [{ product_id: await pid('Ground Egusi (Melon Seeds)'), label: 'Ground egusi', quantity: 1 }, { product_id: await pid('Red Palm Oil'), label: 'Palm oil', quantity: 1 }, { product_id: await pid('Ground Crayfish'), label: 'Ground crayfish', quantity: 1 }, { product_id: await pid('Pounded Yam Flour'), label: 'Pounded yam flour', quantity: 1 }, { product_id: await pid('Frozen Goat Meat (Cut)'), label: 'Goat meat', quantity: 1 }] });
  await art({ kind: 'recipe', title: 'Doro Wat with Injera', excerpt: 'Ethiopia\'s celebration stew, slow cooked with berbere.', hero_image: '/img/food/platter.svg', body: 'Doro wat needs time. Cook the onions dry first, then add spiced butter and berbere and let the sauce cook down until it looks like jam.', recipe: { servings: 4, prep_minutes: 30, cook_minutes: 90, cuisine: 'Ethiopian', steps: ['Cook finely chopped onions dry in a heavy pot for 20 minutes.', 'Add niter kibbeh and berbere. Cook 15 minutes.', 'Add chicken and water. Simmer 45 minutes.', 'Add boiled eggs and simmer 10 more minutes.', 'Serve on injera.'] }, products: [{ product_id: await pid('Berbere Spice Blend'), label: 'Berbere', quantity: 1 }, { product_id: await pid('Niter Kibbeh (Spiced Butter)'), label: 'Niter kibbeh', quantity: 1 }, { product_id: await pid('Fresh Injera'), label: 'Fresh injera', quantity: 1 }] });
  await art({ kind: 'guide', title: 'A guide to West African spices', excerpt: 'Yaji, crayfish, uziza and more: what they are and how to cook with them.', hero_image: '/img/food/spices.svg', body: 'Yaji is a peanut and pepper blend used for suya. Crayfish is ground and smoked, adding savoury depth. Uziza is a peppery leaf and seed. Start small: most of these ingredients are potent.', products: [{ product_id: await pid('Suya Spice (Yaji)'), label: 'Suya spice', quantity: 1 }, { product_id: await pid('Ground Crayfish'), label: 'Ground crayfish', quantity: 1 }] });
  await art({ kind: 'blog', title: 'Meet the chefs cooking on EAZyfoods', excerpt: 'Independent chefs, small batches, real home cooking.', hero_image: '/img/food/hero-chefs.svg', body: 'Our chefs cook in licensed, inspected kitchens and set a daily portion limit so every order gets proper attention. Order early for the best choice.' });
  await art({ kind: 'landing', title: 'Taste of Lagos Week', excerpt: 'Party jollof, suya and soups. Free delivery over $35.', hero_image: '/img/food/hero-lagos.svg', body: 'A week of Nigerian food from Toronto kitchens. Use code FREESHIP35 on orders over $35.', products: [{ product_id: await pid('Party Jollof Rice with Chicken'), quantity: 1 }, { product_id: await pid('Beef Suya Skewers'), quantity: 1 }, { product_id: await pid('Egusi Soup with Pounded Yam'), quantity: 1 }] });
  for (const [q, a] of [
    ['How does delivery work?', 'Choose delivery or pickup for each store in your cart. Delivery fees depend on distance and the store\'s zones, and you see the exact fee before paying.'],
    ['Can I order from more than one store?', 'Yes. Your cart can hold items from several stores and chefs. We split it into separate orders for each, but you check out once and pay once.'],
    ['How do chef orders work?', 'Chefs set a daily portion limit. If a chef is fully booked for a day, you will see that before checkout and can pick another day.'],
    ['What if something is missing or wrong?', 'Open the order in your account and choose Report a problem. The store is asked to respond and our team reviews it. You can be refunded or credited.'],
    ['Is the dietary information verified?', 'Dietary and allergen labels are provided by the seller. A badge says Verified only when EAZyfoods staff have seen supporting evidence. If you have a serious allergy, contact the seller before ordering.'],
  ] as const) await saveArticle({ kind: 'faq', title: q, body: a, status: 'published', products: [] }, undefined, content);

  // ---------- orders ----------
  registerAllJobs();
  await simulateOrders(opts.orders ?? 46, { customers, vend, drivers, catIds, admin, staff });
  await runDueJobs(2000);
  await query("DELETE FROM jobs WHERE status = 'queued' AND name IN ('vendor_accept_timeout','dispatch_job','offer_timeout','risk_scan_order')");
  // restore driver positions and availability for the demo
  for (const d of drivers) {
    await query('UPDATE driver_profiles SET availability = $2 WHERE user_id = $1 AND verification_status = \'approved\'', [d.id, d.online ? 'online' : 'offline']);
    await query('UPDATE driver_profiles SET current_lat = $2, current_lng = $3, location_updated_at = now() WHERE user_id = $1', [d.id, d.base.lat, d.base.lng]);
  }

  // ---------- analytics, risk, expiry ----------
  await query(`WITH p AS (SELECT array_agg(id::text) ids FROM products WHERE status = 'active')
               INSERT INTO analytics_events(name, anon_id, entity_type, entity_id, created_at)
               SELECT 'product_view', 'demo' || (random() * 900)::int, 'product', p.ids[1 + floor(random() * array_length(p.ids, 1))::int], now() - random() * interval '30 days' FROM p, generate_series(1, 3600)`);
  await query(`WITH p AS (SELECT array_agg(id::text) ids FROM products WHERE status = 'active')
               INSERT INTO analytics_events(name, anon_id, entity_type, entity_id, created_at)
               SELECT 'add_to_cart', 'demo' || (random() * 900)::int, 'product', p.ids[1 + floor(random() * array_length(p.ids, 1))::int], now() - random() * interval '30 days' FROM p, generate_series(1, 700)`);
  await query(`INSERT INTO analytics_events(name, anon_id, campaign_id, ad_id, entity_type, created_at) SELECT 'ad_impression', 'demo' || (random()*500)::int, $1, a.id, 'ad', now() - random() * interval '4 days' FROM ads a, generate_series(1, 400) WHERE a.campaign_id = $1`, [campaign.id]);
  await query(`INSERT INTO analytics_events(name, anon_id, campaign_id, ad_id, entity_type, created_at) SELECT 'ad_click', 'demo' || (random()*500)::int, $1, a.id, 'ad', now() - random() * interval '4 days' FROM ads a, generate_series(1, 36) WHERE a.campaign_id = $1`, [campaign.id]);
  await query(`UPDATE ads SET impressions = coalesce((SELECT count(*) FROM analytics_events e WHERE e.ad_id = ads.id AND e.name = 'ad_impression'),0) + CASE WHEN campaign_id IS NULL THEN floor(random()*900)::int ELSE 0 END, clicks = coalesce((SELECT count(*) FROM analytics_events e WHERE e.ad_id = ads.id AND e.name = 'ad_click'),0) + CASE WHEN campaign_id IS NULL THEN floor(random()*60)::int ELSE 0 END`);
  await query(`UPDATE ads SET spent = round((clicks * rate)::numeric, 2) WHERE cost_model = 'cpc'`);
  await refreshPopularity();
  for (let i = 0; i < 30; i++) await rollupDay(new Date(Date.now() - i * dayMs).toISOString().slice(0, 10));
  for (const o of await query<any>("SELECT id FROM orders WHERE status <> 'pending_payment' ORDER BY placed_at DESC LIMIT 20")) await scanOrder(o.id);
  await scanPlatform();
  await scanDocumentExpiry();
  await runDueJobs(2000);
  await query("DELETE FROM jobs WHERE status = 'queued' AND name IN ('vendor_accept_timeout')");

  const counts = await one<any>(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM vendors) AS vendors, (SELECT count(*)::int FROM products) AS products, (SELECT count(*)::int FROM orders) AS orders,
    (SELECT count(*)::int FROM delivery_jobs) AS jobs, (SELECT count(*)::int FROM ledger_entries) AS ledger, (SELECT count(*)::int FROM reviews) AS reviews, (SELECT count(*)::int FROM payouts) AS payouts`);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, counts);
  return counts;
}

type Ctx = { customers: { id: string; name: string; email: string; addressId: string }[]; vend: Record<string, any>; drivers: { id: string; name: string; base: { lat: number; lng: number }; online: boolean; status: string }[]; catIds: Record<string, string>; admin: Actor; staff: Record<string, string> };

async function simulateOrders(total: number, ctx: Ctx) {
  const { customers, vend, drivers, admin } = ctx;
  const live = ['nkechi', 'island', 'sahel', 'lagos', 'ada', 'kofi', 'selam'];
  const approvedDrivers = drivers.filter((d) => d.status === 'approved');
  const used = new Set<string>();

  /** Pick lines for a vendor, enough to clear its minimum order. */
  const lines = (key: string) => {
    const names = Object.keys(vend[key].products);
    const chosen: { variantId: string; qty: number; name: string }[] = [];
    let total = 0;
    const min = vend[key].v.minOrder + 6;
    for (let guard = 0; guard < 8 && (chosen.length < between(1, 3) || total < min); guard++) {
      const name = choice(names);
      if (chosen.find((c) => c.name === name)) continue;
      const p = vend[key].products[name];
      const variant = rand() < 0.7 ? p.variants[0] : choice(p.variants);
      const qty = between(1, 2);
      chosen.push({ variantId: variant.id as string, qty, name });
      total += variant.price * qty;
    }
    return chosen;
  };

  /** Place an order for a customer across vendor keys. Falls back to pickup where a store does not deliver to the address. */
  async function place(cust: (typeof customers)[number], keys: string[], o: { at: Date; coupon?: string; pickup?: string[]; tip?: number; token?: string; scheduledFor?: Date; useCredit?: boolean } ) {
    const items: { variantId: string; qty: number }[] = [];
    const fulfillment: Record<string, any> = {};
    for (const k of keys) {
      for (const l of lines(k)) { if (!items.find((i) => i.variantId === l.variantId)) items.push({ variantId: l.variantId, qty: l.qty }); }
      fulfillment[vend[k].id] = { mode: o.pickup?.includes(k) ? 'pickup' : 'delivery', scheduledFor: o.scheduledFor ? o.scheduledFor.toISOString() : null };
    }
    const probe = await quoteForUser(cust.id, { items, addressId: cust.addressId, fulfillment, now: o.at } as any);
    for (const b of probe.quote.blockers) if (b.code === 'DELIVERY_UNAVAILABLE' && b.vendorId) fulfillment[b.vendorId] = { ...fulfillment[b.vendorId], mode: 'pickup' };
    const key = `seed-${cust.id}-${Math.random().toString(36).slice(2)}`;
    const out = await checkout(cust.id, {
      items, addressId: cust.addressId, couponCodes: o.coupon ? [o.coupon] : [], tipCents: o.tip ? Math.round(o.tip * 100) : 0, fulfillment, idempotencyKey: key,
      paymentToken: o.token ?? 'tok_visa', now: o.at, useCredit: o.useCredit,
    } as any, actorOf(cust.id, 'customer'));
    return out.orderId;
  }

  /** Vendor and delivery flow up to a target. */
  async function advance(orderId: string, until: 'confirmed' | 'accepted' | 'preparing' | 'ready' | 'in_transit' | 'delivered') {
    if (until === 'confirmed') return;
    const subs = await query<any>('SELECT * FROM suborders WHERE order_id = $1 ORDER BY suffix', [orderId]);
    for (const s of subs) {
      const owner = actorOf(vend[Object.keys(vend).find((k) => vend[k].id === s.vendor_id)!].userId, 'vendor');
      await acceptSuborder(s.vendor_id, s.id, owner, { prepMinutes: between(12, 40) });
      if (until === 'accepted') continue;
      await startPreparing(s.vendor_id, s.id, owner);
      if (until === 'preparing') continue;
      await markReady(s.vendor_id, s.id, owner);
      if (until === 'ready') continue;
      if (s.fulfillment_type === 'pickup') { if (until === 'delivered') await collectPickup(s.vendor_id, s.id, s.pickup_code, owner); continue; }
      if (s.fulfillment_type === 'delivery_vendor') { await vendorDeliveryStep(s.vendor_id, s.id, 'out', owner); if (until === 'delivered') await vendorDeliveryStep(s.vendor_id, s.id, 'delivered', owner); continue; }
      const job = (await one<any>('SELECT * FROM delivery_jobs WHERE suborder_id = $1', [s.id]))!;
      const driver = choice(approvedDrivers.filter((d) => d.status === 'approved'));
      // Put the chosen driver close to the pickup and everyone else far away so dispatch picks them.
      for (const d of approvedDrivers) {
        const near = d.id === driver.id;
        await query("UPDATE driver_profiles SET availability = 'online', current_lat = $2, current_lng = $3, location_updated_at = now() WHERE user_id = $1", [d.id, near ? job.pickup_lat + 0.006 : job.pickup_lat + 0.6, near ? job.pickup_lng + 0.004 : job.pickup_lng + 0.6]);
      }
      await dispatchJob(job.id);
      const offered = await one<any>("SELECT driver_id FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [job.id]);
      if (!offered) throw new Error('No driver offer was created');
      const da = actorOf(offered.driver_id, 'driver');
      await acceptOffer(offered.driver_id, job.id, da);
      await arrivedAtPickup(offered.driver_id, job.id, da);
      await confirmPickup(offered.driver_id, job.id, da);
      await startTransit(offered.driver_id, job.id, da);
      await updateDriverLocation(offered.driver_id, job.dropoff_lat - 0.004, job.dropoff_lng - 0.003, 90, 28);
      if (until === 'in_transit') continue;
      const fresh = (await one<any>('SELECT delivery_pin FROM delivery_jobs WHERE id = $1', [job.id]))!;
      await completeDelivery(offered.driver_id, job.id, { pin: fresh.delivery_pin, lat: job.dropoff_lat + 0.0003, lng: job.dropoff_lng }, da);
    }
  }

  const daysAgoPlan: number[] = [];
  for (let i = 0; i < total; i++) daysAgoPlan.push(Math.max(3, Math.round(3 + (i / total) * 52 + rand() * 2)));
  daysAgoPlan.sort((a, b) => b - a);

  const completedSub: { suborderId: string; customerId: string; vendorKey: string; daysAgo: number; orderId: string }[] = [];
  let firstUse = new Set<string>();
  for (let i = 0; i < total; i++) {
    const cust = i < customers.length ? customers[i] : choice(customers);
    const nKeys = rand() < 0.45 ? 1 : rand() < 0.75 ? 2 : 3;
    const keys = [...new Set(Array.from({ length: nKeys }, () => choice(live)))];
    const daysAgo = daysAgoPlan[i];
    let at = torontoTime(daysAgo, between(11, 17), between(0, 59));
    // chefs only cook on their working days
    for (let guard = 0; guard < 7; guard++) {
      const bad = keys.some((k) => vend[k].v.chef && !vend[k].v.chef.days.includes(Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'short' }).format(at) === 'Sun' ? 0 : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'short' }).format(at)) + 1)));
      const closedIsland = keys.includes('island') && new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'short' }).format(at) === 'Sun';
      if (!bad && !closedIsland) break;
      at = new Date(at.getTime() - dayMs);
    }
    const pickupKeys = keys.filter(() => rand() < 0.18);
    const coupon = !firstUse.has(cust.id) && rand() < 0.8 ? 'WELCOME10' : rand() < 0.2 ? 'FREESHIP35' : undefined;
    const outcome = rand();
    try {
      const orderId = await place(cust, keys, { at, coupon, pickup: pickupKeys, tip: rand() < 0.6 ? choice([2, 3, 5]) : 0 });
      firstUse.add(cust.id);
      if (outcome < 0.06) {
        const sub = (await one<any>('SELECT id, vendor_id FROM suborders WHERE order_id = $1 ORDER BY suffix LIMIT 1', [orderId]))!;
        const owner = actorOf(vend[Object.keys(vend).find((k) => vend[k].id === sub.vendor_id)!].userId, 'vendor');
        await vendorCancel(sub.vendor_id, sub.id, 'Sold out of an item', owner, true);
        await advance(orderId, 'delivered').catch(() => {});
      } else if (outcome < 0.1) {
        await customerCancel(cust.id, orderId, null, actorOf(cust.id, 'customer'));
      } else {
        await advance(orderId, 'delivered');
        for (const s of await query<any>("SELECT id, vendor_id FROM suborders WHERE order_id = $1 AND status = 'completed'", [orderId])) completedSub.push({ suborderId: s.id, customerId: cust.id, vendorKey: Object.keys(vend).find((k) => vend[k].id === s.vendor_id)!, daysAgo, orderId });
        if (outcome > 0.93) {
          const s = await one<any>("SELECT id FROM suborders WHERE order_id = $1 AND status = 'completed' LIMIT 1", [orderId]);
          if (s) await tx((c) => refundSuborder(c, { suborderId: s.id, amount: 5, bearer: 'platform', reason: 'Goodwill credit for a late delivery' }, actorOf(ctx.staff.customer_support, 'customer_support')));
        }
      }
      await backdate(orderId, at);
      used.add(orderId);
    } catch (e: any) {
      log(`order ${i + 1} skipped: ${e.message}`);
      // A partially processed order must still leave consistent state; the services are transactional so nothing half done is kept.
    }
  }

  // ---- reviews ----
  const reviewText = {
    5: ['Fresh, well packed and arrived hot. Will order again.', 'Exactly what I needed for Sunday cooking. Great quality.', 'The best jollof in the city. Generous portions.', 'Authentic taste, just like home.'],
    4: ['Good quality and on time. One item was a little smaller than expected.', 'Tasty food. Delivery took a bit longer than the estimate.', 'Very good. I would like more size options.'],
    3: ['Food was fine but arrived lukewarm.', 'Order was correct but the packaging could be better.'],
    2: ['One item was missing from my bag.'],
  } as const;
  const vendorOwner = (key: string) => actorOf(vend[key].userId, 'vendor');
  let rcount = 0;
  for (const cs of completedSub) {
    if (rand() > 0.75) continue;
    const r = rand();
    const rating = (r < 0.55 ? 5 : r < 0.85 ? 4 : r < 0.95 ? 3 : 2) as 5 | 4 | 3 | 2;
    const rev = await createReview(cs.customerId, { suborderId: cs.suborderId, subjectType: 'vendor', rating, body: choice([...reviewText[rating]]) }, actorOf(cs.customerId, 'customer')).catch(() => null);
    if (!rev) continue;
    rcount++;
    const item = await one<any>('SELECT product_id FROM order_items WHERE suborder_id = $1 LIMIT 1', [cs.suborderId]);
    if (item && rand() < 0.5) await createReview(cs.customerId, { suborderId: cs.suborderId, subjectType: 'product', subjectId: item.product_id, rating: Math.min(5, rating + (rand() < 0.3 ? 1 : 0)) as any, body: 'Great product, would buy again.' }, actorOf(cs.customerId, 'customer')).catch(() => {});
    if (await one("SELECT 1 FROM delivery_jobs WHERE suborder_id = $1 AND status = 'delivered'", [cs.suborderId]) && rand() < 0.4) await createReview(cs.customerId, { suborderId: cs.suborderId, subjectType: 'driver', rating: rating >= 4 ? 5 : 3, body: 'Polite and quick.' }, actorOf(cs.customerId, 'customer')).catch(() => {});
    if (rating >= 4 && rand() < 0.35) await query('UPDATE reviews SET vendor_response = $2, responded_at = now(), responded_by = $3 WHERE id = $1', [rev.id, 'Thank you for ordering. We are glad you enjoyed it!', vend[cs.vendorKey].userId]);
    await query("UPDATE reviews SET created_at = now() - ($2 || ' days')::interval + interval '2 hours' WHERE user_id = $1 AND suborder_id = $3", [cs.customerId, String(Math.max(0, cs.daysAgo - 0)), cs.suborderId]);
  }
  log(`reviews: ${rcount}`);

  // ---- disputes and tickets (on recent completed orders so the window is open) ----
  const recent = completedSub.filter((c) => c.daysAgo <= 12);
  const supportActor = actorOf(ctx.staff.customer_support, 'customer_support');
  if (recent[0]) {
    const d1 = await openDispute(recent[0].customerId, recent[0].suborderId, { reason: 'One of the packs was missing from my bag.', category: 'missing_items' }, actorOf(recent[0].customerId, 'customer'));
    await vendorRespondDispute(vend[recent[0].vendorKey].id, d1.dispute.id, 'We packed all items and the bag was sealed. We are happy to look at the photo if the customer has one.', vendorOwner(recent[0].vendorKey));
    await resolveDispute(d1.dispute.id, { resolution: 'partial_refund', amount: 8, reason: 'Driver confirmed one pack was not in the delivery bag. Refunded the item value.', bearer: 'platform' }, supportActor);
  }
  if (recent[1]) await openDispute(recent[1].customerId, recent[1].suborderId, { reason: 'The food was cold when it arrived and one dish was the wrong size.', category: 'incorrect_items', claimedAmount: 12 }, actorOf(recent[1].customerId, 'customer'));
  if (recent[2]) await openDispute(recent[2].customerId, recent[2].suborderId, { reason: 'Packaging leaked in the bag.', category: 'damaged' }, actorOf(recent[2].customerId, 'customer')).then((d) => vendorRespondDispute(vend[recent[2].vendorKey].id, d.dispute.id, 'Sorry about that. We have changed to sealed containers for soups.', vendorOwner(recent[2].vendorKey)));
  for (const [i, subject, body, cat] of [[3, 'Can I change my delivery address?', 'I moved this week. How do I update the saved address for future orders?', 'other'], [4, 'Question about a refund', 'I was refunded $5. Can you confirm when it arrives on my card?', 'refund_request']] as const) {
    const cs = recent[i];
    if (!cs) continue;
    const t = await createTicket({ user: { id: cs.customerId, email: '', full_name: '', status: 'active', phone: null }, sessionId: '', roles: ['customer'], perms: new Set(), memberships: [] } as AuthCtx, { category: cat, subject, body, orderId: cs.orderId }, actorOf(cs.customerId, 'customer'));
    if (i === 4) { await query("UPDATE support_tickets SET status = 'resolved', assigned_to = $2, resolution_note = 'Refunds appear within 3 to 5 business days.' WHERE id = $1", [t.id, ctx.staff.customer_support]); }
  }

  // ---- live orders for the demo (not backdated) ----
  const amara = customers[0], david = customers[1], fatou = customers[2];
  const liveAt = torontoTime(0, 14, 0);
  const tryLive = async (label: string, fn: () => Promise<any>) => { try { await fn(); } catch (e: any) { log(`live order "${label}" skipped: ${e.message}`); } };
  await tryLive('awaiting acceptance', async () => place(amara, ['nkechi', 'island'], { at: liveAt, tip: 3 }));
  await tryLive('preparing', async () => { const id = await place(david, ['lagos'], { at: liveAt, pickup: [] }); await advance(id, 'preparing'); });
  await tryLive('ready for driver', async () => { const id = await place(fatou, ['nkechi'], { at: liveAt, tip: 2 }); await advance(id, 'ready'); });
  await tryLive('in transit', async () => { const id = await place(amara, ['island'], { at: liveAt, tip: 4 }); await advance(id, 'in_transit'); });
  await tryLive('pickup ready', async () => { const id = await place(customers[3], ['ada'], { at: liveAt, pickup: ['ada'] }); await advance(id, 'ready'); });
  await tryLive('scheduled', async () => place(amara, ['lagos'], { at: liveAt, scheduledFor: new Date(liveAt.getTime() + 30 * 3600000) }));
  // A failed card attempt for the finance and risk views
  await tryLive('declined card', async () => { try { await place(customers[5], ['nkechi'], { at: liveAt, token: 'tok_declined' }); } catch (e) { if (!(e instanceof PaymentFailed)) throw e; } });

  // ---- payouts ----
  const created = await runPayoutCycle(SYSTEM, { process: false, force: true });
  const payouts = await query<any>("SELECT id, payee_type FROM payouts WHERE status = 'pending' ORDER BY created_at");
  let held = false;
  for (const p of payouts) {
    if (!held && p.payee_type === 'vendor') { await holdPayout(p.id, 'Pending bank account verification', admin); held = true; continue; }
    if (rand() < 0.75) await processPayout(p.id, admin).catch(() => {});
  }
  log(`orders simulated: ${used.size}, payouts created: ${created}`);
  void cleanup;
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  seed({ force: process.argv.includes('--force') })
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
