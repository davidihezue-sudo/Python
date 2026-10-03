import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeStaff, loginToken, bearer, query, one, setSetting, clearSettingsCache, SYSTEM, makeUser, makeDriver, PASSWORD } from './helpers.js';
import { enqueue, runDueJobs, registerJob, schedule, tickSchedules, SCHEDULES } from '../src/lib/jobs.js';
import { scanOrder, scanPlatform } from '../src/modules/fraud.js';
import { commandCentre, globalSearch } from '../src/modules/admin.js';
import { platformAnalytics, vendorAnalytics, chefAnalytics, customerAnalytics } from '../src/modules/insights.js';
import { startEventBridge, stopEventBridge, publish } from '../src/lib/events.js';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });
const call = (method: string, url: string, token: string | null, payload?: any, headers: any = {}) => app.inject({ method: method as any, url, payload, headers: { ...(token ? bearer(token) : {}), ...headers } });
async function cust() { const c = await makeCustomer(); return { ...c, token: await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email) }; }
async function buy(c: any, v: any, p: any, qty = 2) {
  await call('POST', '/api/carts/items', c.token, { variantId: p.variantId, qty });
  await call('PATCH', '/api/carts/options', c.token, { fulfillment: { [v.id]: { mode: 'pickup' } } });
  const r = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'pl-' + Math.random().toString(36).slice(2) + '-key', paymentToken: 'tok_visa' });
  return r.json().orderId as string;
}

describe('search and discovery', () => {
  let v: any;
  beforeAll(async () => {
    v = await makeVendor({ name: 'Mama Nkechi Market' });
    const cat = (await one<any>("INSERT INTO categories(slug, name) VALUES ('rice-grains','Rice and grains') RETURNING id"))!.id;
    for (const [name, price, extra] of [['Ofada Rice', 11.99, { cuisine: 'Nigerian' }], ['White Garri', 5.99, { cuisine: 'Nigerian' }], ['Berbere Spice', 8.99, { cuisine: 'Ethiopian' }], ['Frozen Tilapia', 12.99, { cuisine: 'Ghanaian' }], ['Suya Spice', 5.5, {}]] as const) {
      const p = await makeProduct(v.id, v.ownerId, { name, price, stock: name === 'Berbere Spice' ? 0 : 20, categoryId: name.includes('Rice') ? cat : undefined, type: name.includes('Frozen') ? 'frozen' : 'dry' });
      if ((extra as any).cuisine) await query('UPDATE products SET cuisine = $2, country_of_origin = $3 WHERE id = $1', [p.id, (extra as any).cuisine, (extra as any).cuisine === 'Nigerian' ? 'Nigeria' : 'Other']);
      if (name === 'White Garri') await query("UPDATE products SET tags = ARRAY['cassava','eba'], dietary = ARRAY['Vegan'] WHERE id = $1", [p.id]);
    }
    await query("INSERT INTO search_synonyms(term, synonyms) VALUES ('garri', ARRAY['gari','cassava flour'])");
    await query('UPDATE vendors SET lat = 43.67, lng = -79.40 WHERE id = $1', [v.id]);
  });
  const names = async (qs: string) => (await call('GET', `/api/products?${qs}`, null)).json().items.map((i: any) => i.name);
  it('finds products by name with typo tolerance, synonyms and tags', async () => {
    expect(await names('q=ofada')).toEqual(['Ofada Rice']);
    expect(await names('q=ofda rice')).toContain('Ofada Rice');                  // typo
    expect(await names('q=gari')).toContain('White Garri');                       // synonym
    expect(await names('q=cassava')).toContain('White Garri');
    expect(await names('q=suy')).toContain('Suya Spice');                         // prefix
    expect(await names('q=zzzzqqq')).toEqual([]);
    expect(await names("q=rice'; DROP TABLE products;--")).toEqual([]);          // injection attempt is just text
    expect((await one<any>('SELECT count(*)::int AS n FROM products'))!.n).toBeGreaterThan(0);
    expect((await call('GET', '/api/products?q=' + 'x'.repeat(500), null)).statusCode).toBe(400);
  });
  it('filters by price, cuisine, type, availability, dietary tags, category and vendor, and sorts', async () => {
    expect(await names('cuisine=Nigerian')).toHaveLength(2);
    expect(await names('type=frozen')).toEqual(['Frozen Tilapia']);
    expect(await names('min_price=8&max_price=12')).toEqual(expect.arrayContaining(['Ofada Rice', 'Berbere Spice']));
    expect(await names('in_stock=true')).not.toContain('Berbere Spice');
    expect(await names('dietary=Vegan')).toEqual(['White Garri']);
    expect(await names('category=rice-grains')).toEqual(['Ofada Rice']);
    expect(await names(`vendor=${v.slug}&limit=2`)).toHaveLength(2);
    expect((await names('sort=price_asc'))[0]).toBe('Suya Spice');
    expect((await names('sort=price_desc'))[0]).toBe('Frozen Tilapia');
    const page = (await call('GET', '/api/products?limit=2&page=2', null)).json();
    expect(page).toMatchObject({ page: 2, limit: 2, pages: 3, total: 5 });
    expect(page.items).toHaveLength(2);
    const f = (await call('GET', '/api/products/facets', null)).json();
    expect(f.cuisines.map((c: any) => c.value)).toContain('Nigerian');
  });
  it('uses location for distance, ordering and delivery availability', async () => {
    const near = (await call('GET', '/api/products?lat=43.67&lng=-79.41&sort=distance', null)).json().items[0];
    expect(near.distance_km).toBeLessThan(2);
    expect(await names('lat=45.5&lng=-73.6&max_km=50')).toEqual([]);                        // Montreal is far away
    expect((await names('lat=43.67&lng=-79.41&deliverable=true')).length).toBe(5);
    expect(await names('lat=45.5&lng=-73.6&deliverable=true')).toEqual([]);
    const stores = (await call('GET', '/api/stores?lat=43.67&lng=-79.41&deliverable=true', null)).json();
    expect(stores.items[0].trading_name).toBe('Mama Nkechi Market');
    expect((await call('GET', '/api/delivery/check?lat=43.67&lng=-79.41', null)).json().stores[0]).toMatchObject({ trading_name: 'Mama Nkechi Market' });
    expect((await call('GET', '/api/delivery/check?lat=45.5&lng=-73.6', null)).json().stores).toEqual([]);
  });
  it('autocompletes products, stores and categories, and hides unapproved sellers', async () => {
    const s = (await call('GET', '/api/products/autocomplete?q=ofa', null)).json().suggestions;
    expect(s[0]).toMatchObject({ label: 'Ofada Rice', type: 'product' });
    expect((await call('GET', '/api/products/autocomplete?q=mama', null)).json().suggestions.some((x: any) => x.type === 'vendor')).toBe(true);
    expect((await call('GET', '/api/products/autocomplete?q=rice', null)).json().suggestions.some((x: any) => x.type === 'category')).toBe(true);
    expect((await call('GET', '/api/products/autocomplete?q=o', null)).json().suggestions).toEqual([]);
    const hidden = await makeVendor({ approved: false, name: 'Hidden Kitchen' });
    await query("UPDATE vendors SET verification_status = 'under_review' WHERE id = $1", [hidden.id]);
    expect((await call('GET', `/api/stores/${hidden.slug}`, null)).statusCode).toBe(404);
    expect((await call('GET', '/api/products/autocomplete?q=hidden', null)).json().suggestions).toEqual([]);
  });
  it('serves product pages with variants, stock hints and no internal fields', async () => {
    const slug = (await one<any>("SELECT slug FROM products WHERE name = 'Ofada Rice'"))!.slug;
    const p = (await call('GET', `/api/products/${slug}`, null)).json().product;
    expect(p.variants[0]).toMatchObject({ name: 'Default', available: 20 });
    expect(p).not.toHaveProperty('search_tsv'); expect(p).not.toHaveProperty('created_by'); expect(p.variants[0]).not.toHaveProperty('cost');
    expect((await call('GET', '/api/products/does-not-exist', null)).statusCode).toBe(404);
    expect(await one("SELECT 1 FROM analytics_events WHERE name = 'product_view'")).toBeTruthy();
  });
});

describe('admin operations', () => {
  it('audits who changed what for products, prices, inventory, orders, approvals and settings', async () => {
    const admin = await makeStaff('super_admin');
    const at = await loginToken(admin.email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 10, stock: 10 });
    const vt = await loginToken(v.ownerEmail);
    await call('PUT', `/api/vendors/${v.id}/products/${p.id}`, vt, { variants: [{ id: p.variantId, name: 'Default', price: 11, stock: 10 }] });
    await call('POST', `/api/vendors/${v.id}/inventory/adjust`, vt, { variantId: p.variantId, kind: 'receive', qty: 5 });
    expect((await call('PUT', '/api/admin/settings/commission', at, { value: { percent: 14 } })).statusCode).toBe(200);
    const answer = async (q: string) => (await call('GET', `/api/admin/audit?${q}`, at)).json().entries;
    const created = (await answer(`entityType=product&entityId=${p.id}&action=product.created`))[0];
    expect(created.actor_user_id === undefined).toBe(true);
    expect(created.actor_name).toBe('Owner Person');                                                 // who created this product
    const price = (await answer(`entityId=${p.id}&action=product.price_changed`))[0];
    expect(price.changes.from.price).toBe(10); expect(price.changes.to.price).toBe(11); expect(price.created_at).toBeTruthy();   // who changed the price, what and when
    expect((await answer(`entityId=${p.variantId}&action=inventory.adjusted`))[0].actor_name).toBe('Owner Person');
    const approved = (await answer(`entityType=vendor&entityId=${v.id}&action=vendor.approve`))[0];
    expect(approved.actor_name).toContain('Staff super_admin');                                      // who approved this vendor
    const setting = (await answer('action=setting.updated'))[0];
    expect(setting.changes.before.percent).toBe(12); expect(setting.changes.after.percent).toBe(14);
    expect(setting.actor_name).toBe(admin.email ? 'Staff super_admin' : '');
    expect((await answer('action=product.created'))[0]).toHaveProperty('ip');
    await setSetting('commission', { percent: 12 }, null);
    // the audit log is only for people who may read it
    expect((await call('GET', '/api/admin/audit', await loginToken(v.ownerEmail))).statusCode).toBe(403);
    expect((await call('GET', '/api/admin/audit', await loginToken((await makeStaff('marketing_staff')).email))).statusCode).toBe(403);
  });
  it('applies configuration changes immediately to pricing and validates them', async () => {
    const at = await loginToken((await makeStaff('super_admin')).email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 100, stock: 10, tax: 'zero_rated' });
    const c = await cust();
    const quote = async () => (await call('POST', '/api/carts/quote', c.token, { items: [{ variantId: p.variantId, qty: 1 }], fulfillment: { [v.id]: { mode: 'pickup' } } })).json().quote;
    const base = await quote();
    expect((await call('PUT', '/api/admin/settings/service_fee', at, { value: { percent: 10, min: 0, max: 50 } })).statusCode).toBe(200);
    expect((await quote()).totals.serviceFee).toBe(10);
    expect(base.totals.serviceFee).toBe(3);
    await call('PUT', '/api/admin/settings/service_fee', at, { value: { percent: 3, min: 0.5, max: 6 } });
    expect((await call('PUT', '/api/admin/settings/service_fee', at, { value: { percent: 'lots' } })).statusCode).toBe(400);
    expect((await call('PUT', '/api/admin/settings/service_fee', at, { value: { percent: -5 } })).statusCode).toBe(400);
    expect((await call('PUT', '/api/admin/settings/not_a_setting', at, { value: {} })).statusCode).toBe(404);
    expect((await call('PUT', '/api/admin/settings/orders', at, { value: { minimum_order: 150 } })).statusCode).toBe(200);
    expect((await quote()).canCheckout).toBe(false);
    await call('PUT', '/api/admin/settings/orders', at, { value: { minimum_order: 0 } });
    // commission rules and vendor overrides change the vendor's net
    await call('PUT', '/api/admin/commission-rules', at, { name: 'Vendor deal', scope: 'vendor', vendor_id: v.id, percent: 5, fixed_fee: 0 });
    const net = (await call('POST', '/api/carts/quote', c.token, { items: [{ variantId: p.variantId, qty: 1 }], fulfillment: { [v.id]: { mode: 'pickup' } } })).json();
    expect(net.quote.groups[0].itemsSubtotal).toBe(100);
    const order = await buy(c, v, p, 1);
    expect(Number((await one<any>('SELECT commission_amount FROM suborders WHERE order_id = $1', [order]))!.commission_amount)).toBe(5);
    const all = (await call('GET', '/api/admin/settings', at)).json().settings;
    expect(all.map((s: any) => s.key)).toEqual(expect.arrayContaining(['commission', 'delivery', 'driver_pay', 'payouts', 'refunds', 'dispatch', 'privacy']));
    // fee rules and zones are manageable
    expect((await call('PUT', '/api/admin/fee-rules', at, { name: 'Late night', kind: 'surcharge', amount: 2, conditions: { hours: ['22:00', '24:00'] } })).statusCode).toBe(200);
    expect((await call('PUT', '/api/admin/fee-rules', at, { name: 'Broken', kind: 'multiplier' })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/zones', at, { name: 'Ottawa', zone_type: 'radius', center_lat: 45.42, center_lng: -75.69, radius_km: 20, base_fee: 6 })).statusCode).toBe(201);
    expect((await call('GET', '/api/admin/tax-rules', at)).statusCode).toBe(200);
  });
  it('shows a live command centre built from real operational data', async () => {
    const ops = await loginToken((await makeStaff('operations_admin')).email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 20, stock: 1, tax: 'zero_rated' });
    const c = await cust();
    const orderId = await buy(c, v, p, 1);
    await query("UPDATE suborders SET created_at = now() - interval '12 minutes' WHERE order_id = $1", [orderId]);
    await query('UPDATE vendors SET accepting_orders = false WHERE id = $1', [(await makeVendor()).id]);
    await makeDriver({ lat: 43.67, lng: -79.4 });
    await call('POST', '/api/carts/items', c.token, { variantId: p.variantId, qty: 1 }).catch(() => {});
    const cc = (await call('GET', '/api/admin/command-centre', ops)).json();
    expect(cc.kpis.orders_today).toBeGreaterThan(0);
    expect(cc.kpis.drivers_online).toBeGreaterThan(0);
    expect(cc.attention.vendor_not_responding.some((x: any) => x.number.startsWith('EAZ-'))).toBe(true);     // drill into any item
    expect(cc.attention.vendors_offline.length).toBeGreaterThan(0);
    expect(cc.attention.low_inventory.length).toBeGreaterThan(0);
    expect(cc.attention.pending_approvals).toHaveProperty('vendors');
    const fail = await cust();
    await call('POST', '/api/carts/items', fail.token, { variantId: (await makeProduct(v.id, v.ownerId, { price: 20, stock: 9 })).variantId, qty: 1 });
    await call('PATCH', '/api/carts/options', fail.token, { fulfillment: { [v.id]: { mode: 'pickup' } } });
    await call('POST', '/api/checkout', fail.token, { idempotencyKey: 'cc-declined-key1', paymentToken: 'tok_declined' });
    expect((await call('GET', '/api/admin/command-centre', ops)).json().attention.failed_payments).toHaveLength(1);
    const detail = (await call('GET', `/api/admin/orders/${orderId}`, ops)).json().order;
    expect(detail.customer.email).toBeTruthy(); expect(detail.payment.provider).toBe('sandbox'); expect(detail.suborders[0].financials.vendor_net).toBeGreaterThan(0);
    // operational status change is validated by the state machine and audited, internal notes are recorded
    const sid = detail.suborders[0].id;
    expect((await call('POST', `/api/admin/suborders/${sid}/status`, ops, { status: 'preparing', note: 'Vendor phoned in' })).statusCode).toBe(409);
    expect((await call('POST', `/api/admin/suborders/${sid}/status`, ops, { status: 'vendor_accepted', note: 'Accepted by phone' })).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/orders/${orderId}/notes`, ops, { note: 'Customer called, wants a receipt.' })).statusCode).toBe(200);
    expect((await call('GET', `/api/admin/orders/${orderId}`, ops)).json().order.internal_notes[0].changes.note).toContain('receipt');
    expect((await call('POST', `/api/admin/suborders/${sid}/cancel`, ops, { reason: 'Customer request' })).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/suborders/${sid}/refund`, ops, { fullItems: true, reason: 'x', bearer: 'platform' })).statusCode).toBe(403);   // ops cannot refund
    // search and filter orders
    const list = (await call('GET', `/api/admin/orders?q=${detail.number}&status=cancelled`, ops)).json().orders;
    expect(list).toHaveLength(1);
  });
  it('searches the marketplace with results limited to what the staff role may see', async () => {
    const v = await makeVendor({ name: 'Zanzibar Spice House' }); const p = await makeProduct(v.id, v.ownerId, { name: 'Zanzibar Pepper', price: 5, stock: 5 });
    const c = await makeCustomer(); await query("UPDATE users SET full_name = 'Zanzibar Zed' WHERE id = $1", [c.id]);
    const d = await makeDriver(); await query("UPDATE driver_profiles SET legal_name = 'Zanzibar Driver' WHERE user_id = $1", [d.id]);
    const sup = await makeStaff('customer_support'), fin = await makeStaff('finance_admin'), mk = await makeStaff('marketing_manager'), admin = await makeStaff('super_admin');
    const search = async (u: any, q = 'zanzibar') => (await call('GET', `/api/admin/search?q=${q}`, await loginToken(u.email))).json().results;
    const all = await search(admin);
    expect(Object.keys(all).sort()).toEqual(expect.arrayContaining(['customers', 'drivers', 'products', 'vendors']));
    const s = await search(sup);
    expect(s.vendors).toBeTruthy(); expect(s.customers).toBeTruthy(); expect(s.drivers).toBeTruthy();
    const f = await search(fin);
    expect(f.customers).toBeUndefined(); expect(f.vendors).toBeTruthy();
    const m = await search(mk);
    expect(m.customers).toBeUndefined(); expect(m.drivers).toBeUndefined(); expect(m.vendors).toBeTruthy();
    expect((await call('GET', '/api/admin/search?q=zan', (await loginToken((await makeUser('customer')).email)))).statusCode).toBe(403);
    expect((await call('GET', '/api/admin/search?q=a', await loginToken(admin.email))).statusCode).toBe(400);
    const sku = (await one<any>('SELECT sku FROM product_variants WHERE product_id = $1', [p.id]))!.sku;
    expect((await search(admin, sku)).products[0].title).toBe('Zanzibar Pepper');            // find by SKU
    void commandCentre; void globalSearch;
  });
  it('manages staff accounts, roles and permissions without locking everyone out', async () => {
    const root = await makeStaff('super_admin');
    const rt = await loginToken(root.email);
    const staffEmail = `new.staff.${Date.now()}@test.eazyfoods.test`;
    const mk = await call('POST', '/api/admin/staff', rt, { email: staffEmail, full_name: 'New Staffer', password: 'Passw0rd!long', role: 'content_manager' });
    expect(mk.statusCode).toBe(201);
    expect((await call('POST', '/api/admin/staff', rt, { email: 'x@y.co', full_name: 'Bad Role', password: 'Passw0rd!long', role: 'customer' })).statusCode).toBe(400);
    const st = await loginToken(staffEmail, 'Passw0rd!long');
    expect((await call('GET', '/api/marketing/articles', st)).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/orders', st)).statusCode).toBe(403);
    // grant an extra role and edit role permissions
    expect((await call('POST', `/api/admin/users/${mk.json().user.id}/roles`, rt, { role: 'customer_support' })).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/orders', await loginToken(staffEmail, 'Passw0rd!long'))).statusCode).toBe(200);
    expect((await call('PUT', '/api/admin/roles/content_manager/permissions', rt, { permissions: ['content.manage', 'orders.read'] })).statusCode).toBe(200);
    expect((await call('PUT', '/api/admin/roles/content_manager/permissions', rt, { permissions: ['made.up'] })).statusCode).toBe(400);
    expect((await call('PUT', '/api/admin/roles/super_admin/permissions', rt, { permissions: [] })).statusCode).toBe(403);
    expect((await call('PUT', '/api/admin/roles/customer/permissions', rt, { permissions: ['orders.read'] })).statusCode).toBe(403);
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'role.permissions_changed'")).toBeTruthy();
    // revoking removes access and sessions
    expect((await call('DELETE', `/api/admin/users/${mk.json().user.id}/roles/customer_support`, rt)).statusCode).toBe(200);
    expect((await call('GET', '/api/auth/me', st)).json().user).toBeNull();
    // the last super admin cannot be removed
    const only = await query<any>("SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin'");
    for (const o of only.filter((x: any) => x.user_id !== root.id)) await call('DELETE', `/api/admin/users/${o.user_id}/roles/super_admin`, rt);
    expect((await call('DELETE', `/api/admin/users/${root.id}/roles/super_admin`, rt)).statusCode).toBe(403);
    // a role manager who is not a super admin cannot mint one
    const sup2 = await makeStaff('customer_support');
    await query("INSERT INTO role_permissions(role_id, permission_key) SELECT id, 'roles.manage' FROM roles WHERE key = 'customer_support' ON CONFLICT DO NOTHING");
    expect((await call('POST', `/api/admin/users/${sup2.id}/roles`, await loginToken(sup2.email), { role: 'super_admin' })).statusCode).toBe(403);
    // suspending customers
    const c = await makeCustomer();
    expect((await call('POST', `/api/admin/users/${c.id}/suspend`, rt, {})).statusCode).toBe(400);
    expect((await call('POST', `/api/admin/users/${c.id}/suspend`, rt, { reason: 'Chargeback abuse' })).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/users/${root.id}/suspend`, rt, { reason: 'oops' })).statusCode).toBe(403);
  });
});

describe('analytics', () => {
  it('computes marketplace, vendor, chef and customer analytics from real data', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 50, stock: 100, tax: 'zero_rated' });
    const chef = await makeVendor({ type: 'chef', capacity: 10 });
    const cp = await makeProduct(chef.id, chef.ownerId, { name: 'Chef Dish', type: 'chef_meal', price: 20, tax: 'prepared' });
    const c = await cust();
    const vt = await loginToken(v.ownerEmail);
    for (let i = 0; i < 2; i++) {
      const orderId = await buy(c, v, p, 2);
      const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [orderId]))!;
      for (const a of ['accept', 'prepare', 'ready']) await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/${a}`, vt, {});
      await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/collect`, vt, { code: sub.pickup_code });
    }
    await buy(c, chef, cp, 1);
    const pa = await platformAnalytics(30);
    expect(pa.orders).toBeGreaterThanOrEqual(3);
    expect(pa.gmv).toBeGreaterThan(200);
    expect(pa.revenue.commission).toBeGreaterThan(20);
    expect(pa.average_order_value).toBeGreaterThan(0);
    expect(pa.customers.new).toBeGreaterThan(0);
    expect(pa.series.length).toBeGreaterThan(0);
    const va = await vendorAnalytics(v.id, 30);
    expect(va.orders).toBe(2); expect(va.sales.period).toBe(200); expect(va.sales.net_after_fees).toBeCloseTo(176, 2);
    expect(va.best_products[0].name).toContain('Product'); expect(va.today.completed).toBe(2);
    expect((await call('GET', `/api/vendors/${v.id}/analytics`, vt)).json().orders).toBe(2);
    const ca = await chefAnalytics(chef.id, 30);
    expect(ca.capacity).toMatchObject({ daily_capacity: 10, used_today: 1, utilization_pct: 10 });
    const cu = await customerAnalytics(c.id);
    expect(cu.orders).toBe(3); expect(cu.favourite_vendors[0].orders).toBe(2);
    const at = await loginToken((await makeStaff('finance_admin')).email);
    expect((await call('GET', '/api/admin/analytics?days=30', at)).json().orders).toBeGreaterThanOrEqual(3);
    expect((await call('GET', '/api/customers/me/insights', c.token)).json().orders).toBe(3);
  });
});

describe('risk signals', () => {
  it('raises signals for review without blocking anyone', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 20, stock: 100, tax: 'zero_rated' });
    const c = await cust();
    await setSetting('fraud', { coupon_redemptions_7d: 2 }, null);
    try {
      const order = await buy(c, v, p, 1);
      const o = (await one<any>('SELECT id FROM orders WHERE id = $1', [order]))!;
      const promo = await one<any>("INSERT INTO promotions(name, code, type, value, status) VALUES ('Risk','RISK1','percent',5,'active') RETURNING id");
      for (let i = 0; i < 2; i++) { const oid = await buy(c, v, p, 1); await query('INSERT INTO promotion_redemptions(promotion_id, user_id, order_id, amount) VALUES ($1,$2,$3,1)', [promo!.id, c.id, oid]); }
      expect(await scanOrder(o.id)).toBeGreaterThan(0);
    } finally { await setSetting('fraud', { coupon_redemptions_7d: 5 }, null); clearSettingsCache(); }
    const sig = await one<any>("SELECT * FROM risk_signals WHERE kind = 'high_coupon_usage'");
    expect(sig).toMatchObject({ subject_type: 'customer', subject_id: c.id, status: 'open' });
    expect((await one<any>('SELECT status FROM users WHERE id = $1', [c.id]))!.status).toBe('active');           // nothing automatic
    expect((await call('GET', '/api/auth/me', c.token)).json().user).toBeTruthy();
    expect(await scanOrder((await one<any>('SELECT id FROM orders WHERE user_id = $1 LIMIT 1', [c.id]))!.id)).toBe(0);   // deduplicated
    // a shared phone number between accounts is a signal, not an accusation
    const a = await makeUser('customer', { phone: '416-555-7777' }); await makeUser('customer', { phone: '416-555-7777' }); await makeUser('customer', { phone: '416-555-7777' });
    await query('INSERT INTO orders(number, user_id, subtotal, total, amount_charged) VALUES ($1,$2,5,5,5)', ['X-77', a.id]);
    await scanOrder((await one<any>("SELECT id FROM orders WHERE number = 'X-77'"))!.id);
    expect(await one("SELECT 1 FROM risk_signals WHERE kind = 'multiple_accounts'")).toBeTruthy();
    // vendor cancellations
    const bad = await makeVendor();
    for (let i = 0; i < 12; i++) await query("INSERT INTO suborders(order_id, vendor_id, suffix, number, fulfillment_type, items_subtotal, customer_total, status, cancelled_by, created_at) SELECT o.id, $1, $5, $2, 'pickup', 1, 1, $3, $4, now() FROM (SELECT id FROM orders ORDER BY number LIMIT 1) o",
      [bad.id, `BAD-${i}`, i < 5 ? 'cancelled' : 'completed', i < 5 ? 'vendor' : null, `Z${i}`]);
    expect(await scanPlatform()).toBeGreaterThan(0);
    expect(await one("SELECT 1 FROM risk_signals WHERE kind = 'high_cancellation_rate' AND subject_id = $1", [bad.id])).toBeTruthy();
    // staff review
    const fr = await makeStaff('operations_admin');
    expect((await call('GET', '/api/admin/risk', await loginToken(fr.email))).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/risk/${sig!.id}/review`, await loginToken(fr.email), { status: 'dismissed' })).statusCode).toBe(403);   // read only role
    const mgr = await makeStaff('super_admin');
    expect((await call('POST', `/api/admin/risk/${sig!.id}/review`, await loginToken(mgr.email), { status: 'actioned' })).statusCode).toBe(400);      // action needs a note
    expect((await call('POST', `/api/admin/risk/${sig!.id}/review`, await loginToken(mgr.email), { status: 'dismissed', note: 'Legitimate promotion launch' })).statusCode).toBe(200);
  });
});

describe('security', () => {
  it('accepts only real images and PDFs by content, with size limits and private documents', async () => {
    const c = await cust();
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100', 'hex');
    const boundary = '----ezboundary';
    const multipart = (name: string, data: Buffer, purpose = 'image') => ({
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...bearer(c.token) },
    });
    const ok = await app.inject({ method: 'POST', url: '/api/files', ...multipart('photo.png', png) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().mime).toBe('image/png');
    const served = await app.inject({ method: 'GET', url: ok.json().url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png'); expect(served.headers['x-content-type-options']).toBe('nosniff');
    const script = await app.inject({ method: 'POST', url: '/api/files', ...multipart('evil.png', Buffer.from('<script>alert(1)</script>')) });   // lies about its type
    expect(script.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/files', ...multipart('x.png', Buffer.alloc(0)) })).statusCode).toBe(400);
    const big = await app.inject({ method: 'POST', url: '/api/files', ...multipart('big.png', Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)])) });
    expect([400, 413]).toContain(big.statusCode);
    expect((await app.inject({ method: 'POST', url: '/api/files', payload: multipart('a.png', png).payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } })).statusCode).toBe(401);
    // documents are private to the owner and reviewers
    const doc = await app.inject({ method: 'POST', url: '/api/files', ...multipart('licence.png', png, 'document') });
    expect(doc.statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: doc.json().url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: doc.json().url, headers: bearer((await cust()).token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: doc.json().url, headers: bearer(c.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: doc.json().url, headers: bearer(await loginToken((await makeStaff('compliance_officer')).email)) })).statusCode).toBe(200);
  });
  it('rate limits sensitive endpoints when strict limits are on', async () => {
    const strict = await buildApp({ strictLimits: true });
    await strict.ready();
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await strict.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@test.eazyfoods.test', password: 'wrong-pass-1' } })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toContain(429);
    await strict.close();
  });
  it('never leaks internals in errors and sets security headers', async () => {
    const r = await call('GET', '/api/orders/not-a-uuid', (await cust()).token);
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).not.toMatch(/uuid|select |pg_|stack|syntax/i);
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.headers['x-content-type-options']).toBe('nosniff'); expect(h.headers['x-frame-options']).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/api/does-not-exist' })).json().error.code).toBe('NOT_FOUND');
    const huge = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.co', password: 'x'.repeat(2_000_000) } });
    expect([400, 413]).toContain(huge.statusCode);
  });
  it('protects idor style access to other customers orders, addresses and carts', async () => {
    const a = await cust(), b = await cust();
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 10, stock: 10 });
    const order = await buy(a, v, p, 1);
    expect((await call('GET', `/api/orders/${order}`, b.token)).statusCode).toBe(404);
    expect((await call('POST', `/api/orders/${order}/pay`, b.token, { paymentToken: 'tok_visa' })).statusCode).toBe(404);
    expect((await call('PUT', `/api/customers/me/addresses/${a.addressId}`, b.token, { line1: '1 Hacker Way', city: 'Toronto', region: 'ON', postal_code: 'M4W 1A1' })).statusCode).toBe(404);
    expect((await call('DELETE', `/api/customers/me/addresses/${a.addressId}`, b.token)).statusCode).toBe(404);
    await call('POST', '/api/carts/items', b.token, { variantId: p.variantId, qty: 1 });
    expect((await call('PATCH', '/api/carts/options', b.token, { addressId: a.addressId })).statusCode).toBe(404);          // someone else's address is never accepted
    expect((await call('GET', '/api/carts/current', b.token)).statusCode).toBe(200);
  });
});

describe('background jobs and real time', () => {
  it('runs queued jobs with retries, backoff and unique keys, and honours schedules', async () => {
    let attempts = 0, ran = 0;
    registerJob('t_flaky', async () => { attempts++; if (attempts < 3) throw new Error('temporary failure'); });
    registerJob('t_once', async () => { ran++; });
    await enqueue('t_flaky', {}, { maxAttempts: 4 });
    await runDueJobs(1000);
    expect(attempts).toBe(1);
    let j = await one<any>("SELECT status, attempts, last_error, run_at > now() AS later FROM jobs WHERE name = 't_flaky'");
    expect(j).toMatchObject({ status: 'queued', attempts: 1, last_error: 'temporary failure', later: true });       // backed off
    await query("UPDATE jobs SET run_at = now() WHERE name = 't_flaky'");
    await runDueJobs(1000); await query("UPDATE jobs SET run_at = now() WHERE name = 't_flaky'"); await runDueJobs(1000);
    j = await one<any>("SELECT status FROM jobs WHERE name = 't_flaky'");
    expect(j!.status).toBe('done'); expect(attempts).toBe(3);
    await enqueue('t_once', {}, { uniqueKey: 'only-one' }); await enqueue('t_once', {}, { uniqueKey: 'only-one' });
    await runDueJobs(1000);
    expect(ran).toBe(1);
    registerJob('t_dead', async () => { throw new Error('always'); });
    await enqueue('t_dead', {}, { maxAttempts: 1 });
    await runDueJobs(1000);
    expect((await one<any>("SELECT status FROM jobs WHERE name = 't_dead'"))!.status).toBe('failed');
    let ticks = 0; schedule('t_sched', 3600, async () => { ticks++; });
    await tickSchedules(); await runDueJobs(1000); await tickSchedules(); await runDueJobs(1000);
    expect(ticks).toBe(1);                                                                                      // interval not elapsed yet
    expect(SCHEDULES['expire_unpaid_orders']).toBe(60);
    expect(SCHEDULES['payout_cycle']).toBeGreaterThan(0);
    expect(Object.keys(SCHEDULES)).toEqual(expect.arrayContaining(['document_expiry', 'abandoned_carts', 'promotion_lifecycle', 'analytics_rollup', 'fraud_scan', 'subscription_billing']));
  });
  it('delivers notifications through email, sms and push by preference, using the dev outbox locally', async () => {
    const c = await cust();
    await query("UPDATE users SET phone = '416-555-0999' WHERE id = $1", [c.id]);
    await query("INSERT INTO push_tokens(user_id, token) VALUES ($1, 'fcm-token-1234567890')", [c.id]);
    const { notify } = await import('../src/lib/notifications.js');
    await notify({ userId: c.id, kind: 'driver_arriving', title: 'Driver at the store', body: 'Your driver is here.' });
    await runDueJobs(1000);
    const out = await query<any>('SELECT channel, provider FROM message_outbox WHERE user_id = $1 ORDER BY channel', [c.id]);
    expect(out.map((o: any) => o.channel)).toEqual(['push', 'sms']);                                              // policy: sms + push, no email
    expect(out.every((o: any) => o.provider === 'dev')).toBe(true);
    await call('PUT', '/api/notifications/preferences', c.token, { kind: 'driver_arriving', email: true, sms: false, push: false });
    await notify({ userId: c.id, kind: 'driver_arriving', title: 'Again', body: 'Second' });
    await runDueJobs(1000);
    expect((await query<any>("SELECT channel FROM message_outbox WHERE user_id = $1 AND subject = 'Again'", [c.id])).map((o: any) => o.channel)).toEqual(['email']);
    const inapp = (await call('GET', '/api/notifications', c.token)).json();
    expect(inapp.unread).toBe(2);
    await call('POST', '/api/notifications/read', c.token, {});
    expect((await call('GET', '/api/notifications', c.token)).json().unread).toBe(0);
  });
  it('streams real time events over server sent events with topic authorization', async () => {
    await stopEventBridge();
    await startEventBridge();
    const server = http.createServer((req, res) => { app.routing(req, res); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const c = await cust();
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 10, stock: 10 });
    const orderId = await buy(c, v, p, 1);
    const sub = (await one<any>('SELECT id FROM suborders WHERE order_id = $1', [orderId]))!;
    const events: string[] = [];
    const req = http.get({ host: '127.0.0.1', port, path: `/api/stream?topics=order:${orderId}`, headers: bearer(c.token) }, (res) => {
      expect(res.statusCode).toBe(200); expect(res.headers['content-type']).toContain('text/event-stream');
      res.setEncoding('utf8'); res.on('data', (d: string) => events.push(d));
    });
    await new Promise((r) => setTimeout(r, 300));
    const vt = await loginToken(v.ownerEmail);
    await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/accept`, vt, {});
    await new Promise((r) => setTimeout(r, 500));
    req.destroy();
    const text = events.join('');
    expect(text).toContain('event: ready');
    expect(text).toContain('event: suborder.status');
    expect(text).toContain('"status":"vendor_accepted"');
    // another customer cannot subscribe to this order, and anonymous users cannot stream at all
    const other = await cust();
    expect((await app.inject({ method: 'GET', url: `/api/stream?topics=order:${orderId}`, headers: bearer(other.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/stream?topics=admin', headers: bearer(c.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/stream' })).statusCode).toBe(401);
    await new Promise<void>((r) => server.close(() => r()));
    await stopEventBridge();
    void publish;
  });
});
