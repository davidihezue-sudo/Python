import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeStaff, loginToken, bearer, query, one, actorOf, tx } from './helpers.js';
import { reserve, releaseOrder, commitOrder, adjust } from '../src/modules/inventory.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });

const call = async (method: string, url: string, token: string | null, payload?: any, headers: any = {}) =>
  app.inject({ method: method as any, url, payload, headers: { ...(token ? bearer(token) : {}), ...headers } });
async function customerWithToken() {
  const c = await makeCustomer();
  const email = (await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email;
  return { ...c, token: await loginToken(email) };
}
const addToCart = (token: string, variantId: string, qty = 1) => call('POST', '/api/carts/items', token, { variantId, qty });

describe('product creation', () => {
  it('lets an approved vendor create a product with variants, images and barcodes', async () => {
    const v = await makeVendor();
    const t = await loginToken(v.ownerEmail);
    const r = await call('POST', `/api/vendors/${v.id}/products`, t, {
      name: 'Parboiled Rice', product_type: 'dry', status: 'active', tax_class: 'zero_rated', allergens: [], dietary: ['Vegan'], images: [{ url: '/img/food/grains.svg' }],
      variants: [{ name: '2 kg', price: 9.99, stock: 20, barcode: '6291001234567' }, { name: '5 kg', price: 21.5, sale_price: 19.99, stock: 8 }],
    });
    expect(r.statusCode).toBe(201);
    const variants = await query<any>('SELECT name, sku, barcode, price, sale_price, is_default FROM product_variants WHERE product_id = $1 ORDER BY position', [r.json().product.id]);
    expect(variants).toHaveLength(2);
    expect(variants[0].sku).toMatch(/^EZ-[A-Z0-9]{3}-[A-F0-9]{6}$/);
    expect(variants[0].is_default).toBe(true);
    const inv = await one<any>('SELECT on_hand, reserved FROM inventory WHERE variant_id = (SELECT id FROM product_variants WHERE sku = $1)', [variants[0].sku]);
    expect(inv).toMatchObject({ on_hand: 20, reserved: 0 });
    const audit = await one<any>("SELECT actor_user_id FROM audit_logs WHERE action = 'product.created' AND entity_id = $1", [r.json().product.id]);
    expect(audit!.actor_user_id).toBe(v.ownerId);
  });
  it('rejects invalid prices, duplicate barcodes and publishing before approval', async () => {
    const v = await makeVendor();
    const t = await loginToken(v.ownerEmail);
    const base = { name: 'Thing', product_type: 'dry', variants: [{ name: 'One', price: 5, stock: 1, barcode: '7000000000001' }] };
    expect((await call('POST', `/api/vendors/${v.id}/products`, t, { ...base, variants: [{ name: 'One', price: 5, sale_price: 9 }] })).statusCode).toBe(400);
    expect((await call('POST', `/api/vendors/${v.id}/products`, t, { ...base, variants: [{ name: 'One', price: -1 }] })).statusCode).toBe(400);
    expect((await call('POST', `/api/vendors/${v.id}/products`, t, base)).statusCode).toBe(201);
    const dupe = await call('POST', `/api/vendors/${v.id}/products`, t, { ...base, name: 'Other' });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error.code).toBe('BARCODE_IN_USE');
    const pending = await makeVendor({ approved: false });
    const tp = await loginToken(pending.ownerEmail);
    const pub = await call('POST', `/api/vendors/${pending.id}/products`, tp, { ...base, status: 'active' });
    expect(pub.statusCode).toBe(409);
    expect(pub.json().error.code).toBe('NOT_APPROVED');
    expect((await call('POST', `/api/vendors/${pending.id}/products`, tp, { ...base, status: 'draft' })).statusCode).toBe(201);
  });
  it('records price changes with who and when', async () => {
    const v = await makeVendor();
    const t = await loginToken(v.ownerEmail);
    const p = await makeProduct(v.id, v.ownerId, { price: 10 });
    const r = await call('PUT', `/api/vendors/${v.id}/products/${p.id}`, t, { variants: [{ id: p.variantId, name: 'Default', price: 12.5, stock: 50 }] });
    expect(r.statusCode).toBe(200);
    const h = await one<any>('SELECT old_price, new_price, changed_by FROM price_history WHERE variant_id = $1 ORDER BY id DESC LIMIT 1', [p.variantId]);
    expect(Number(h!.old_price)).toBe(10); expect(Number(h!.new_price)).toBe(12.5); expect(h!.changed_by).toBe(v.ownerId);
    const a = await one<any>("SELECT changes FROM audit_logs WHERE action = 'product.price_changed' AND entity_id = $1", [p.id]);
    expect(a!.changes.to.price).toBe(12.5);
  });
});

describe('inventory', () => {
  it('prevents overselling when many checkouts race for the last units', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { stock: 5 });
    const customers = await Promise.all(Array.from({ length: 8 }, () => customerWithToken()));
    const results = await Promise.all(customers.map(async (c) => {
      await addToCart(c.token, p.variantId, 1);
      await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
      return call('POST', '/api/checkout', c.token, { idempotencyKey: 'key-race--0001' + c.id, paymentToken: 'tok_visa' });
    }));
    const ok = results.filter((r) => r.statusCode === 201).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.statusCode === 409).length).toBe(3);
    const inv = await one<any>('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [p.variantId]);
    expect(inv!.on_hand).toBe(0);                                 // committed on payment
    expect(inv!.reserved).toBe(0);
  });
  it('reserves, commits and releases stock with a full movement history', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { stock: 10 });
    const c = await makeCustomer();
    const { rows } = await import('../src/db.js').then((m) => m.pool.query("INSERT INTO orders(number, user_id, subtotal, total, amount_charged) VALUES ('T-1', $1, 0, 0, 0) RETURNING id", [c.id]));
    const orderId = rows[0].id;
    await tx((cl) => reserve(cl, [{ variantId: p.variantId, qty: 4 }], orderId, null));
    expect(await one('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [p.variantId])).toMatchObject({ on_hand: 10, reserved: 4 });
    await tx((cl) => commitOrder(cl, orderId));
    expect(await one('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [p.variantId])).toMatchObject({ on_hand: 6, reserved: 0 });
    await tx((cl) => reserve(cl, [{ variantId: p.variantId, qty: 3 }], orderId, null));
    await tx((cl) => releaseOrder(cl, orderId));
    expect(await one('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [p.variantId])).toMatchObject({ on_hand: 6, reserved: 0 });
    const moves = await query<any>('SELECT kind, delta_on_hand, delta_reserved FROM inventory_movements WHERE ref_id = $1 ORDER BY id', [orderId]);
    expect(moves.map((m: any) => m.kind)).toEqual(['reserve', 'commit', 'reserve', 'release']);
    await expect(tx((cl) => reserve(cl, [{ variantId: p.variantId, qty: 7 }], orderId, null))).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
  it('audits manual adjustments, damaged and expired stock, and protects reserved units', async () => {
    const v = await makeVendor();
    const t = await loginToken(v.ownerEmail);
    const p = await makeProduct(v.id, v.ownerId, { stock: 10 });
    const adj = (body: any) => call('POST', `/api/vendors/${v.id}/inventory/adjust`, t, { variantId: p.variantId, ...body });
    expect((await adj({ kind: 'receive', qty: 5, batchCode: 'B1', expiryDate: '2027-01-01', reason: 'Delivery' })).json()).toMatchObject({ onHand: 15 });
    expect((await adj({ kind: 'damaged', qty: 2, reason: 'Dropped pallet' })).json()).toMatchObject({ onHand: 13 });
    expect((await adj({ kind: 'expired', qty: 1 })).json()).toMatchObject({ onHand: 12 });
    expect((await adj({ kind: 'correction', newOnHand: 20, reason: 'Stock take' })).json()).toMatchObject({ onHand: 20 });
    expect((await adj({ kind: 'adjust_remove', qty: 0 })).statusCode).toBe(400);
    const inv = await one<any>('SELECT damaged, expired FROM inventory WHERE variant_id = $1', [p.variantId]);
    expect(inv).toMatchObject({ damaged: 2, expired: 1 });
    const moves = await call('GET', `/api/vendors/${v.id}/inventory/${p.variantId}/movements`, t);
    expect(moves.json().movements.map((m: any) => m.kind)).toEqual(['correction', 'expired', 'damaged', 'receive', 'initial']);
    expect(moves.json().movements[0].actor).toBeTruthy();
    expect(moves.json().batches[0].batch_code).toBe('B1');
    // cannot take stock below what open orders have reserved
    await query('UPDATE inventory SET reserved = 18 WHERE variant_id = $1', [p.variantId]);
    expect((await adj({ kind: 'adjust_remove', qty: 5 })).json().error.code).toBe('RESERVED_STOCK');
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'inventory.adjusted' AND entity_id = $1", [p.variantId])).toBeTruthy();
  });
  it('finds products by barcode or SKU for scanning and sends low stock alerts', async () => {
    const v = await makeVendor();
    const t = await loginToken(v.ownerEmail);
    const created = await call('POST', `/api/vendors/${v.id}/products`, t, { name: 'Scanned Item', product_type: 'dry', status: 'active', variants: [{ name: 'Pack', price: 4.5, stock: 6, barcode: '6291009999991', reorder_threshold: 5 }] });
    const sku = (await one<any>('SELECT sku FROM product_variants WHERE product_id = $1', [created.json().product.id]))!.sku;
    for (const code of ['6291009999991', sku.toLowerCase()]) {
      const r = await call('GET', `/api/vendors/${v.id}/inventory/lookup?code=${code}`, t);
      expect(r.statusCode).toBe(200);
      expect(r.json().items[0]).toMatchObject({ product_name: 'Scanned Item', on_hand: 6, available: 6, price: 4.5 });
    }
    expect((await call('GET', `/api/vendors/${v.id}/inventory/lookup?code=000000`, t)).statusCode).toBe(404);
    const other = await makeVendor();
    expect((await call('GET', `/api/vendors/${other.id}/inventory/lookup?code=6291009999991`, await loginToken(other.ownerEmail))).statusCode).toBe(404);   // scoped to the vendor
    await call('POST', `/api/vendors/${v.id}/inventory/adjust`, t, { variantId: (await one<any>('SELECT id FROM product_variants WHERE sku = $1', [sku]))!.id, kind: 'adjust_remove', qty: 3, reason: 'Sold in store' });
    const n = await one<any>("SELECT title FROM notifications WHERE user_id = $1 AND kind = 'low_inventory'", [v.ownerId]);
    expect(n!.title).toBe('Low inventory');
  });
});

describe('cart and multi-vendor checkout', () => {
  let A: any, B: any, C: any, pa: any, pb: any, pc: any;
  beforeEach(async () => {
    A = await makeVendor({ name: 'Vendor A', lat: 43.67, lng: -79.40 });
    B = await makeVendor({ name: 'Vendor B', lat: 43.70, lng: -79.45 });
    C = await makeVendor({ name: 'Vendor C Kitchen', type: 'prepared', lat: 43.64, lng: -79.38 });
    pa = await makeProduct(A.id, A.ownerId, { name: 'Rice', price: 12.99, stock: 30, tax: 'zero_rated' });
    pb = await makeProduct(B.id, B.ownerId, { name: 'Frozen Meat', type: 'frozen', price: 19.5, stock: 30, tax: 'zero_rated' });
    pc = await makeProduct(C.id, C.ownerId, { name: 'Jollof Meal', type: 'prepared', price: 17, tax: 'prepared', variants: [{ name: 'Regular', price: 17 }, { name: 'Family', price: 54 }] });
  });

  it('keeps a guest cart in the browser session and merges it on sign in', async () => {
    const g = await app.inject({ method: 'POST', url: '/api/carts/items', payload: { variantId: pa.variantId, qty: 2 } });
    expect(g.statusCode).toBe(200);
    const cookie = String(g.headers['set-cookie']).match(/ez_cart=[^;]+/)![0];
    const view = await app.inject({ method: 'GET', url: '/api/carts/current', headers: { cookie } });
    expect(view.json().cart.itemCount).toBe(2);
    const c = await makeCustomer();
    const email = (await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'EazyDemo!2026' }, headers: { cookie } });
    const t = login.json().token;
    expect((await call('GET', '/api/carts/current', t)).json().cart.itemCount).toBe(2);
  });

  it('shows vendor grouping, delivery options and every fee with warnings for problems', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 2); await addToCart(c.token, pb.variantId, 1); await addToCart(c.token, pc.variantId, 1);
    const r = await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
    const q = r.json().cart.quote;
    expect(q.groups).toHaveLength(3);
    expect(q.groups.map((g: any) => g.vendorName).sort()).toEqual(['Vendor A', 'Vendor B', 'Vendor C Kitchen']);
    expect(q.groups.every((g: any) => g.delivery.available && g.deliveryFee > 0 && g.etaAt)).toBe(true);
    expect(q.totals.total).toBeCloseTo(q.groups.reduce((s: number, g: any) => s + g.customerTotal, 0), 2);
    expect(q.totals.tax).toBeGreaterThan(0);
    expect(q.canCheckout).toBe(true);
    // stock goes away
    await query('UPDATE inventory SET on_hand = 1 WHERE variant_id = $1', [pa.variantId]);
    const warn = await call('GET', '/api/carts/current', c.token);
    expect(warn.json().cart.quote.canCheckout).toBe(false);
    expect(warn.json().cart.quote.blockers[0].message).toMatch(/Only 1 of Rice left/);
    await query('UPDATE vendors SET accepting_orders = false WHERE id = $1', [B.id]);
    expect((await call('GET', '/api/carts/current', c.token)).json().cart.quote.blockers.map((b: any) => b.code)).toContain('VENDOR_PAUSED');
  });

  it('splits one checkout into vendor suborders with consistent money and reserves stock', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 2); await addToCart(c.token, pb.variantId, 1); await addToCart(c.token, pc.variants[1].id, 1);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId, tip: 4 });
    const quote = (await call('GET', '/api/carts/current', c.token)).json().cart.quote;
    const r = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'key-multi-1-0001', paymentToken: 'tok_visa', expectedTotal: quote.totals.total });
    expect(r.statusCode).toBe(201);
    const order = await one<any>('SELECT * FROM orders WHERE id = $1', [r.json().orderId]);
    expect(order.number).toMatch(/^EAZ-\d{5}$/);
    expect(order.status).toBe('confirmed');
    expect(order.payment_status).toBe('paid');
    expect(Number(order.total)).toBeCloseTo(quote.totals.total, 2);
    const subs = await query<any>('SELECT * FROM suborders WHERE order_id = $1 ORDER BY suffix', [order.id]);
    expect(subs.map((s: any) => s.number)).toEqual([`${order.number}-A`, `${order.number}-B`, `${order.number}-C`]);
    expect(subs.every((s: any) => s.status === 'confirmed')).toBe(true);
    const sum = (k: string) => subs.reduce((t: number, s: any) => t + Number(s[k]), 0);
    expect(sum('customer_total')).toBeCloseTo(Number(order.total), 2);
    expect(sum('tax_total')).toBeCloseTo(Number(order.tax_total), 2);
    expect(sum('service_fee')).toBeCloseTo(Number(order.service_fee_total), 2);
    expect(sum('tip')).toBeCloseTo(4, 2);
    for (const s of subs) expect(Number(s.customer_total)).toBeCloseTo(Number(s.items_subtotal) - Number(s.vendor_discount) - Number(s.platform_discount) + Number(s.tax_total) + Number(s.delivery_fee) - Number(s.delivery_subsidy_vendor) - Number(s.delivery_subsidy_platform) + Number(s.service_fee) + Number(s.tip), 2);
    expect((await one<any>('SELECT on_hand FROM inventory WHERE variant_id = $1', [pa.variantId]))!.on_hand).toBe(28);
    expect(await query('SELECT id FROM delivery_jobs WHERE order_id = $1', [order.id])).toHaveLength(3);           // one delivery job per suborder
    // each vendor sees only its own part
    const ta = await loginToken(A.ownerEmail);
    const list = (await call('GET', `/api/vendors/${A.id}/orders`, ta)).json().orders;
    expect(list).toHaveLength(1);
    expect(list[0].number).toBe(`${order.number}-A`);
    expect(list[0].summary).toContain('Rice');
    expect(list[0].summary).not.toContain('Frozen');
    const detail = (await call('GET', `/api/vendors/${A.id}/orders/${list[0].id}`, ta)).json().order;
    expect(detail.customer.first_name).toBe('Amara');
    expect(JSON.stringify(detail)).not.toMatch(/davenport|@test\.eazyfoods/i);          // no street address or email for the vendor
    expect((await call('GET', `/api/vendors/${A.id}/orders/${subs[1].id}`, ta)).statusCode).toBe(404);   // another vendor's suborder
    // the customer sees all three
    const view = (await call('GET', `/api/orders/${order.id}`, c.token)).json().order;
    expect(view.suborders).toHaveLength(3);
    expect(view.suborders[0].timeline.find((s: any) => s.key === 'paid').done).toBe(true);
    // every notification went out and vendors were told
    expect(await query("SELECT 1 FROM notifications WHERE kind = 'new_order' AND data->>'orderId' = $1", [order.id])).toHaveLength(3);
    // another customer cannot see it
    const other = await customerWithToken();
    expect((await call('GET', `/api/orders/${order.id}`, other.token)).statusCode).toBe(404);
    expect((await call('POST', `/api/orders/${order.id}/cancel`, other.token, {})).statusCode).toBe(404);
  });

  it('is idempotent: repeating a checkout never creates or charges a second order', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
    const first = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'idem-key-1', paymentToken: 'tok_visa' });
    const again = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'idem-key-1', paymentToken: 'tok_visa' });
    expect(first.statusCode).toBe(201);
    expect(again.json().orderId).toBe(first.json().orderId);
    expect((await one<any>('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [first.json().orderId]))!.n).toBe(1);
  });

  it('handles declined cards without charging, keeps the order payable, and releases stock when it expires', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 3);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
    const fail = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'decline-1', paymentToken: 'tok_declined' });
    expect(fail.statusCode).toBe(402);
    expect(fail.json().error.code).toBe('PAYMENT_FAILED');
    expect(fail.json().error.message).toContain('your card was not charged');
    expect(JSON.stringify(fail.json())).not.toMatch(/sandbox|decline_code|card_declined/);
    const orderId = fail.json().error.details.orderId;
    expect((await one<any>('SELECT status, payment_status FROM orders WHERE id = $1', [orderId]))).toMatchObject({ status: 'pending_payment', payment_status: 'failed' });
    expect((await one<any>('SELECT reserved FROM inventory WHERE variant_id = $1', [pa.variantId]))!.reserved).toBe(3);
    const ledgerBefore = (await one<any>('SELECT count(*)::int AS n FROM ledger_entries'))!.n;
    const retry = await call('POST', `/api/orders/${orderId}/pay`, c.token, { paymentToken: 'tok_visa' });
    expect(retry.statusCode).toBe(200);
    expect((await one<any>('SELECT status, payment_status FROM orders WHERE id = $1', [orderId]))).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect((await one<any>('SELECT count(*)::int AS n FROM ledger_entries'))!.n).toBeGreaterThan(ledgerBefore);
    // an abandoned unpaid order is cancelled and its stock released
    const c2 = await customerWithToken();
    await addToCart(c2.token, pa.variantId, 2);
    await call('PATCH', '/api/carts/options', c2.token, { addressId: c2.addressId });
    const f2 = await call('POST', '/api/checkout', c2.token, { idempotencyKey: 'decline-2', paymentToken: 'tok_insufficient_funds' });
    const oid2 = f2.json().error.details.orderId;
    await query("UPDATE orders SET payment_deadline = now() - interval '1 minute' WHERE id = $1", [oid2]);
    const { expireUnpaidOrders } = await import('../src/modules/orders/checkout.js');
    expect(await expireUnpaidOrders({ userId: null, role: 'system' })).toBeGreaterThanOrEqual(1);
    expect((await one<any>('SELECT status FROM orders WHERE id = $1', [oid2]))!.status).toBe('cancelled');
    expect((await one<any>('SELECT reserved FROM inventory WHERE variant_id = $1', [pa.variantId]))!.reserved).toBe(0);
    expect((await call('POST', `/api/orders/${oid2}/pay`, c2.token, { paymentToken: 'tok_visa' })).statusCode).toBe(409);
  });

  it('refuses stale prices and invalid tokens with friendly messages', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
    const stale = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'key-stale-1-0001', paymentToken: 'tok_visa', expectedTotal: 1.0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('QUOTE_CHANGED');
    expect(stale.json().error.details.quote.totals.total).toBeGreaterThan(1);
    const bad = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'bad-token-1', paymentToken: 'pm_not_a_real_token' });
    expect(bad.statusCode).toBe(402);
    expect((await call('POST', '/api/checkout', null, { idempotencyKey: 'noauth-1' })).statusCode).toBe(401);
  });

  it('enforces chef capacity so a kitchen can never be overbooked', async () => {
    const chef = await makeVendor({ type: 'chef', name: 'Chef Capacity', capacity: 3 });
    const dish = await makeProduct(chef.id, chef.ownerId, { name: 'Egusi', type: 'chef_meal', price: 20, tax: 'prepared', variants: [{ name: 'Regular', price: 20 }] });
    await query('UPDATE chefs SET daily_capacity = 3 WHERE vendor_id = $1', [chef.id]);
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await customerWithToken();
      await addToCart(c.token, dish.variantId, 1);
      await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId });
      results.push((await call('POST', '/api/checkout', c.token, { idempotencyKey: `cap-${i}-${c.id}`, paymentToken: 'tok_visa' })).statusCode);
    }
    expect(results).toEqual([201, 201, 201, 409]);
    const c = await customerWithToken();
    await addToCart(c.token, dish.variantId, 1);
    const q = (await call('GET', '/api/carts/current', c.token)).json().cart.quote;
    expect(q.blockers.map((b: any) => b.code)).toContain('CAPACITY');
    const cap = await call('GET', `/api/vendors/${chef.id}/chef/capacity`, await loginToken(chef.ownerEmail));
    expect(cap.json().today).toMatchObject({ daily_capacity: 3, used: 3, remaining: 0 });
    // blackout periods block ordering
    const c3 = await customerWithToken();
    await query('UPDATE chefs SET daily_capacity = 50 WHERE vendor_id = $1', [chef.id]);
    await query("INSERT INTO capacity_blackouts(vendor_id, starts_at, ends_at, reason) VALUES ($1, now() - interval '1 hour', now() + interval '48 hours', 'Holiday')", [chef.id]);
    await addToCart(c3.token, dish.variantId, 1);
    expect((await call('GET', '/api/carts/current', c3.token)).json().cart.quote.blockers.find((b: any) => b.code === 'CAPACITY').message).toContain('unavailable');
  });

  it('supports pickup with a code, scheduled orders and minimum order rules', async () => {
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c.token, { fulfillment: { [A.id]: { mode: 'pickup' } } });
    const r = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'pickup-1', paymentToken: 'tok_visa' });
    expect(r.statusCode).toBe(201);
    const s = await one<any>('SELECT fulfillment_type, pickup_code, delivery_fee FROM suborders WHERE order_id = $1', [r.json().orderId]);
    expect(s).toMatchObject({ fulfillment_type: 'pickup' }); expect(s!.pickup_code).toMatch(/^\d{4}$/); expect(Number(s!.delivery_fee)).toBe(0);
    expect(await query('SELECT 1 FROM delivery_jobs WHERE order_id = $1', [r.json().orderId])).toHaveLength(0);
    // scheduled
    const later = new Date(Date.now() + 6 * 3600000).toISOString();
    const c2 = await customerWithToken();
    await addToCart(c2.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c2.token, { addressId: c2.addressId, fulfillment: { [A.id]: { mode: 'delivery', scheduledFor: later } } });
    const r2 = await call('POST', '/api/checkout', c2.token, { idempotencyKey: 'key-sched-1-0001', paymentToken: 'tok_visa' });
    expect(r2.statusCode).toBe(201);
    expect((await one<any>('SELECT requested_for FROM suborders WHERE order_id = $1', [r2.json().orderId]))!.requested_for).toBeTruthy();
    // minimum order
    await query('UPDATE vendors SET min_order = 50 WHERE id = $1', [A.id]);
    const c3 = await customerWithToken();
    await addToCart(c3.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c3.token, { addressId: c3.addressId });
    const blocked = await call('POST', '/api/checkout', c3.token, { idempotencyKey: 'key-min-1-0001', paymentToken: 'tok_visa' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/minimum order of \$50\.00/);
  });

  it('applies coupons at checkout, records redemptions once and enforces limits', async () => {
    const staff = await makeStaff('marketing_manager');
    const st = await loginToken(staff.email);
    const create = await call('POST', '/api/marketing/promotions', st, { name: 'Ten off', code: 'TEN', type: 'percent', value: 10, status: 'active', per_customer_limit: 1, usage_limit: 2, auto_apply: false });
    expect(create.statusCode).toBe(201);
    const c = await customerWithToken();
    await addToCart(c.token, pa.variantId, 2);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId, couponCodes: ['ten'] });
    const q = (await call('GET', '/api/carts/current', c.token)).json().cart.quote;
    expect(q.totals.platformDiscount).toBeCloseTo(2.6, 2);
    expect(q.appliedPromotions[0].code).toBe('TEN');
    const r = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'coupon-1', paymentToken: 'tok_visa' });
    expect(r.statusCode).toBe(201);
    expect((await one<any>("SELECT redemption_count FROM promotions WHERE code = 'TEN'"))!.redemption_count).toBe(1);
    await addToCart(c.token, pa.variantId, 1);
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId, couponCodes: ['TEN'] });
    const again = (await call('GET', '/api/carts/current', c.token)).json().cart.quote;
    expect(again.totals.platformDiscount).toBe(0);
    expect(again.warnings.some((w: any) => w.message.includes('maximum number'))).toBe(true);
    // cancelling before acceptance returns the redemption
    await call('POST', `/api/orders/${r.json().orderId}/cancel`, c.token, {});
    expect((await one<any>("SELECT redemption_count FROM promotions WHERE code = 'TEN'"))!.redemption_count).toBe(0);
  });
});
