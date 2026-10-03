import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeDriver, loginToken, bearer, query, one, setSetting, clearSettingsCache } from './helpers.js';
import { dispatchJob, expireOffers } from '../src/modules/deliveries.js';
import { runDueJobs } from '../src/lib/jobs.js';
import { assertSuborderTransition, assertDeliveryTransition, SUBORDER_TRANSITIONS } from '../src/lib/states.js';
import { canBatch, planRoute } from '../src/modules/batching.js';
import { computeDriverPay } from '../src/modules/driverpay.js';
import { SETTING_DEFS } from '../src/lib/settings.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });

const call = (method: string, url: string, token: string | null, payload?: any) => app.inject({ method: method as any, url, payload, headers: token ? bearer(token) : {} });
async function setup(o: { pickup?: boolean; ownDelivery?: boolean; lat?: number; lng?: number; payToken?: string } = {}) {
  const v = await makeVendor({ ownDelivery: o.ownDelivery, lat: o.lat ?? 43.67, lng: o.lng ?? -79.40 });
  const p = await makeProduct(v.id, v.ownerId, { price: 25, stock: 40, tax: 'zero_rated' });
  const c = await makeCustomer();
  const email = (await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email;
  const token = await loginToken(email);
  const vt = await loginToken(v.ownerEmail);
  await call('POST', '/api/carts/items', token, { variantId: p.variantId, qty: 2 });
  await call('PATCH', '/api/carts/options', token, { addressId: c.addressId, tip: 3, ...(o.pickup ? { fulfillment: { [v.id]: { mode: 'pickup' } } } : {}) });
  const r = await call('POST', '/api/checkout', token, { idempotencyKey: 'ful-' + Math.random().toString(36).slice(2) + '-key', paymentToken: o.payToken ?? 'tok_visa' });
  expect(r.statusCode).toBe(201);
  const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [r.json().orderId]))!;
  return { v, p, c, token, vt, orderId: r.json().orderId as string, sub };
}
const vendorDo = (s: any, action: string, body?: any) => call('POST', `/api/vendors/${s.v.id}/orders/${s.sub.id}/${action}`, s.vt, body);

describe('state machines', () => {
  it('defines only valid suborder transitions and rejects arbitrary jumps', () => {
    expect(() => assertSuborderTransition('confirmed', 'preparing', 'delivery_platform')).toThrow();
    expect(() => assertSuborderTransition('confirmed', 'completed', 'delivery_platform')).toThrow();
    expect(() => assertSuborderTransition('delivered', 'preparing', 'delivery_platform')).toThrow();
    expect(() => assertSuborderTransition('cancelled', 'confirmed', 'pickup')).toThrow();
    expect(() => assertSuborderTransition('preparing', 'ready_for_pickup', 'pickup')).not.toThrow();
    expect(() => assertSuborderTransition('ready_for_pickup', 'driver_assigned', 'pickup')).toThrow();            // pickup has no driver
    expect(() => assertSuborderTransition('picked_up', 'completed', 'pickup')).not.toThrow();
    expect(() => assertSuborderTransition('picked_up', 'completed', 'delivery_platform')).toThrow();
    expect(() => assertSuborderTransition('ready_for_pickup', 'driver_assigned', 'delivery_vendor')).toThrow();
    for (const [from, tos] of Object.entries(SUBORDER_TRANSITIONS)) if (from !== 'partially_refunded') expect(tos).not.toContain(from);
    expect(() => assertDeliveryTransition('offered', 'picked_up')).toThrow();
    expect(() => assertDeliveryTransition('delivered', 'cancelled')).toThrow();
    expect(() => assertDeliveryTransition('in_transit', 'delivered')).not.toThrow();
  });
});

describe('vendor order processing', () => {
  it('walks accept, prepare and ready, logging every transition with the actor', async () => {
    const s = await setup();
    expect((await vendorDo(s, 'prepare')).statusCode).toBe(409);                  // cannot skip accepting
    expect((await vendorDo(s, 'ready')).statusCode).toBe(409);
    expect((await vendorDo(s, 'accept', { prepMinutes: 25 })).statusCode).toBe(200);
    expect((await vendorDo(s, 'prepare')).statusCode).toBe(200);
    expect((await vendorDo(s, 'ready')).statusCode).toBe(200);
    const row = await one<any>('SELECT status, prep_minutes, accepted_at, ready_at FROM suborders WHERE id = $1', [s.sub.id]);
    expect(row).toMatchObject({ status: 'ready_for_pickup', prep_minutes: 25 });
    const hist = await query<any>("SELECT from_status, to_status, actor_user_id, actor_role FROM order_status_history WHERE entity_type = 'suborder' AND entity_id = $1 ORDER BY id", [s.sub.id]);
    expect(hist.map((h: any) => h.to_status)).toEqual(['pending_payment', 'confirmed', 'vendor_accepted', 'preparing', 'ready_for_pickup']);
    expect(hist.slice(2).every((h: any) => h.actor_user_id === s.v.ownerId)).toBe(true);
    const notes = await query<any>("SELECT kind FROM notifications WHERE user_id = $1 AND data->>'orderId' = $2", [s.c.id, s.orderId]);
    expect(notes.map((n: any) => n.kind)).toEqual(expect.arrayContaining(['order_confirmed', 'vendor_accepted', 'order_ready']));
    expect((await one<any>('SELECT status FROM orders WHERE id = $1', [s.orderId]))!.status).toBe('in_progress');
  });
  it('rejects an order, refunds the customer in full and releases stock', async () => {
    const s = await setup();
    const before = (await one<any>('SELECT on_hand FROM inventory WHERE variant_id = $1', [s.p.variantId]))!.on_hand;
    expect((await vendorDo(s, 'reject', { reason: 'x' })).statusCode).toBe(400);
    const r = await vendorDo(s, 'reject', { reason: 'Sold out of this item' });
    expect(r.statusCode).toBe(200);
    expect(await one<any>('SELECT status, cancelled_by FROM suborders WHERE id = $1', [s.sub.id])).toMatchObject({ status: 'cancelled', cancelled_by: 'vendor' });
    const o = await one<any>('SELECT status, payment_status FROM orders WHERE id = $1', [s.orderId]);
    expect(o).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    expect(Number((await one<any>('SELECT amount, refunded_amount FROM payments WHERE order_id = $1', [s.orderId]))!.refunded_amount)).toBeCloseTo(Number((await one<any>('SELECT total FROM orders WHERE id = $1', [s.orderId]))!.total), 2);
    expect((await one<any>('SELECT on_hand FROM inventory WHERE variant_id = $1', [s.p.variantId]))!.on_hand).toBe(before + 2);
    expect((await one<any>("SELECT status FROM delivery_jobs WHERE order_id = $1", [s.orderId]))!.status).toBe('cancelled');
    expect((await vendorDo(s, 'accept')).statusCode).toBe(409);
    expect((await one<any>('SELECT 1 FROM notifications WHERE user_id = $1 AND kind = $2', [s.c.id, 'order_cancelled']))).toBeTruthy();
  });
  it('lets customers cancel freely before acceptance and only briefly after', async () => {
    const s1 = await setup();
    expect((await call('POST', `/api/orders/${s1.orderId}/cancel`, s1.token, {})).statusCode).toBe(200);
    expect((await one<any>('SELECT status FROM orders WHERE id = $1', [s1.orderId]))!.status).toBe('cancelled');
    const s2 = await setup();
    await vendorDo(s2, 'accept');
    await query("UPDATE suborders SET accepted_at = now() - interval '2 minutes' WHERE id = $1", [s2.sub.id]);
    expect((await call('POST', `/api/orders/${s2.orderId}/cancel`, s2.token, {})).statusCode).toBe(200);          // inside the 5 minute window
    const s3 = await setup();
    await vendorDo(s3, 'accept');
    await query("UPDATE suborders SET accepted_at = now() - interval '30 minutes' WHERE id = $1", [s3.sub.id]);
    const late = await call('POST', `/api/orders/${s3.orderId}/cancel`, s3.token, {});
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('CANNOT_CANCEL');
    const s4 = await setup();
    await vendorDo(s4, 'accept'); await vendorDo(s4, 'prepare');
    expect((await call('POST', `/api/orders/${s4.orderId}/cancel`, s4.token, {})).statusCode).toBe(409);
  });
  it('captures on acceptance when configured and voids if the vendor declines', async () => {
    await setSetting('payments', { capture_mode: 'on_acceptance' }, null);
    try {
      const s1 = await setup();
      expect((await one<any>('SELECT p.status FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.id = $1', [s1.orderId]))).toMatchObject({ status: 'authorized' });
      expect(await query('SELECT 1 FROM ledger_entries WHERE order_id = $1', [s1.orderId])).toHaveLength(0);       // nothing posted until captured
      await vendorDo(s1, 'accept');
      expect(await one('SELECT status FROM payments WHERE order_id = $1', [s1.orderId])).toMatchObject({ status: 'captured' });
      expect((await query('SELECT 1 FROM ledger_entries WHERE order_id = $1', [s1.orderId])).length).toBeGreaterThan(0);
      const s2 = await setup();
      await vendorDo(s2, 'reject', { reason: 'Closed early today' });
      expect(await one('SELECT status FROM payments WHERE order_id = $1', [s2.orderId])).toMatchObject({ status: 'voided' });
      expect(await query('SELECT 1 FROM ledger_entries WHERE order_id = $1', [s2.orderId])).toHaveLength(0);
    } finally { await setSetting('payments', { capture_mode: 'automatic' }, null); clearSettingsCache(); }
  });
  it('commits stock at vendor acceptance when configured that way', async () => {
    await setSetting('inventory', { commit_stage: 'vendor_accept' }, null);
    try {
      const s = await setup();
      expect(await one('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [s.p.variantId])).toMatchObject({ on_hand: 40, reserved: 2 });
      await vendorDo(s, 'accept');
      expect(await one('SELECT on_hand, reserved FROM inventory WHERE variant_id = $1', [s.p.variantId])).toMatchObject({ on_hand: 38, reserved: 0 });
    } finally { await setSetting('inventory', { commit_stage: 'payment' }, null); clearSettingsCache(); }
  });
  it('escalates and refunds when a store never responds', async () => {
    const s = await setup();
    const { vendorAcceptTimeout } = await import('../src/modules/orders/fulfillment.js');
    await vendorAcceptTimeout(s.sub.id);
    expect(await one('SELECT status FROM suborders WHERE id = $1', [s.sub.id])).toMatchObject({ status: 'cancelled' });
    expect(await one("SELECT 1 FROM operational_alerts WHERE kind = 'vendor_timeout'")).toBeTruthy();
  });
  it('supports pickup collection with the code and vendor operated delivery', async () => {
    const s = await setup({ pickup: true });
    await vendorDo(s, 'accept'); await vendorDo(s, 'prepare'); await vendorDo(s, 'ready');
    expect((await vendorDo(s, 'collect', { code: '0000' })).statusCode).toBe(400);
    expect((await vendorDo(s, 'collect', { code: s.sub.pickup_code })).statusCode).toBe(200);
    expect(await one('SELECT status FROM suborders WHERE id = $1', [s.sub.id])).toMatchObject({ status: 'completed' });
    const own = await setup({ ownDelivery: true });
    await vendorDo(own, 'accept'); await vendorDo(own, 'prepare'); await vendorDo(own, 'ready');
    expect(await query('SELECT 1 FROM delivery_jobs WHERE order_id = $1', [own.orderId])).toHaveLength(0);
    expect((await vendorDo(own, 'delivery', { step: 'delivered' })).statusCode).toBe(409);                        // must go out first
    expect((await vendorDo(own, 'delivery', { step: 'out' })).statusCode).toBe(200);
    expect((await vendorDo(own, 'delivery', { step: 'delivered' })).statusCode).toBe(200);
    expect(await one('SELECT status FROM suborders WHERE id = $1', [own.sub.id])).toMatchObject({ status: 'completed' });
    // EAZyfoods-delivered orders cannot be marked delivered by the vendor
    const plat = await setup();
    await vendorDo(plat, 'accept'); await vendorDo(plat, 'prepare'); await vendorDo(plat, 'ready');
    expect((await vendorDo(plat, 'delivery', { step: 'out' })).statusCode).toBe(403);
    expect((await vendorDo(plat, 'collect', { code: '1234' })).statusCode).toBe(400);
  });
});

describe('dispatch and delivery', () => {
  async function readyOrder(o: Parameters<typeof setup>[0] = {}) {
    const s = await setup(o);
    await vendorDo(s, 'accept'); await vendorDo(s, 'prepare'); await vendorDo(s, 'ready');
    const job = (await one<any>('SELECT * FROM delivery_jobs WHERE order_id = $1', [s.orderId]))!;
    return { ...s, job };
  }
  async function offline() { await query("UPDATE driver_profiles SET availability = 'offline'"); }

  it('creates a delivery job when the order is ready and offers it only to eligible drivers', async () => {
    await offline();
    const ok = await makeDriver({ lat: 43.671, lng: -79.402 });
    await makeDriver({ approved: false, lat: 43.671, lng: -79.402 });                         // not approved
    await makeDriver({ online: false, lat: 43.671, lng: -79.402 });                           // offline
    const far = await makeDriver({ lat: 44.5, lng: -80.5 });                                  // far away
    const stale = await makeDriver({ lat: 43.671, lng: -79.402 });
    await query("UPDATE driver_profiles SET location_updated_at = now() - interval '2 hours' WHERE user_id = $1", [stale.id]);
    const heavy = await makeDriver({ lat: 43.671, lng: -79.402, vehicle: 'bike' });
    const s = await readyOrder();
    expect(s.job.status).toBe('awaiting_driver');
    await runDueJobs(1000);                                                                       // the dispatch job
    const offers = await query<any>('SELECT driver_id, status FROM delivery_offers WHERE job_id = $1', [s.job.id]);
    expect(offers).toHaveLength(1);                                                           // offers go out one at a time
    expect([ok.id, heavy.id]).toContain(offers[0].driver_id);
    expect(offers[0].driver_id).not.toBe(far.id);
    expect(offers[0].driver_id).not.toBe(stale.id);
    expect((await one<any>('SELECT status FROM delivery_jobs WHERE id = $1', [s.job.id]))!.status).toBe('offered');
    expect(await one("SELECT 1 FROM notifications WHERE kind = 'delivery_offer' AND user_id = $1", [offers[0].driver_id])).toBeTruthy();
  });

  it('runs the whole delivery with PIN proof, pays the driver and completes the order', async () => {
    await offline();
    const d = await makeDriver({ lat: 43.671, lng: -79.402 });
    const dt = await loginToken(d.email);
    const s = await readyOrder();
    await runDueJobs(1000);
    const offers = (await call('GET', '/api/drivers/me/offers', dt)).json().offers;
    expect(offers).toHaveLength(1);
    // before accepting, the driver sees only approximate areas
    const pre = offers[0].job;
    expect(pre.dropoff).toBeUndefined(); expect(pre.pickup).toBeUndefined();
    expect(pre.dropoffArea.lat).toBeCloseTo(43.67, 1);
    expect(JSON.stringify(pre)).not.toMatch(/Davenport|Amara/i);
    expect(pre.estPay).toBeGreaterThan(0);
    // another driver cannot accept it
    const other = await makeDriver();
    expect((await call('POST', `/api/drivers/me/offers/${s.job.id}/accept`, await loginToken(other.email))).statusCode).toBe(409);
    expect((await call('POST', `/api/drivers/me/offers/${s.job.id}/accept`, dt)).statusCode).toBe(200);
    expect((await one<any>('SELECT status FROM suborders WHERE id = $1', [s.sub.id]))!.status).toBe('driver_assigned');
    const jobs = (await call('GET', '/api/drivers/me/jobs', dt)).json().jobs;
    expect(jobs[0].dropoff.address).toContain('Davenport');
    expect(jobs[0].dropoff.name).toBe('Amara');
    expect(jobs[0].dropoff.name).not.toContain(' ');                                // first name only
    expect(JSON.stringify(jobs[0])).not.toMatch(/@test|555-/);                      // no email or phone for the customer
    const j = s.job.id;
    expect((await call('POST', `/api/drivers/me/jobs/${j}/start`, dt)).statusCode).toBe(409);                      // must pick up first
    expect((await call('POST', `/api/drivers/me/jobs/${j}/arrived`, dt)).statusCode).toBe(200);
    expect((await call('POST', `/api/drivers/me/jobs/${j}/pickup`, dt)).statusCode).toBe(200);
    expect((await call('POST', `/api/drivers/me/jobs/${j}/start`, dt)).statusCode).toBe(200);
    // the customer can see the driver and the PIN, but not the driver's personal details
    const view = (await call('GET', `/api/orders/${s.orderId}`, s.token)).json().order.suborders[0];
    expect(view.status).toBe('in_transit');
    expect(view.delivery.pin).toMatch(/^\d{4}$/);
    expect(view.delivery.driver.first_name).toBe('Driver');
    expect(JSON.stringify(view.delivery.driver)).not.toMatch(/Dave|email|phone/i);
    // wrong PIN, then right PIN but missing location is fine because only the PIN is required by default
    const bad = await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin: '0000' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_PIN');
    expect((await one<any>('SELECT pin_attempts FROM delivery_jobs WHERE id = $1', [j]))!.pin_attempts).toBe(1);
    const ok = await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin: view.delivery.pin, lat: s.job.dropoff_lat, lng: s.job.dropoff_lng });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().earned).toBeGreaterThan(3);
    expect(await one('SELECT status FROM suborders WHERE id = $1', [s.sub.id])).toMatchObject({ status: 'completed' });
    expect(await one('SELECT status FROM orders WHERE id = $1', [s.orderId])).toMatchObject({ status: 'completed' });
    const proof = (await one<any>('SELECT proof, delivered_at FROM delivery_jobs WHERE id = $1', [j]))!;
    expect(proof.proof).toMatchObject({ pin: true }); expect(proof.proof.gps.distance_m).toBeLessThan(5); expect(proof.delivered_at).toBeTruthy();
    // after completion the driver can no longer see the customer's details
    const hist = (await call('GET', '/api/drivers/me/jobs?scope=history', dt)).json().jobs[0];
    expect(hist.dropoff).toBeUndefined(); expect(hist.redacted).toBe(true);
    expect(JSON.stringify(hist)).not.toMatch(/Davenport/);
    // earnings were recorded and the ledger is balanced
    const e = await one<any>('SELECT total, tip, base, distance_pay FROM driver_earnings WHERE job_id = $1', [j]);
    expect(Number(e!.tip)).toBe(3); expect(Number(e!.total)).toBeCloseTo(ok.json().earned, 2);
    const summary = (await call('GET', '/api/drivers/me/earnings', dt)).json();
    expect(summary.earnings.deliveries).toBe(1); expect(summary.earnings.today).toBeCloseTo(ok.json().earned, 2);
    const tb = await one<any>('SELECT sum(debit) d, sum(credit) c FROM ledger_entries');
    expect(Number(tb!.d)).toBeCloseTo(Number(tb!.c), 2);
    // customer sees completed notification and the delivery PIN is no longer shown
    expect(((await call('GET', `/api/orders/${s.orderId}`, s.token)).json().order.suborders[0].delivery.pin)).toBeNull();
    expect(await one("SELECT 1 FROM notifications WHERE kind = 'delivered' AND user_id = $1", [s.c.id])).toBeTruthy();
  });

  it('locks delivery confirmation after too many wrong PINs and requires configured proof', async () => {
    await offline();
    const d = await makeDriver({ lat: 43.671, lng: -79.402 });
    const dt = await loginToken(d.email);
    const s = await readyOrder();
    await runDueJobs(1000);
    const j = s.job.id;
    for (const a of ['accept']) await call('POST', `/api/drivers/me/offers/${j}/${a}`, dt);
    for (const a of ['arrived', 'pickup', 'start']) await call('POST', `/api/drivers/me/jobs/${j}/${a}`, dt);
    await setSetting('delivery', { proof_required: ['pin', 'gps'], pin_attempts: 3 }, null);
    try {
      const pin = (await one<any>('SELECT delivery_pin FROM delivery_jobs WHERE id = $1', [j]))!.delivery_pin;
      const noGps = await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin });
      expect(noGps.json().error.code).toBe('PROOF_GPS');
      const far = await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin, lat: s.job.dropoff_lat + 0.05, lng: s.job.dropoff_lng });
      expect(far.json().error.message).toMatch(/m from the delivery address/);
      for (let i = 0; i < 3; i++) await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin: '9999' });
      const locked = await call('POST', `/api/drivers/me/jobs/${j}/deliver`, dt, { pin, lat: s.job.dropoff_lat, lng: s.job.dropoff_lng });
      expect(locked.statusCode).toBe(423);
      expect((await one<any>('SELECT status FROM delivery_jobs WHERE id = $1', [j]))!.status).toBe('in_transit');
    } finally { await setSetting('delivery', { proof_required: ['pin'], pin_attempts: 5 }, null); clearSettingsCache(); }
  });

  it('re-offers to the next driver after a rejection or an expired offer', async () => {
    await offline();
    const d1 = await makeDriver({ lat: 43.671, lng: -79.402 }), d2 = await makeDriver({ lat: 43.675, lng: -79.41 });
    const s = await readyOrder();
    await runDueJobs(1000);
    const first = (await one<any>("SELECT driver_id FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [s.job.id]))!.driver_id;
    expect((await call('POST', `/api/drivers/me/offers/${s.job.id}/reject`, await loginToken(first === d1.id ? d1.email : d2.email))).statusCode).toBe(200);
    await runDueJobs(1000);
    const second = (await one<any>("SELECT driver_id FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [s.job.id]))!.driver_id;
    expect(second).not.toBe(first);
    await query("UPDATE delivery_offers SET expires_at = now() - interval '1 second' WHERE job_id = $1 AND status = 'offered'", [s.job.id]);
    await expireOffers();
    expect(await query("SELECT 1 FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [s.job.id])).toHaveLength(0);
    expect(await query("SELECT 1 FROM delivery_offers WHERE job_id = $1 AND status = 'expired'", [s.job.id])).toHaveLength(1);
    // both drivers have now declined or timed out, so nobody is left and operations are alerted once the wait is long
    await query("UPDATE delivery_jobs SET ready_at = now() - interval '30 minutes' WHERE id = $1", [s.job.id]);
    await dispatchJob(s.job.id);
    expect(await one<any>("SELECT status FROM delivery_jobs WHERE id = $1", [s.job.id])).toMatchObject({ status: 'awaiting_driver' });
    expect(await one("SELECT 1 FROM operational_alerts WHERE kind = 'no_driver'")).toBeTruthy();
  });

  it('only allows one driver to win a job when two accept at the same time', async () => {
    await offline();
    const d = await makeDriver({ lat: 43.671, lng: -79.402 });
    const s = await readyOrder();
    await runDueJobs(1000);
    const dt = await loginToken(d.email);
    const results = await Promise.all([1, 2, 3].map(() => call('POST', `/api/drivers/me/offers/${s.job.id}/accept`, dt)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect((await query('SELECT 1 FROM delivery_jobs WHERE id = $1 AND driver_id = $2', [s.job.id, d.id]))).toHaveLength(1);
  });

  it('records driver issues and releases the job for reassignment when the vehicle fails', async () => {
    await offline();
    const d1 = await makeDriver({ lat: 43.671, lng: -79.402 });
    const dt = await loginToken(d1.email);
    const s = await readyOrder();
    await runDueJobs(1000);
    await call('POST', `/api/drivers/me/offers/${s.job.id}/accept`, dt);
    const notReady = await call('POST', `/api/drivers/me/jobs/${s.job.id}/issue`, dt, { kind: 'vendor_not_ready', notes: 'Waiting 10 minutes' });
    expect(notReady.statusCode).toBe(200);
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE 'Driver waiting%'", [s.v.ownerId])).toBeTruthy();
    const veh = await call('POST', `/api/drivers/me/jobs/${s.job.id}/issue`, dt, { kind: 'vehicle_problem' });
    expect(veh.json().released).toBe(true);
    expect(await one<any>('SELECT status, driver_id FROM delivery_jobs WHERE id = $1', [s.job.id])).toMatchObject({ status: 'awaiting_driver', driver_id: null });
    expect((await one<any>('SELECT status FROM suborders WHERE id = $1', [s.sub.id]))!.status).toBe('ready_for_pickup');
    const tickets = await query<any>("SELECT category, priority FROM support_tickets WHERE suborder_id = $1", [s.sub.id]);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].category).toBe('driver_issue');
    expect(await query('SELECT kind FROM driver_issues WHERE job_id = $1', [s.job.id])).toHaveLength(2);
    expect((await call('POST', `/api/drivers/me/jobs/${s.job.id}/issue`, dt, { kind: 'accident' })).statusCode).toBe(404);   // no longer theirs
  });

  it('lets operations reassign a delivery and audits it', async () => {
    await offline();
    const d1 = await makeDriver({ lat: 43.671, lng: -79.402 }), d2 = await makeDriver({ lat: 43.9, lng: -79.9 });
    const s = await readyOrder();
    await runDueJobs(1000);
    const first = (await one<any>("SELECT driver_id FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [s.job.id]))!.driver_id;
    await call('POST', `/api/drivers/me/offers/${s.job.id}/accept`, await loginToken(first === d1.id ? d1.email : d2.email));
    const { makeStaff } = await import('./helpers.js');
    const ops = await makeStaff('driver_operations');
    const ot = await loginToken(ops.email);
    const target = first === d1.id ? d2 : d1;
    const r = await call('POST', `/api/admin/deliveries/${s.job.id}/reassign`, ot, { driverId: target.id });
    expect(r.statusCode).toBe(200);
    expect((await one<any>('SELECT driver_id, status FROM delivery_jobs WHERE id = $1', [s.job.id]))).toMatchObject({ driver_id: target.id, status: 'assigned' });
    const a = await one<any>("SELECT actor_user_id, changes FROM audit_logs WHERE action = 'delivery.reassigned' AND entity_id = $1 ORDER BY id DESC", [s.job.id]);
    expect(a!.actor_user_id).toBe(ops.id); expect(a!.changes.to).toBe(target.id);
    const unapproved = await makeDriver({ approved: false });
    expect((await call('POST', `/api/admin/deliveries/${s.job.id}/reassign`, ot, { driverId: unapproved.id })).statusCode).toBe(400);
    const plain = await makeStaff('marketing_staff');
    expect((await call('POST', `/api/admin/deliveries/${s.job.id}/reassign`, await loginToken(plain.email), { driverId: target.id })).statusCode).toBe(403);
  });
});

describe('batching and driver pay', () => {
  const cfg = SETTING_DEFS.dispatch.default.batching;
  const J = (id: string, p: [number, number], d: [number, number], o: any = {}) => ({ id, pickup: { lat: p[0], lng: p[1] }, dropoff: { lat: d[0], lng: d[1] }, needsCold: false, readyAt: new Date(), picked: false, ...o });
  it('batches nearby compatible orders and returns a pickup then delivery sequence with ETAs', () => {
    const jobs = [J('a', [43.65, -79.38], [43.68, -79.40]), J('b', [43.651, -79.381], [43.685, -79.405]), J('c', [43.652, -79.382], [43.682, -79.402])];
    const r = canBatch({ lat: 43.649, lng: -79.379 }, jobs, cfg, 30);
    expect(r.ok).toBe(true);
    expect(r.route).toHaveLength(6);
    for (const id of ['a', 'b', 'c']) expect(r.route!.findIndex((s) => s.type === 'pickup' && s.jobId === id)).toBeLessThan(r.route!.findIndex((s) => s.type === 'dropoff' && s.jobId === id));
    const etas = r.route!.map((s) => s.etaMinutes);
    expect(etas).toEqual([...etas].sort((x, y) => x - y));
  });
  it('never batches orders that violate the configured constraints', () => {
    const near = J('a', [43.65, -79.38], [43.68, -79.40]);
    expect(canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.9, -79.1], [43.68, -79.40])], cfg, 30).ok).toBe(false);               // pickups too far
    expect(canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.651, -79.381], [43.9, -79.1])], cfg, 30)).toMatchObject({ ok: false, reason: 'Drop offs are too far apart' });
    expect(canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.651, -79.381], [43.68, -79.40], { readyAt: new Date(Date.now() + 40 * 60000) })], cfg, 30).reason).toBe('Orders are not ready at similar times');
    expect(canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.651, -79.381], [43.69, -79.41]), J('c', [43.651, -79.382], [43.685, -79.40]), J('d', [43.652, -79.382], [43.686, -79.401])], cfg, 30).reason).toBe('Too many orders in one batch');
    expect(canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.651, -79.381], [43.69, -79.41])], { ...cfg, enabled: false }, 30).ok).toBe(false);
    // a long detour is refused
    const detour = canBatch({ lat: 43.65, lng: -79.38 }, [near, J('b', [43.652, -79.382], [43.75, -79.52])], { ...cfg, max_dropoff_gap_km: 50, max_detour_minutes: 2 }, 30);
    expect(detour.ok).toBe(false);
    expect(planRoute({ lat: 43.65, lng: -79.38 }, [near], 30).stops.map((s) => s.type)).toEqual(['pickup', 'dropoff']);
  });
  it('batches a second order with a driver already on a job and adds the multi order bonus', async () => {
    await query("UPDATE driver_profiles SET availability = 'offline'");
    const d = await makeDriver({ lat: 43.671, lng: -79.402 });
    const dt = await loginToken(d.email);
    const v = await makeVendor({ lat: 43.67, lng: -79.40 });
    const p = await makeProduct(v.id, v.ownerId, { price: 30, stock: 20, tax: 'zero_rated' });
    const place = async () => {
      const c = await makeCustomer({ postal: 'M4W 1A1' });
      const t = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
      await call('POST', '/api/carts/items', t, { variantId: p.variantId, qty: 1 });
      await call('PATCH', '/api/carts/options', t, { addressId: c.addressId });
      const r = await call('POST', '/api/checkout', t, { idempotencyKey: 'batch-' + Math.random().toString(36).slice(2) + '-k', paymentToken: 'tok_visa' });
      const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [r.json().orderId]))!;
      const vt = await loginToken(v.ownerEmail);
      for (const a of ['accept', 'prepare', 'ready']) await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/${a}`, vt, {});
      return (await one<any>('SELECT * FROM delivery_jobs WHERE suborder_id = $1', [sub.id]))!;
    };
    const j1 = await place();
    await runDueJobs(1000);
    await call('POST', `/api/drivers/me/offers/${j1.id}/accept`, dt);
    const j2 = await place();
    await runDueJobs(1000);
    const offer2 = await one<any>("SELECT driver_id, is_batch FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [j2.id]);
    expect(offer2).toMatchObject({ driver_id: d.id, is_batch: true });
    await call('POST', `/api/drivers/me/offers/${j2.id}/accept`, dt);
    const jobs = await call('GET', '/api/drivers/me/jobs', dt);
    expect(jobs.json().jobs).toHaveLength(2);
    expect(jobs.json().route.stops.length).toBeGreaterThanOrEqual(4);
    const pay = await one<any>('SELECT pay_breakdown, batch_id FROM delivery_jobs WHERE id = $1', [j2.id]);
    expect(pay!.batch_id).toBeTruthy();
    expect(pay!.pay_breakdown.multi_order_bonus).toBeGreaterThan(0);
    const j1b = await one<any>('SELECT batch_id FROM delivery_jobs WHERE id = $1', [j1.id]);
    expect(j1b!.batch_id).toBe(pay!.batch_id);
  });
  it('computes driver compensation from the configured formula, separate from the customer fee', () => {
    const cfg = SETTING_DEFS.driver_pay.default as any;
    const at = (iso: string) => new Date(iso);
    const base = computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T15:00:00Z'), demandRatio: 0, batchSize: 1 }, cfg);   // 10:00 local, no peak
    expect(base).toMatchObject({ base: 350, distance_pay: 350, time_pay: 400, peak_bonus: 0, surge: 0, multi_order_bonus: 0, guarantee_topup: 0, total: 1100 });
    const peak = computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T22:30:00Z'), demandRatio: 0, batchSize: 1 }, cfg);   // 18:30 local
    expect(peak.peak_bonus).toBe(200);
    const surge = computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T15:00:00Z'), demandRatio: 2.2, batchSize: 1 }, cfg);
    expect(surge.surge_multiplier).toBeGreaterThan(1); expect(surge.surge).toBeGreaterThan(0);
    expect(computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T15:00:00Z'), demandRatio: 99, batchSize: 1 }, cfg).surge_multiplier).toBe(2);   // capped
    const guarantee = computeDriverPay({ distanceKm: 0.3, minutes: 3, at: at('2026-03-10T15:00:00Z'), demandRatio: 0, batchSize: 1 }, cfg);
    expect(guarantee.total).toBe(500); expect(guarantee.guarantee_topup).toBeGreaterThan(0);
    expect(computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T15:00:00Z'), demandRatio: 0, batchSize: 3 }, cfg).multi_order_bonus).toBe(250);
    expect(computeDriverPay({ distanceKm: 5, minutes: 20, at: at('2026-03-10T15:00:00Z'), demandRatio: 0, batchSize: 1 }, { ...cfg, promo_bonus: 2 }).promo_bonus).toBe(200);
  });
});
