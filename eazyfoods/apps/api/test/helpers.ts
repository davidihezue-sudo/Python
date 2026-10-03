import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { pool, query, one, tx } from '../src/db.js';
import { seedRbac, assignRole } from '../src/lib/rbac.js';
import { createUser } from '../src/modules/accounts.js';
import { createVendor, setHours, submitForReview, reviewVendor } from '../src/modules/vendors.js';
import { applyDriver, submitDriver, reviewDriver } from '../src/modules/drivers.js';
import { addDocument, reviewDocument } from '../src/modules/compliance.js';
import { createProduct } from '../src/modules/catalog.js';
import { updateDriverLocation } from '../src/modules/deliveries.js';
import { registerAllJobs } from '../src/jobs-registry.js';
import { clearSettingsCache } from '../src/lib/settings.js';
import { SYSTEM, type Actor } from '../src/lib/audit.js';
import { setSetting } from '../src/lib/settings.js';
import type { FastifyInstance } from 'fastify';

export const PASSWORD = 'EazyDemo!2026';
export const actorOf = (userId: string, role: string): Actor => ({ userId, role });

export async function resetDb() {
  await migrate({ reset: true });
  clearSettingsCache();
  await seedRbac();
  await query(`INSERT INTO tax_rules(country, region, tax_class, name, rate) VALUES ('CA','ON','standard','HST',13),('CA','ON','prepared','HST',13)`);
  await query(`INSERT INTO compliance_rules(jurisdiction, applies_to, doc_type, label, required) VALUES ('CA-ON','vendor','business_licence','Business licence',true),('CA-ON','chef','food_handler_certificate','Food handler certificate',true),('CA-ON','driver','drivers_licence','Driver licence',true)`);
  await query(`INSERT INTO ad_placements(key,label,max_slots) VALUES ('homepage_hero','Hero',1),('homepage_banner','Banner',2)`);
  await query(`INSERT INTO delivery_zones(scope, name, zone_type, center_lat, center_lng, radius_km, fee_model, base_fee, per_km_fee, free_over, min_order, max_distance_km, priority) VALUES
    ('platform','Core','radius',43.6532,-79.3832,30,'distance',3.99,0.50,100,0,30,1)`);
  await query(`INSERT INTO commission_rules(name, scope, percent) VALUES ('Default','global',12)`);
}

export async function app(opts: { strictLimits?: boolean } = {}): Promise<FastifyInstance> {
  registerAllJobs();
  const a = await buildApp(opts);
  await a.ready();
  return a;
}
export async function closeAll(a?: FastifyInstance) { await a?.close(); await pool.end(); }

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeUser(role = 'customer', over: Partial<{ email: string; name: string; phone: string }> = {}) {
  const u = await createUser({ email: over.email ?? `u${uniq()}@test.eazyfoods.test`, password: PASSWORD, full_name: over.name ?? 'Test User', phone: over.phone }, role, SYSTEM);
  return u;
}
export async function makeStaff(role: string) { return makeUser(role, { name: `Staff ${role}` }); }

export async function makeCustomer(over: Partial<{ postal: string; city: string }> = {}) {
  const u = await makeUser('customer', { name: 'Amara Test', phone: '416-555-' + String(1000 + counter).slice(-4) });
  const { saveAddress } = await import('../src/modules/accounts.js');
  const addr = await saveAddress(u.id, { label: 'Home', line1: '88 Davenport Road', city: over.city ?? 'Toronto', region: 'ON', postal_code: over.postal ?? 'M4W 1A1' });
  return { ...u, addressId: addr.id as string };
}

export async function loginToken(email: string, password = PASSWORD): Promise<string> {
  const { login } = await import('../src/modules/accounts.js');
  return (await login(email, password, {})).token;
}
export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** An approved vendor with an owner login, hours open all day, and optionally products. */
export async function makeVendor(o: { type?: 'grocery' | 'prepared' | 'chef' | 'specialty'; name?: string; postal?: string; ownDelivery?: boolean; lat?: number; lng?: number; minOrder?: number; approved?: boolean; capacity?: number; pickup?: boolean } = {}) {
  const owner = await makeUser('customer', { name: 'Owner Person' });
  const type = o.type ?? 'grocery';
  const v = await createVendor(owner.id, {
    seller_type: type, legal_name: `${o.name ?? 'Test Store'} Inc.`, trading_name: o.name ?? `Test Store ${uniq()}`, line1: '1250 Dufferin Street', city: 'Toronto', region: 'ON', postal_code: o.postal ?? 'M6H 4C4',
    lat: o.lat ?? 43.6689, lng: o.lng ?? -79.4372, email: 'store@test.eazyfoods.test', phone: '416-555-0100', accepts_delivery: true, accepts_pickup: o.pickup ?? true, uses_own_drivers: o.ownDelivery ?? false,
    chef: type === 'chef' ? { display_name: 'Chef Test', daily_capacity: o.capacity ?? 10 } : undefined,
  }, actorOf(owner.id, 'vendor'));
  await query('UPDATE vendors SET min_order = $2, default_prep_minutes = 15 WHERE id = $1', [v.id, o.minOrder ?? 0]);
  await setHours(v.id, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, opens: '00:00', closes: '23:59' })), actorOf(owner.id, 'vendor'));
  if (o.approved !== false) {
    const admin = await makeStaff('super_admin');
    const a = actorOf(admin.id, 'super_admin');
    const docType = type === 'chef' ? 'food_handler_certificate' : 'business_licence';
    const doc = await addDocument({ ownerType: 'vendor', ownerId: v.id, docType, expiryDate: '2030-01-01' }, a);
    await reviewDocument(doc.id, 'verified', undefined, a);
    await submitForReview(v.id, actorOf(owner.id, 'vendor'));
    await reviewVendor(v.id, 'start_review', undefined, a);
    await reviewVendor(v.id, 'approve', undefined, a);
  }
  return { id: v.id as string, ownerId: owner.id as string, ownerEmail: (await one<any>('SELECT email FROM users WHERE id = $1', [owner.id]))!.email as string, slug: v.slug as string };
}

export async function makeProduct(vendorId: string, ownerId: string, o: { name?: string; type?: 'dry' | 'fresh' | 'frozen' | 'prepared' | 'chef_meal'; price?: number; stock?: number; tax?: string; sale?: number; weight?: number; cap?: number; categoryId?: string; variants?: { name: string; price: number; stock?: number }[]; tracks?: boolean; prep?: number } = {}) {
  const type = o.type ?? 'dry';
  const tracks = o.tracks ?? !['prepared', 'chef_meal'].includes(type);
  const p = await createProduct(vendorId, {
    name: o.name ?? `Product ${uniq()}`, product_type: type, category_id: o.categoryId, tax_class: o.tax ?? 'standard', status: 'active', tracks_inventory: tracks, daily_capacity: o.cap ?? null, weight_grams: o.weight ?? 500, prep_time_minutes: o.prep,
    variants: (o.variants ?? [{ name: 'Default', price: o.price ?? 10, stock: o.stock ?? 50 }]).map((v, i) => ({ name: v.name, price: v.price, sale_price: i === 0 ? o.sale ?? null : null, stock: v.stock ?? o.stock ?? 50, portions: 1, is_default: i === 0 })),
  } as any, actorOf(ownerId, 'vendor'));
  const vs = await query<any>('SELECT id, name, sku, price FROM product_variants WHERE product_id = $1 ORDER BY position', [p.id]);
  return { id: p.id as string, slug: p.slug as string, variants: vs.map((v) => ({ id: v.id as string, name: v.name as string, sku: v.sku as string, price: Number(v.price) })), variantId: vs[0].id as string };
}

export async function makeDriver(o: { approved?: boolean; online?: boolean; lat?: number; lng?: number; vehicle?: 'car' | 'bike' | 'van' | 'ebike' } = {}) {
  const u = await makeUser('customer', { name: 'Driver Dave', phone: '647-555-0' + String(100 + counter).slice(-3) });
  await applyDriver(u.id, { legal_name: 'Driver Dave', phone: '647-555-0199', city: 'Toronto', region: 'ON', postal_code: 'M5V 2T6', vehicle: { vehicle_type: o.vehicle ?? 'car', has_cold_storage: true } }, actorOf(u.id, 'driver'));
  const admin = await makeStaff('super_admin');
  const a = actorOf(admin.id, 'super_admin');
  const doc = await addDocument({ ownerType: 'driver', ownerId: u.id, docType: 'drivers_licence', expiryDate: '2030-01-01' }, actorOf(u.id, 'driver'));
  await reviewDocument(doc.id, 'verified', undefined, a);
  await submitDriver(u.id, actorOf(u.id, 'driver'));
  if (o.approved !== false) {
    await reviewDriver(u.id, 'start_review', undefined, a);
    await reviewDriver(u.id, 'approve', undefined, a);
    if (o.online !== false) await query("UPDATE driver_profiles SET availability = 'online' WHERE user_id = $1", [u.id]);
  }
  await updateDriverLocation(u.id, o.lat ?? 43.67, o.lng ?? -79.43);
  return { id: u.id as string, email: (await one<any>('SELECT email FROM users WHERE id = $1', [u.id]))!.email as string };
}

export { pool, query, one, tx, setSetting, clearSettingsCache, SYSTEM };
