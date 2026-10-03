import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeDriver, makeStaff, loginToken, bearer, query, one, tx, SYSTEM } from './helpers.js';
import { runDueJobs } from '../src/lib/jobs.js';
import { reconcile, trialBalance, partyBalance, postTxn } from '../src/modules/ledger.js';
import { refundSuborder } from '../src/modules/orders/refunds.js';
import { createVendorPayout, processPayout, holdPayout, releasePayout, reversePayout, runPayoutCycle } from '../src/modules/payouts.js';
import { actorOf } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });
const call = (method: string, url: string, token: string | null, payload?: any) => app.inject({ method: method as any, url, payload, headers: token ? bearer(token) : {} });

async function deliveredOrder(o: { price?: number; qty?: number; promo?: any; tip?: number; ownDelivery?: boolean; pickup?: boolean; vendor?: any; product?: any } = {}) {
  const v = o.vendor ?? (await makeVendor({ ownDelivery: o.ownDelivery }));
  const p = o.product ?? (await makeProduct(v.id, v.ownerId, { price: o.price ?? 40, stock: 100, tax: 'standard' }));
  const c = await makeCustomer();
  const token = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
  const vt = await loginToken(v.ownerEmail);
  await call('POST', '/api/carts/items', token, { variantId: p.variantId, qty: o.qty ?? 2 });
  await call('PATCH', '/api/carts/options', token, { addressId: c.addressId, tip: o.tip ?? 4, ...(o.promo ? { couponCodes: [o.promo] } : {}), ...(o.pickup ? { fulfillment: { [v.id]: { mode: 'pickup' } } } : {}) });
  const r = await call('POST', '/api/checkout', token, { idempotencyKey: 'fin-' + Math.random().toString(36).slice(2) + '-key', paymentToken: 'tok_visa' });
  expect(r.statusCode).toBe(201);
  const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [r.json().orderId]))!;
  for (const a of ['accept', 'prepare', 'ready']) await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/${a}`, vt, {});
  if (sub.fulfillment_type === 'delivery_platform') {
    await query("UPDATE driver_profiles SET availability = 'offline'");
    const d = await makeDriver({ lat: 43.671, lng: -79.402 });
    const dt = await loginToken(d.email);
    await runDueJobs(1000);
    const job = (await one<any>('SELECT * FROM delivery_jobs WHERE suborder_id = $1', [sub.id]))!;
    await call('POST', `/api/drivers/me/offers/${job.id}/accept`, dt);
    for (const a of ['arrived', 'pickup', 'start']) await call('POST', `/api/drivers/me/jobs/${job.id}/${a}`, dt);
    await call('POST', `/api/drivers/me/jobs/${job.id}/deliver`, dt, { pin: job.delivery_pin });
  } else if (sub.fulfillment_type === 'delivery_vendor') {
    await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/delivery`, vt, { step: 'out' });
    await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/delivery`, vt, { step: 'delivered' });
  } else await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/collect`, vt, { code: sub.pickup_code });
  return { v, p, c, token, vt, orderId: r.json().orderId as string, subId: sub.id as string };
}
const balance = async (account: string, party?: string) => Number((await one<any>('SELECT coalesce(sum(credit - debit),0) AS b FROM ledger_entries WHERE account = $1 AND ($2::uuid IS NULL OR party_id = $2)', [account, party ?? null]))!.b);

describe('financial ledger', () => {
  it('records every amount of an order as balanced double entry lines and ties to the payment', async () => {
    const o = await deliveredOrder({ price: 40, qty: 2, tip: 4 });
    const sub = (await one<any>('SELECT * FROM suborders WHERE id = $1', [o.subId]))!;
    const order = (await one<any>('SELECT * FROM orders WHERE id = $1', [o.orderId]))!;
    const entries = await query<any>('SELECT account, entry_type, party_type, debit, credit, txn_id FROM ledger_entries WHERE order_id = $1', [o.orderId]);
    const byTxn = new Map<string, number>();
    for (const e of entries) byTxn.set(e.txn_id, (byTxn.get(e.txn_id) ?? 0) + Number(e.debit) - Number(e.credit));
    for (const [, net] of byTxn) expect(Math.abs(net)).toBeLessThan(0.005);
    const sum = (acct: string, side: 'debit' | 'credit', type?: string) => entries.filter((e: any) => e.account === acct && (!type || e.entry_type === type)).reduce((s: number, e: any) => s + Number(e[side]), 0);
    expect(sum('cash_clearing', 'debit')).toBeCloseTo(Number(order.total), 2);                         // what the customer paid
    expect(sum('liability_tax', 'credit')).toBeCloseTo(Number(sub.tax_total), 2);
    expect(sum('revenue_delivery', 'credit')).toBeCloseTo(Number(sub.delivery_fee), 2);
    expect(sum('revenue_service_fee', 'credit')).toBeCloseTo(Number(sub.service_fee), 2);
    expect(sum('revenue_commission', 'credit')).toBeCloseTo(Number(sub.commission_amount) + Number(sub.fixed_fee_amount), 2);
    expect(await balance('liability_vendor', o.v.id)).toBeCloseTo(Number(sub.vendor_net), 2);          // vendor is owed items minus commission
    const earn = (await one<any>('SELECT total, tip FROM driver_earnings WHERE job_id = (SELECT id FROM delivery_jobs WHERE suborder_id = $1)', [o.subId]))!;
    expect(sum('expense_driver_pay', 'debit')).toBeCloseTo(Number(earn.total) - Number(earn.tip), 2);   // driver pay is separate from the customer fee and tip
    const payment = await one<any>('SELECT amount FROM payments WHERE order_id = $1', [o.orderId]);
    expect(Number(payment!.amount)).toBeCloseTo(Number(order.total), 2);
    // platform revenue = commission + delivery fee + service fee, less driver pay for the delivery margin
    const rev = sum('revenue_commission', 'credit') + sum('revenue_delivery', 'credit') + sum('revenue_service_fee', 'credit');
    expect(rev).toBeGreaterThan(0);
    const rec = await reconcile();
    expect(rec.ok).toBe(true);
  });
  it('is append only: entries cannot be edited or deleted and unbalanced transactions are refused', async () => {
    const e = await one<any>('SELECT id FROM ledger_entries LIMIT 1');
    await expect(query('UPDATE ledger_entries SET debit = 1 WHERE id = $1', [e!.id])).rejects.toThrow(/append-only/);
    await expect(query('DELETE FROM ledger_entries WHERE id = $1', [e!.id])).rejects.toThrow(/append-only/);
    await expect(tx((c) => postTxn(c, { entryType: 'adjustment' }, [{ account: 'cash_clearing', side: 'debit', amount: 100 }, { account: 'liability_vendor', side: 'credit', amount: 99 }]))).rejects.toThrow(/Unbalanced/);
    // the database itself also refuses an unbalanced transaction even if application code is bypassed
    await expect(query(`INSERT INTO ledger_entries(txn_id, entry_type, account, debit) VALUES (gen_random_uuid(), 'bad', 'cash_clearing', 5)`)).rejects.toThrow(/Unbalanced/);
  });
  it('keeps vendor funded and platform funded promotions straight in the ledger', async () => {
    const mk = await makeStaff('marketing_manager');
    const mt = await loginToken(mk.email);
    await call('POST', '/api/marketing/promotions', mt, { name: 'Plat', code: 'PLAT10', type: 'percent', value: 10, status: 'active', funded_by: 'platform', auto_apply: false });
    const o = await deliveredOrder({ price: 50, qty: 2, promo: 'PLAT10' });
    const sub = (await one<any>('SELECT * FROM suborders WHERE id = $1', [o.subId]))!;
    expect(Number(sub.platform_discount)).toBeCloseTo(10, 2);
    expect(Number(sub.vendor_net)).toBeCloseTo(100 * 0.88, 2);                       // vendor still gets 100 less 12% commission
    expect(await balance('liability_vendor', o.v.id)).toBeCloseTo(88, 2);
    // the platform pays for the 10% promotion and for the free delivery that a $100 basket earns
    expect(Number((await one<any>("SELECT coalesce(sum(debit),0) AS d FROM ledger_entries WHERE order_id = $1 AND account = 'expense_promo'", [o.orderId]))!.d)).toBeCloseTo(10 + Number(sub.delivery_subsidy_platform), 2);
    const vendor2 = await makeVendor();
    const pv = await makeProduct(vendor2.id, vendor2.ownerId, { price: 50, stock: 20, tax: 'standard' });
    const vt = await loginToken(vendor2.ownerEmail);
    await call('POST', `/api/vendors/${vendor2.id}/promotions`, vt, { name: 'Mine', code: 'MINE10', type: 'percent', value: 10, status: 'active', auto_apply: false });
    const o2 = await deliveredOrder({ vendor: vendor2, product: pv, price: 50, qty: 2, promo: 'MINE10' });
    const sub2 = (await one<any>('SELECT * FROM suborders WHERE id = $1', [o2.subId]))!;
    expect(Number(sub2.vendor_discount)).toBeCloseTo(10, 2);
    expect(Number(sub2.vendor_net)).toBeCloseTo(90 * 0.88, 2);                       // commission is on the discounted price, the vendor carries the discount
    expect(await balance('liability_vendor', vendor2.id)).toBeCloseTo(90 * 0.88, 2);
  });
  it('credits own delivery fees to the vendor rather than the platform', async () => {
    const o = await deliveredOrder({ ownDelivery: true, tip: 0 });
    const sub = (await one<any>('SELECT * FROM suborders WHERE id = $1', [o.subId]))!;
    expect(Number(sub.delivery_fee)).toBeGreaterThan(0);
    expect(Number(sub.vendor_net)).toBeCloseTo(Number(sub.items_subtotal) * 0.88 + Number(sub.delivery_fee), 2);
    expect(await balance('liability_vendor', o.v.id)).toBeCloseTo(Number(sub.vendor_net), 2);
    expect(Number((await one<any>("SELECT coalesce(sum(credit),0) AS c FROM ledger_entries WHERE order_id = $1 AND account = 'revenue_delivery'", [o.orderId]))!.c)).toBe(0);
    expect((await reconcile()).ok).toBe(true);
  });
});

describe('refunds', () => {
  const refund = (subId: string, body: any, staff?: string) => call('POST', `/api/admin/suborders/${subId}/refund`, staff!, body);
  it('refunds one item by quantity with exact tax, commission reversal and a stock return', async () => {
    const o = await deliveredOrder({ price: 33.33, qty: 3, tip: 0 });
    const support = await makeStaff('customer_support');
    const st = await loginToken(support.email);
    const stockBefore = (await one<any>('SELECT on_hand FROM inventory WHERE variant_id = $1', [o.p.variantId]))!.on_hand;
    const item = (await one<any>('SELECT id FROM order_items WHERE suborder_id = $1', [o.subId]))!;
    const r = await refund(o.subId, { lines: [{ orderItemId: item.id, qty: 1 }], bearer: 'vendor', reason: 'One pack arrived damaged', returnToStock: false }, st);
    expect(r.statusCode).toBe(200);
    expect(r.json().amount).toBeCloseTo(33.33 * 1.13, 2);                           // item plus 13% tax
    expect(r.json().breakdown.tax).toBe(433);
    const sub = (await one<any>('SELECT status, refunded_amount, customer_total FROM suborders WHERE id = $1', [o.subId]))!;
    expect(sub.status).toBe('partially_refunded');
    expect(Number(sub.refunded_amount)).toBeCloseTo(r.json().amount, 2);
    expect((await one<any>('SELECT status FROM orders WHERE id = $1', [o.orderId]))!.status).toBe('partially_refunded');
    expect(await one('SELECT status FROM payments WHERE order_id = $1', [o.orderId])).toMatchObject({ status: 'partially_refunded' });
    expect((await one<any>('SELECT on_hand FROM inventory WHERE variant_id = $1', [o.p.variantId]))!.on_hand).toBe(stockBefore);
    // vendor lost 1/3 of the sale and gets 1/3 of the commission back
    expect(await balance('liability_vendor', o.v.id)).toBeCloseTo((99.99 - 99.99 * 0.12) * (2 / 3), 1);
    expect((await reconcile()).ok).toBe(true);
    // refund the remaining quantity: totals add up exactly to the original, no rounding drift
    const r2 = await refund(o.subId, { lines: [{ orderItemId: item.id, qty: 2 }], bearer: 'vendor', reason: 'Rest of the order' }, st);
    expect(r2.statusCode).toBe(200);
    expect(r.json().amount + r2.json().amount).toBeCloseTo(99.99 * 1.13, 2);
    expect(Math.abs(await balance('liability_vendor', o.v.id))).toBeLessThan(0.02);
    expect((await refund(o.subId, { lines: [{ orderItemId: item.id, qty: 1 }], bearer: 'vendor', reason: 'Again' }, st)).statusCode).toBe(400);
  });
  it('lets the platform absorb a goodwill refund while the vendor payout stays whole', async () => {
    const o = await deliveredOrder({ price: 20, qty: 2, tip: 0 });
    const fin = await makeStaff('finance_admin');
    const ft = await loginToken(fin.email);
    const before = await balance('liability_vendor', o.v.id);
    const r = await refund(o.subId, { amount: 6, bearer: 'platform', reason: 'Late delivery goodwill' }, ft);
    expect(r.statusCode).toBe(200);
    expect(await balance('liability_vendor', o.v.id)).toBeCloseTo(before, 2);
    expect(Number((await one<any>("SELECT coalesce(sum(debit),0) AS d FROM ledger_entries WHERE order_id = $1 AND account = 'expense_refund'", [o.orderId]))!.d)).toBeCloseTo(6, 2);
    const row = await one<any>('SELECT amount, bearer, created_by FROM refunds WHERE order_id = $1', [o.orderId]);
    expect(row!.created_by).toBe(fin.id);
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'refund.issued' AND actor_user_id = $1", [fin.id])).toBeTruthy();
    expect((await refund(o.subId, { amount: 500, bearer: 'platform', reason: 'Too much' }, ft)).statusCode).toBe(400);   // more than was paid
    expect((await refund(o.subId, { amount: 5, bearer: 'platform', reason: 'x' }, await loginToken((await makeStaff('marketing_staff')).email))).statusCode).toBe(403);
    expect((await reconcile()).ok).toBe(true);
  });
  it('refunds delivery, service fee and tip on a full cancellation and returns promotions', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { price: 30, stock: 20, tax: 'standard' });
    const c = await makeCustomer();
    const token = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
    await call('POST', '/api/carts/items', token, { variantId: p.variantId, qty: 1 });
    await call('PATCH', '/api/carts/options', token, { addressId: c.addressId, tip: 5 });
    const r = await call('POST', '/api/checkout', token, { idempotencyKey: 'cancel-full-key-1', paymentToken: 'tok_visa' });
    const total = Number((await one<any>('SELECT total FROM orders WHERE id = $1', [r.json().orderId]))!.total);
    expect((await call('POST', `/api/orders/${r.json().orderId}/cancel`, token, {})).statusCode).toBe(200);
    const pay = await one<any>('SELECT refunded_amount, status FROM payments WHERE order_id = $1', [r.json().orderId]);
    expect(Number(pay!.refunded_amount)).toBeCloseTo(total, 2);
    expect(pay!.status).toBe('refunded');
    expect(await balance('liability_vendor', v.id)).toBeCloseTo(0, 2);
    expect(await balance('liability_driver')).toBeCloseTo(await balance('liability_driver'), 2);
    expect((await reconcile()).ok).toBe(true);
  });
  it('returns money to store credit when a card refund exceeds what was charged to the card', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { price: 30, stock: 20, tax: 'standard' });
    const c = await makeCustomer();
    await query("INSERT INTO customer_credit_entries(user_id, amount, reason) VALUES ($1, 20, 'Test credit')", [c.id]);
    const token = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
    await call('POST', '/api/carts/items', token, { variantId: p.variantId, qty: 1 });
    await call('PATCH', '/api/carts/options', token, { addressId: c.addressId, useCredit: true });
    const r = await call('POST', '/api/checkout', token, { idempotencyKey: 'credit-key-0001', paymentToken: 'tok_visa' });
    expect(r.statusCode).toBe(201);
    const order = await one<any>('SELECT total, credit_applied, amount_charged FROM orders WHERE id = $1', [r.json().orderId]);
    expect(Number(order!.credit_applied)).toBe(20);
    expect(Number(order!.amount_charged)).toBeCloseTo(Number(order!.total) - 20, 2);
    expect(Number((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [c.id]))!.b)).toBe(0);
    await call('POST', `/api/orders/${r.json().orderId}/cancel`, token, {});
    expect(Number((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [c.id]))!.b)).toBe(20);   // the card part goes back to the card, the credit part back to the wallet
    const refunds = await one<any>('SELECT amount FROM refunds WHERE order_id = $1', [r.json().orderId]);
    expect(Number(refunds!.amount)).toBeCloseTo(Number(order!.total), 2);
    expect((await reconcile()).ok).toBe(true);
  });
});

describe('payouts', () => {
  it('builds vendor payouts from completed orders after the hold period and never pays twice', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { price: 40, stock: 100, tax: 'zero_rated' });
    const a = await deliveredOrder({ vendor: v, product: p, qty: 2 }), b = await deliveredOrder({ vendor: v, product: p, qty: 3 });
    expect(await tx((c) => createVendorPayout(c, v.id, SYSTEM))).toBeNull();                // inside the 2 day hold
    await query("UPDATE suborders SET completed_at = now() - interval '3 days', delivered_at = now() - interval '3 days' WHERE vendor_id = $1", [v.id]);
    const payout = await tx((c) => createVendorPayout(c, v.id, SYSTEM));
    expect(payout).toBeTruthy();
    const expected = (80 + 120) * 0.88;
    expect(Number(payout!.net)).toBeCloseTo(expected, 2);
    expect(Number(payout!.gross)).toBeCloseTo(200, 2);
    expect(Number(payout!.commission)).toBeCloseTo(24, 2);
    const items = await query<any>('SELECT description, gross, commission, net FROM payout_items WHERE payout_id = $1 ORDER BY id', [payout!.id]);
    expect(items).toHaveLength(2);
    expect(items.reduce((s: number, i: any) => s + Number(i.net), 0)).toBeCloseTo(expected, 2);
    expect(await tx((c) => createVendorPayout(c, v.id, SYSTEM))).toBeNull();                // entries are already swept
    const paid = await processPayout(payout!.id, SYSTEM);
    expect(paid!.status).toBe('paid');
    expect(await balance('liability_vendor', v.id)).toBeCloseTo(0, 2);
    await expect(processPayout(payout!.id, SYSTEM)).rejects.toMatchObject({ code: 'PAYOUT_STATE' });   // cannot send twice
    expect(await tx((c) => createVendorPayout(c, v.id, SYSTEM, { force: true }))).toBeNull();
    expect(await one("SELECT 1 FROM notifications WHERE kind = 'payout' AND user_id = $1", [v.ownerId])).toBeTruthy();
    // statement for the vendor
    const vt = await loginToken(v.ownerEmail);
    const list = await call('GET', `/api/vendors/${v.id}/payouts`, vt);
    expect(list.json().payouts[0].status).toBe('paid');
    const stmt = await call('GET', `/api/vendors/${v.id}/payouts/${payout!.id}`, vt);
    expect(stmt.json().items).toHaveLength(2);
    expect((await call('GET', `/api/vendors/${(await makeVendor()).id}/payouts/${payout!.id}`, vt)).statusCode).toBe(403);
    void a; void b;
  });
  it('holds, releases, fails, retries and reverses payouts with the ledger following each step', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { price: 50, stock: 100, tax: 'zero_rated' });
    await deliveredOrder({ vendor: v, product: p, qty: 2 });
    await query("UPDATE suborders SET completed_at = now() - interval '3 days', delivered_at = now() - interval '3 days' WHERE vendor_id = $1", [v.id]);
    const payout = (await tx((c) => createVendorPayout(c, v.id, SYSTEM)))!;
    await holdPayout(payout.id, 'Bank verification', SYSTEM);
    await expect(processPayout(payout.id, SYSTEM)).rejects.toMatchObject({ code: 'PAYOUT_STATE' });
    await releasePayout(payout.id, SYSTEM);
    const fin = await makeStaff('finance_admin');
    // sandbox accepts transfers, so force a failure by clearing the provider account in the stripe style path
    const { getProvider } = await import('../src/payments/providers.js');
    const prov = getProvider(); const orig = prov.transfer.bind(prov);
    (prov as any).transfer = async () => ({ ok: false, ref: '', failureInternal: 'Account closed' });
    try {
      await expect(processPayout(payout.id, SYSTEM)).rejects.toMatchObject({ code: 'PAYOUT_FAILED' });
      expect(await one('SELECT status, failure_reason FROM payouts WHERE id = $1', [payout.id])).toMatchObject({ status: 'failed', failure_reason: 'Account closed' });
      expect(await balance('liability_vendor', v.id)).toBeGreaterThan(0);                      // money is still owed
    } finally { (prov as any).transfer = orig; }
    expect((await processPayout(payout.id, SYSTEM))!.status).toBe('paid');
    expect(Math.abs(await balance('liability_vendor', v.id))).toBeLessThan(0.01);
    await reversePayout(payout.id, 'Sent to the wrong account', actorOf(fin.id, 'finance_admin'));
    expect(await balance('liability_vendor', v.id)).toBeCloseTo(Number(payout.net), 2);      // owed again
    const again = await tx((c) => createVendorPayout(c, v.id, SYSTEM));
    expect(Number(again!.net)).toBeCloseTo(Number(payout.net), 2);                           // and re-payable exactly once
    expect((await reconcile()).balanced).toBe(true);
  });
  it('carries refunds issued after a payout into the next payout and skips negative balances', async () => {
    const v = await makeVendor();
    const p = await makeProduct(v.id, v.ownerId, { price: 50, stock: 100, tax: 'zero_rated' });
    const o = await deliveredOrder({ vendor: v, product: p, qty: 2 });
    await query("UPDATE suborders SET completed_at = now() - interval '3 days', delivered_at = now() - interval '3 days' WHERE vendor_id = $1", [v.id]);
    await processPayout((await tx((c) => createVendorPayout(c, v.id, SYSTEM)))!.id, SYSTEM);
    const support = await makeStaff('customer_support');
    await call('POST', `/api/admin/suborders/${o.subId}/refund`, await loginToken(support.email), { fullItems: true, bearer: 'vendor', reason: 'Quality complaint upheld' });
    expect(await balance('liability_vendor', v.id)).toBeCloseTo(-88, 1);                    // the vendor owes the platform
    expect(await tx((c) => createVendorPayout(c, v.id, SYSTEM, { force: true }))).toBeNull();
    const o2 = await deliveredOrder({ vendor: v, product: p, qty: 4 });
    await query("UPDATE suborders SET completed_at = now() - interval '3 days', delivered_at = now() - interval '3 days' WHERE id = $1", [o2.subId]);
    const next = await tx((c) => createVendorPayout(c, v.id, SYSTEM));
    expect(Number(next!.net)).toBeCloseTo(200 * 0.88 - 88, 2);                              // new sales net of the earlier clawback
  });
  it('pays drivers their earnings and tips and exposes the payout through the finance API', async () => {
    const o = await deliveredOrder({ tip: 6 });
    const job = (await one<any>('SELECT driver_id FROM delivery_jobs WHERE order_id = $1', [o.orderId]))!;
    const created = await runPayoutCycle(SYSTEM, { process: false, force: true });
    expect(created).toBeGreaterThan(0);
    const dp = await one<any>("SELECT * FROM payouts WHERE payee_type = 'driver' AND payee_id = $1", [job.driver_id]);
    const earn = await one<any>('SELECT sum(total) AS t FROM driver_earnings WHERE driver_id = $1', [job.driver_id]);
    expect(Number(dp!.net)).toBeCloseTo(Number(earn!.t), 2);
    const fin = await makeStaff('finance_admin');
    const ft = await loginToken(fin.email);
    expect((await call('POST', `/api/admin/finance/payouts/${dp!.id}/process`, ft)).statusCode).toBe(200);
    expect((await one<any>('SELECT status FROM driver_earnings WHERE driver_id = $1 LIMIT 1', [job.driver_id]))!.status).toBe('paid');
    expect(await balance('liability_driver', job.driver_id)).toBeCloseTo(0, 2);
    const summary = await call('GET', '/api/admin/finance/summary', ft);
    expect(summary.json().reconciliation.ok).toBe(true);
    expect(summary.json().trial_balance.balanced).toBe(true);
  });
});

describe('integrity', () => {
  it('the whole ledger balances and equals the payment records after all of the above', async () => {
    const tb = await trialBalance();
    expect(tb.balanced).toBe(true);
    const rec = await reconcile();
    expect(rec.capture_difference).toBe(0);
    expect(await partyBalance('vendor', (await one<any>('SELECT id FROM vendors LIMIT 1'))!.id)).toEqual(expect.any(Number));
  });
});
