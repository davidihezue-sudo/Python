import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeDriver, makeStaff, loginToken, bearer, query, one, makeUser, actorOf } from './helpers.js';
import { runDueJobs } from '../src/lib/jobs.js';
import { reconcile } from '../src/modules/ledger.js';
import { scanDocumentExpiry, addDocument, reviewDocument } from '../src/modules/compliance.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });
const call = (method: string, url: string, token: string | null, payload?: any) => app.inject({ method: method as any, url, payload, headers: token ? bearer(token) : {} });

async function completedOrder(o: { pickup?: boolean; vendor?: any; product?: any } = {}) {
  const v = o.vendor ?? (await makeVendor());
  const p = o.product ?? (await makeProduct(v.id, v.ownerId, { price: 30, stock: 100, tax: 'zero_rated' }));
  const c = await makeCustomer();
  const token = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
  const vt = await loginToken(v.ownerEmail);
  await call('POST', '/api/carts/items', token, { variantId: p.variantId, qty: 2 });
  await call('PATCH', '/api/carts/options', token, { addressId: c.addressId, fulfillment: { [v.id]: { mode: 'pickup' } } });
  const r = await call('POST', '/api/checkout', token, { idempotencyKey: 'sup-' + Math.random().toString(36).slice(2) + '-key', paymentToken: 'tok_visa' });
  const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [r.json().orderId]))!;
  return { v, p, c, token, vt, orderId: r.json().orderId as string, sub, finish: async () => { for (const a of ['accept', 'prepare', 'ready']) await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/${a}`, vt, {}); await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/collect`, vt, { code: sub.pickup_code }); } };
}

describe('reviews', () => {
  it('only allows reviews of delivered orders by the customer who placed them, once per subject', async () => {
    const o = await completedOrder();
    const review = (payload: any, token = o.token) => call('POST', '/api/reviews', token, { suborderId: o.sub.id, ...payload });
    expect((await review({ subjectType: 'vendor', rating: 5 })).statusCode).toBe(403);            // not delivered yet
    await o.finish();
    const stranger = await makeCustomer();
    const st = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [stranger.id]))!.email);
    expect((await review({ subjectType: 'vendor', rating: 5 }, st)).statusCode).toBe(404);          // someone else's order
    expect((await review({ subjectType: 'vendor', rating: 6 })).statusCode).toBe(400);
    expect((await review({ subjectType: 'vendor', rating: 0 })).statusCode).toBe(400);
    expect((await review({ subjectType: 'product', rating: 4, subjectId: (await makeProduct((await makeVendor()).id, o.v.ownerId)).id })).statusCode).toBe(403);   // item not in this order
    expect((await review({ subjectType: 'driver', rating: 4 })).statusCode).toBe(403);               // pickup had no driver
    const ok = await review({ subjectType: 'vendor', rating: 4, title: 'Good', body: 'Tasty and quick' });
    expect(ok.statusCode).toBe(201);
    expect((await review({ subjectType: 'vendor', rating: 5 })).statusCode).toBe(409);
    expect((await review({ subjectType: 'product', rating: 5, subjectId: o.p.id })).statusCode).toBe(201);
    expect((await one<any>('SELECT rating_avg, rating_count FROM vendors WHERE id = $1', [o.v.id]))).toMatchObject({ rating_avg: 4, rating_count: 1 });
    expect((await one<any>('SELECT rating_avg FROM products WHERE id = $1', [o.p.id]))!.rating_avg).toBe(5);
  });
  it('lets the vendor respond and staff moderate, updating the public rating', async () => {
    const o = await completedOrder();
    await o.finish();
    const rv = await call('POST', '/api/reviews', o.token, { suborderId: o.sub.id, subjectType: 'vendor', rating: 1, body: 'Terrible' });
    const rid = rv.json().review.id;
    expect(Number((await one<any>('SELECT rating_avg FROM vendors WHERE id = $1', [o.v.id]))!.rating_avg)).toBe(1);
    expect((await call('POST', `/api/vendors/${o.v.id}/reviews/${rid}/respond`, o.vt, { text: 'We are sorry to hear that and have refunded you.' })).statusCode).toBe(200);
    expect((await call('POST', `/api/vendors/${(await makeVendor()).id}/reviews/${rid}/respond`, o.vt, { text: 'hijack' })).statusCode).toBe(403);
    const store = (await call('GET', `/api/stores/${o.v.slug}`, null)).json().store;
    expect(store.reviews[0].vendor_response).toContain('sorry');
    expect(store.reviews[0].full_name).toBe('Amara T.');                                          // reviewer names are shortened
    const sup = await makeStaff('customer_support');
    expect((await call('POST', `/api/admin/reviews/${rid}/moderate`, await loginToken(sup.email), { status: 'hidden', note: 'Abusive language' })).statusCode).toBe(200);
    expect(Number((await one<any>('SELECT rating_count FROM vendors WHERE id = $1', [o.v.id]))!.rating_count)).toBe(0);
    expect((await call('GET', `/api/stores/${o.v.slug}`, null)).json().store.reviews).toHaveLength(0);
    expect((await call('POST', `/api/admin/reviews/${rid}/moderate`, o.token, { status: 'published' })).statusCode).toBe(403);
  });
});

describe('support tickets', () => {
  it('runs the ticket lifecycle with statuses, assignment, internal notes and visibility rules', async () => {
    const o = await completedOrder();
    const t = await call('POST', '/api/tickets', o.token, { category: 'late_delivery', subject: 'Order is late', body: 'It has been an hour.', suborderId: o.sub.id });
    expect(t.statusCode).toBe(201);
    const id = t.json().ticket.id;
    expect(t.json().ticket.number).toMatch(/^T-\d+$/);
    expect(t.json().ticket).toMatchObject({ status: 'open', vendor_id: o.v.id });
    const agent = await makeStaff('customer_support');
    const at = await loginToken(agent.email);
    expect((await call('GET', '/api/tickets?scope=all&status=open', at)).json().tickets.some((x: any) => x.id === id)).toBe(true);
    expect((await call('PATCH', `/api/tickets/${id}`, at, { assigned_to: agent.id })).json().ticket.status).toBe('assigned');
    expect((await call('PATCH', `/api/tickets/${id}`, at, { assigned_to: o.c.id })).statusCode).toBe(400);               // customers cannot be assignees
    await call('POST', `/api/tickets/${id}/messages`, at, { body: 'Checking with the store, one moment.' });
    await call('POST', `/api/tickets/${id}/messages`, at, { body: 'Customer is a repeat buyer, be generous.', internal: true });
    const cust = (await call('GET', `/api/tickets/${id}`, o.token)).json();
    expect(cust.ticket.status).toBe('waiting_customer');
    expect(cust.messages.map((m: any) => m.body)).toEqual(['It has been an hour.', 'Checking with the store, one moment.']);   // internal notes hidden
    const staff = (await call('GET', `/api/tickets/${id}`, at)).json();
    expect(staff.messages).toHaveLength(3);
    await call('POST', `/api/tickets/${id}/messages`, o.token, { body: 'Thanks, still waiting.' });
    expect((await call('GET', `/api/tickets/${id}`, at)).json().ticket.status).toBe('assigned');                         // customer reply reopens work
    await call('PATCH', `/api/tickets/${id}`, at, { status: 'waiting_vendor' });
    const vendorView = await call('GET', `/api/tickets/${id}`, o.vt);
    expect(vendorView.statusCode).toBe(200);
    expect(vendorView.json().messages.every((m: any) => !m.is_internal)).toBe(true);
    await call('PATCH', `/api/tickets/${id}`, at, { status: 'resolved', resolution_note: 'Delivered with a credit' });
    await call('PATCH', `/api/tickets/${id}`, at, { status: 'closed' });
    expect((await call('POST', `/api/tickets/${id}/messages`, o.token, { body: 'One more thing' })).statusCode).toBe(409);
    expect((await call('PATCH', `/api/tickets/${id}`, at, { status: 'nonsense' })).statusCode).toBe(400);
    // strangers and other vendors cannot read it
    const other = await makeCustomer();
    expect((await call('GET', `/api/tickets/${id}`, await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [other.id]))!.email))).statusCode).toBe(404);
    expect((await call('GET', `/api/tickets/${id}`, await loginToken((await makeVendor()).ownerEmail))).statusCode).toBe(404);
    expect((await call('PATCH', `/api/tickets/${id}`, o.token, { status: 'open' })).statusCode).toBe(403);
    expect((await call('POST', '/api/tickets', other.id ? await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [other.id]))!.email) : '', { category: 'other', subject: 'x y z', body: 'hello there', suborderId: o.sub.id })).statusCode).toBe(403);
    expect(await query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'support_update'", [o.c.id])).not.toHaveLength(0);
  });
  it('limits order chat to the people on the order and masks contact details', async () => {
    const o = await completedOrder();
    const send = (token: string, channel: string, body: string) => call('POST', `/api/suborders/${o.sub.id}/messages`, token, { channel, body });
    expect((await send(o.token, 'customer_vendor', 'Please add extra pepper')).statusCode).toBe(200);
    expect((await send(o.vt, 'customer_vendor', 'Of course!')).statusCode).toBe(200);
    const thread = (await call('GET', `/api/suborders/${o.sub.id}/messages?channel=customer_vendor`, o.token)).json().messages;
    expect(thread.map((m: any) => m.body)).toEqual(['Please add extra pepper', 'Of course!']);
    expect(thread[0].mine).toBe(true);
    expect(JSON.stringify(thread)).not.toMatch(/sender_id|@/);
    expect((await send(o.token, 'vendor_driver', 'hello')).statusCode).toBe(403);                  // customer is not part of that channel
    expect((await send(o.token, 'customer_driver', 'where are you')).statusCode).toBe(409);        // no driver on a pickup order
    const stranger = await loginToken((await makeVendor()).ownerEmail);
    expect((await send(stranger, 'customer_vendor', 'spam')).statusCode).toBe(403);
    expect((await call('GET', `/api/suborders/${o.sub.id}/messages?channel=customer_vendor`, stranger)).statusCode).toBe(403);
    expect((await send(o.token, 'customer_vendor', '')).statusCode).toBe(400);
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'message'", [o.v.ownerId])).toBeTruthy();
  });
});

describe('disputes', () => {
  it('resolves a missing item dispute with a partial refund and records the decision', async () => {
    const o = await completedOrder();
    await o.finish();
    const open = await call('POST', `/api/suborders/${o.sub.id}/dispute`, o.token, { reason: 'One pack of rice was missing from the bag.', category: 'missing_items', claimedAmount: 30 });
    expect(open.statusCode).toBe(201);
    const did = open.json().dispute.id;
    expect((await call('POST', `/api/suborders/${o.sub.id}/dispute`, o.token, { reason: 'Again and again' })).statusCode).toBe(409);
    expect((await one<any>('SELECT status FROM suborders WHERE id = $1', [o.sub.id]))!.status).toBe('disputed');
    expect((await one<any>('SELECT status FROM orders WHERE id = $1', [o.orderId]))!.status).toBe('disputed');
    // vendor responds
    expect((await call('GET', `/api/vendors/${o.v.id}/disputes`, o.vt)).json().disputes[0].items[0].name).toBeTruthy();
    expect((await call('POST', `/api/vendors/${o.v.id}/disputes/${did}/respond`, o.vt, { text: 'All items were packed and photographed.' })).statusCode).toBe(200);
    const sup = await makeStaff('customer_support');
    const st = await loginToken(sup.email);
    const detail = (await call('GET', `/api/disputes/${did}`, st)).json();
    expect(detail.dispute.vendor_response).toContain('photographed');
    expect(detail.items).toHaveLength(1); expect(detail.suborder.status).toBe('disputed');
    expect((await call('POST', `/api/disputes/${did}/resolve`, st, { resolution: 'partial_refund', amount: 30, reason: '' })).statusCode).toBe(400);   // a reason is required
    expect((await call('POST', `/api/disputes/${did}/resolve`, o.token, { resolution: 'full_refund', reason: 'I want it' })).statusCode).toBe(403);
    const res = await call('POST', `/api/disputes/${did}/resolve`, st, { resolution: 'partial_refund', amount: 30, reason: 'Packing photos show only one pack of rice.', bearer: 'vendor' });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBeCloseTo(30, 2);                                                      // $30 of zero rated groceries, no tax share
    const d = await one<any>('SELECT status, resolution, resolution_amount, resolution_reason, resolved_by FROM disputes WHERE id = $1', [did]);
    expect(d).toMatchObject({ status: 'resolved', resolution: 'partial_refund', resolved_by: sup.id });
    expect(d!.resolution_reason).toContain('photos');
    expect(['partially_refunded', 'completed']).toContain((await one<any>('SELECT status FROM suborders WHERE id = $1', [o.sub.id]))!.status);
    expect(await one<any>('SELECT status FROM support_tickets WHERE id = $1', [open.json().ticket.id])).toMatchObject({ status: 'resolved' });
    expect((await call('POST', `/api/disputes/${did}/resolve`, st, { resolution: 'no_refund', reason: 'again' })).statusCode).toBe(409);
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'dispute.resolved' AND actor_user_id = $1", [sup.id])).toBeTruthy();
    expect((await reconcile()).ok).toBe(true);
  });
  it('supports credits, no refund and enforces the dispute window', async () => {
    const a = await completedOrder(); await a.finish();
    const da = (await call('POST', `/api/suborders/${a.sub.id}/dispute`, a.token, { reason: 'The food was not as described.' })).json().dispute.id;
    const st = await loginToken((await makeStaff('customer_support')).email);
    expect((await call('POST', `/api/disputes/${da}/resolve`, st, { resolution: 'customer_credit', amount: 8, reason: 'Goodwill credit' })).statusCode).toBe(200);
    expect(Number((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [a.c.id]))!.b)).toBe(8);
    expect((await one<any>('SELECT status FROM suborders WHERE id = $1', [a.sub.id]))!.status).toBe('completed');
    const b = await completedOrder(); await b.finish();
    const db = (await call('POST', `/api/suborders/${b.sub.id}/dispute`, b.token, { reason: 'Changed my mind about it.' })).json().dispute.id;
    expect((await call('POST', `/api/disputes/${db}/resolve`, st, { resolution: 'no_refund', reason: 'Item matched the listing' })).statusCode).toBe(200);
    expect(await query('SELECT 1 FROM refunds WHERE order_id = $1', [b.orderId])).toHaveLength(0);
    const c = await completedOrder(); await c.finish();
    await query("UPDATE suborders SET delivered_at = now() - interval '30 days', completed_at = now() - interval '30 days' WHERE id = $1", [c.sub.id]);
    expect((await call('POST', `/api/suborders/${c.sub.id}/dispute`, c.token, { reason: 'Very late complaint here.' })).json().error.code).toBe('WINDOW_PASSED');
    const d = await completedOrder();
    expect((await call('POST', `/api/suborders/${d.sub.id}/dispute`, d.token, { reason: 'Not delivered yet!!' })).statusCode).toBe(409);
    // a vendor credit moves money from the platform to the vendor
    const e = await completedOrder(); await e.finish();
    const de = (await call('POST', `/api/suborders/${e.sub.id}/dispute`, e.token, { reason: 'Courier damaged the packaging.' })).json().dispute.id;
    const before = Number((await one<any>("SELECT coalesce(sum(credit - debit),0) AS b FROM ledger_entries WHERE account = 'liability_vendor' AND party_id = $1", [e.v.id]))!.b);
    await call('POST', `/api/disputes/${de}/resolve`, st, { resolution: 'vendor_credit', amount: 5, reason: 'Vendor was not at fault' });
    expect(Number((await one<any>("SELECT coalesce(sum(credit - debit),0) AS b FROM ledger_entries WHERE account = 'liability_vendor' AND party_id = $1", [e.v.id]))!.b)).toBeCloseTo(before + 5, 2);
    expect((await reconcile()).balanced).toBe(true);
  });
});

describe('compliance', () => {
  it('requires jurisdiction documents before submission and verified documents before approval', async () => {
    const v = await makeVendor({ approved: false });
    const t = await loginToken(v.ownerEmail);
    const sub = await call('POST', `/api/vendors/${v.id}/submit`, t);
    expect(sub.statusCode).toBe(400);
    expect(sub.json().error.code).toBe('MISSING_DOCUMENTS');
    expect(sub.json().error.message).toContain('Business licence');
    const doc = await call('POST', `/api/vendors/${v.id}/documents`, t, { docType: 'business_licence', reference: 'BL-1', issueDate: '2025-01-01', expiryDate: '2024-01-01' });
    expect(doc.statusCode).toBe(400);                                                                // expiry before issue
    const ok = await call('POST', `/api/vendors/${v.id}/documents`, t, { docType: 'business_licence', reference: 'BL-1', issueDate: '2025-01-01', expiryDate: '2030-01-01' });
    expect(ok.statusCode).toBe(201);
    expect((await call('POST', `/api/vendors/${v.id}/submit`, t)).statusCode).toBe(200);
    const admin = await makeStaff('vendor_admin');
    const at = await loginToken(admin.email);
    const approve = await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'approve' });
    expect(approve.statusCode).toBe(409);                                                           // cannot skip review
    await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'start_review' });
    const unverified = await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'approve' });
    expect(unverified.json().error.code).toBe('DOCUMENTS_NOT_VERIFIED');
    expect((await call('POST', `/api/admin/documents/${ok.json().document.id}/review`, at, { status: 'rejected' })).statusCode).toBe(400);     // reason required
    expect((await call('POST', `/api/admin/documents/${ok.json().document.id}/review`, at, { status: 'verified' })).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'approve' })).statusCode).toBe(200);
    expect((await one<any>('SELECT verification_status, approved_by FROM vendors WHERE id = $1', [v.id]))).toMatchObject({ verification_status: 'approved', approved_by: admin.id });
    const p = await makeProduct(v.id, v.ownerId, { price: 5 });
    expect((await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'suspend' })).statusCode).toBe(400);                         // note required
    expect((await call('POST', `/api/admin/vendors/${v.id}/review`, at, { action: 'suspend', note: 'Inspection failed' })).statusCode).toBe(200);
    // a suspended vendor disappears from the marketplace and cannot be ordered from
    expect((await call('GET', `/api/products/${p.slug}`, null)).statusCode).toBe(404);
    expect((await call('POST', '/api/carts/items', null, { variantId: p.variantId, qty: 1 })).statusCode).toBe(404);
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'vendor.approve' AND actor_user_id = $1 AND entity_id = $2", [admin.id, v.id])).toBeTruthy();
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'vendor_status'", [v.ownerId])).toBeTruthy();
  });
  it('can run without approval when configured, and keeps products hidden otherwise', async () => {
    const { setSetting, clearSettingsCache } = await import('./helpers.js');
    const v = await makeVendor({ approved: false });
    const p = await makeProduct(v.id, v.ownerId, { price: 5 }).catch(() => null);
    expect(p).toBeNull();                                                                            // cannot publish before approval
    await setSetting('vendors', { approval_required: false }, null);
    try {
      const p2 = await makeProduct(v.id, v.ownerId, { price: 5 });
      expect((await call('GET', `/api/products/${p2.slug}`, null)).statusCode).toBe(200);
    } finally { await setSetting('vendors', { approval_required: true }, null); clearSettingsCache(); }
  });
  it('flags expiring and expired documents and blocks drivers with expired paperwork', async () => {
    const d = await makeDriver();
    const admin = await makeStaff('compliance_officer');
    const soon = await addDocument({ ownerType: 'driver', ownerId: d.id, docType: 'vehicle_insurance', expiryDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) }, actorOf(d.id, 'driver'));
    await reviewDocument(soon.id, 'verified', undefined, actorOf(admin.id, 'compliance_officer'));
    const r1 = await scanDocumentExpiry();
    expect(r1.warned).toBeGreaterThanOrEqual(1);
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'A document is expiring soon'", [d.id])).toBeTruthy();
    expect((await scanDocumentExpiry()).warned).toBe(0);                                              // no repeat warnings
    await query("UPDATE compliance_documents SET expiry_date = current_date - 1 WHERE id = $1", [soon.id]);
    const r2 = await scanDocumentExpiry();
    expect(r2.expired).toBe(1);
    expect(await one("SELECT 1 FROM operational_alerts WHERE kind = 'document_expired'")).toBeTruthy();
    const dt = await loginToken(d.email);
    const on = await call('POST', '/api/drivers/me/availability', dt, { online: true });
    expect(on.statusCode).toBe(403);
    expect(on.json().error.message).toMatch(/expired/);
  });
});
