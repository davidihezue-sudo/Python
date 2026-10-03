// Vendor and customer driven order lifecycle: accept, prepare, ready, collect, cancel, complete.
import type pg from 'pg';
import { query, one, tx } from '../../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { fromCents, toCents } from '../../money.js';
import { getSetting } from '../../lib/settings.js';
import { notify, notifyVendor, notifyStaff } from '../../lib/notifications.js';
import { publish } from '../../lib/events.js';
import { audit, type Actor } from '../../lib/audit.js';
import { enqueue } from '../../lib/jobs.js';
import { commitOrder, releaseOrder, returnStock } from '../inventory.js';
import { getProvider } from '../../payments/providers.js';
import { addHistory, recomputeOrderStatus, transitionSuborder } from './core.js';
import { ensureCaptured } from './checkout.js';
import { refundSuborder } from './refunds.js';
import { markJobReady, cancelJobForSuborder } from '../deliveries.js';
import { awardOrderCompletion } from '../loyalty.js';
import { trackEvent } from '../analytics.js';

type C = pg.PoolClient;

async function loadForVendor(c: C, vendorId: string, suborderId: string) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [suborderId], c);
  if (!s || s.vendor_id !== vendorId) throw notFound('That order');
  return s;
}

export async function acceptSuborder(vendorId: string, suborderId: string, actor: Actor, opts: { prepMinutes?: number } = {}) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    const prep = opts.prepMinutes ?? s.prep_minutes;
    if (prep < 1 || prep > 600) throw badRequest('VALIDATION', 'Enter a preparation time between 1 and 600 minutes.');
    const pay = await getSetting('payments', c as any);
    const inv = await getSetting('inventory', c as any);
    await transitionSuborder(c, suborderId, 'vendor_accepted', actor, {
      set: { prep_minutes: prep, estimated_ready_at: new Date(Date.now() + prep * 60000) },
    });
    if (pay.capture_mode === 'on_acceptance') await ensureCaptured(c, s.order_id, actor);
    if (inv.commit_stage === 'vendor_accept') {
      const variants = (await query<any>('SELECT variant_id FROM order_items WHERE suborder_id = $1', [suborderId], c)).map((r) => r.variant_id);
      await commitOrder(c, s.order_id, variants, actor.userId);
    }
    const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [s.order_id], c);
    const v = await one<any>('SELECT trading_name FROM vendors WHERE id = $1', [vendorId], c);
    await notify({ userId: order.user_id, kind: 'vendor_accepted', title: `${v.trading_name} accepted your order`, body: `Preparing now. Estimated ready in about ${prep} minutes.`, data: { orderId: s.order_id, suborderId } }, c);
    await recomputeOrderStatus(c, s.order_id, actor);
    await audit(actor, 'suborder.accepted', 'suborder', suborderId, { prepMinutes: prep }, c);
    return one('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  });
}

export async function startPreparing(vendorId: string, suborderId: string, actor: Actor) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    await transitionSuborder(c, suborderId, 'preparing', actor);
    await recomputeOrderStatus(c, s.order_id, actor);
    return one('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  });
}

export async function markReady(vendorId: string, suborderId: string, actor: Actor) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    await transitionSuborder(c, suborderId, 'ready_for_pickup', actor);
    const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [s.order_id], c);
    if (s.fulfillment_type === 'delivery_platform') await markJobReady(c, suborderId);
    const msg = s.fulfillment_type === 'pickup' ? `Your order is ready to collect. Pickup code ${s.pickup_code}.` : s.fulfillment_type === 'delivery_vendor' ? 'Your order is ready and will head out shortly.' : 'Your order is ready. We are finding a driver.';
    await notify({ userId: order.user_id, kind: 'order_ready', title: `Order ${s.number} is ready`, body: msg, data: { orderId: s.order_id, suborderId } }, c);
    await recomputeOrderStatus(c, s.order_id, actor);
    return one('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  });
}

/** Customer collects a pickup order. The pickup code proves it is the right person. */
export async function collectPickup(vendorId: string, suborderId: string, code: string, actor: Actor) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    if (s.fulfillment_type !== 'pickup') throw badRequest('NOT_PICKUP', 'This is not a pickup order.');
    if (s.status !== 'ready_for_pickup') throw conflict('INVALID_TRANSITION', 'This order is not ready for pickup yet.');
    if (String(code).trim() !== s.pickup_code) throw badRequest('BAD_CODE', 'That pickup code does not match.');
    await transitionSuborder(c, suborderId, 'picked_up', actor, { note: 'Collected by customer' });
    await completeSuborder(c, suborderId, actor);
    return one('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  });
}

/** Vendor operated delivery: out for delivery then delivered. */
export async function vendorDeliveryStep(vendorId: string, suborderId: string, step: 'out' | 'delivered', actor: Actor) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    if (s.fulfillment_type !== 'delivery_vendor') throw forbidden('This order is delivered by EAZyfoods drivers.');
    if (step === 'out') {
      await transitionSuborder(c, suborderId, 'picked_up', actor, { note: 'Out for delivery' });
      await transitionSuborder(c, suborderId, 'in_transit', actor);
    } else {
      await transitionSuborder(c, suborderId, 'delivered', actor);
      await finishDelivered(c, suborderId, actor);
    }
    await recomputeOrderStatus(c, s.order_id, actor);
    return one('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  });
}

/** Called after a suborder reaches delivered. Completes immediately or after the configured delay. */
export async function finishDelivered(c: C, suborderId: string, actor: Actor) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [s.order_id], c);
  await notify({ userId: order.user_id, kind: 'delivered', title: `Order ${s.number} delivered`, body: 'Enjoy your food! You can rate your order from your account.', data: { orderId: s.order_id, suborderId } }, c);
  const settings = await getSetting('orders', c as any);
  if (settings.auto_complete_minutes > 0) {
    await enqueue('complete_suborder', { suborderId }, { runAt: new Date(Date.now() + settings.auto_complete_minutes * 60000), uniqueKey: `complete:${suborderId}`, db: c });
  } else {
    await completeSuborder(c, suborderId, actor);
  }
}

export async function completeSuborder(c: C, suborderId: string, actor: Actor) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1', [suborderId], c);
  if (!s || ['completed', 'cancelled', 'refunded'].includes(s.status)) return;
  await transitionSuborder(c, suborderId, 'completed', actor);
  await trackEvent('suborder_completed', { entityType: 'suborder', entityId: suborderId, props: { vendorId: s.vendor_id, total: Number(s.customer_total) } }, c).catch(() => {});
  const status = await recomputeOrderStatus(c, s.order_id, actor);
  if (status === 'completed') await awardOrderCompletion(c, s.order_id);
}

// ---- cancellation ----

/** Whether a customer may cancel this suborder on their own. */
async function customerMayCancel(s: any) {
  const o = await getSetting('orders');
  if (['pending_payment', 'confirmed'].includes(s.status)) return true;
  if (s.status === 'vendor_accepted') return Date.now() - new Date(s.accepted_at).getTime() <= o.cancel_after_accept_minutes * 60000;
  return false;
}

export async function customerCancel(userId: string, orderId: string, suborderId: string | null, actor: Actor) {
  return tx(async (c) => {
    const order = await one<any>('SELECT * FROM orders WHERE id = $1', [orderId], c);
    if (!order || order.user_id !== userId) throw notFound('That order');
    const subs = await query<any>('SELECT * FROM suborders WHERE order_id = $1 AND ($2::uuid IS NULL OR id = $2) FOR UPDATE', [orderId, suborderId], c);
    if (!subs.length) throw notFound('That order');
    const cancellable = subs.filter((s) => s.status !== 'cancelled');
    for (const s of cancellable) {
      if (!(await customerMayCancel(s))) {
        throw new AppError('CANNOT_CANCEL', 409, `${s.number} is already being prepared, so it can not be cancelled online. Please contact support and we will help.`);
      }
    }
    if (order.status === 'pending_payment') { await cancelUnpaidOrder(c, orderId, actor, 'Cancelled by customer'); return { cancelled: cancellable.length }; }
    for (const s of cancellable) await cancelSuborder(c, s.id, actor, { reason: 'Cancelled by customer', by: 'customer' });
    return { cancelled: cancellable.length };
  });
}

export async function vendorCancel(vendorId: string, suborderId: string, reason: string, actor: Actor, rejected = false) {
  return tx(async (c) => {
    const s = await loadForVendor(c, vendorId, suborderId);
    if (!reason.trim()) throw badRequest('VALIDATION', 'Please tell the customer why.');
    await cancelSuborder(c, suborderId, actor, { reason: rejected ? `Rejected by store: ${reason}` : `Cancelled by store: ${reason}`, by: 'vendor' });
    return one('SELECT * FROM suborders WHERE id = $1', [s.id], c);
  });
}

/** Cancel orders that never got paid. Releases stock and promotions. */
export async function cancelUnpaidOrder(c: C, orderId: string, actor: Actor, reason: string) {
  const subs = await query<any>("SELECT id, status FROM suborders WHERE order_id = $1 FOR UPDATE", [orderId], c);
  for (const s of subs) if (s.status === 'pending_payment') await transitionSuborder(c, s.id, 'cancelled', actor, { note: reason, set: { cancel_reason: reason, cancelled_by: 'system' } });
  await releaseOrder(c, orderId, actor.userId);
  await query("UPDATE orders SET payment_status = 'voided' WHERE id = $1 AND payment_status <> 'paid'", [orderId], c);
  await returnCredit(c, orderId, null, 'Order cancelled before payment');
  await reversePromotions(c, orderId);
  await recomputeOrderStatus(c, orderId, actor);
}

async function returnCredit(c: C, orderId: string, share: number | null, reason: string) {
  const order = await one<any>('SELECT user_id, credit_applied FROM orders WHERE id = $1', [orderId], c);
  const amount = share ?? toCents(order.credit_applied);
  if (amount > 0) await query('INSERT INTO customer_credit_entries(user_id, amount, reason, order_id) VALUES ($1,$2,$3,$4)', [order.user_id, fromCents(amount), reason, orderId], c);
}

export async function reversePromotions(c: C, orderId: string) {
  const live = await one('SELECT 1 FROM suborders WHERE order_id = $1 AND status <> $2 LIMIT 1', [orderId, 'cancelled'], c);
  if (live) return;
  const rows = await query<any>("UPDATE promotion_redemptions SET status = 'reversed' WHERE order_id = $1 AND status = 'active' RETURNING promotion_id", [orderId], c);
  for (const r of rows) await query('UPDATE promotions SET redemption_count = GREATEST(redemption_count - 1, 0) WHERE id = $1', [r.promotion_id], c);
}

export async function cancelSuborder(c: C, suborderId: string, actor: Actor, opts: { reason: string; by: 'customer' | 'vendor' | 'admin' | 'system'; refundBearer?: 'vendor' | 'platform' }) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [suborderId], c);
  if (!s) throw notFound('That order');
  const from = s.status;
  await transitionSuborder(c, suborderId, 'cancelled', actor, { note: opts.reason, set: { cancel_reason: opts.reason, cancelled_by: opts.by } });
  const captured = await one('SELECT 1 FROM ledger_entries WHERE suborder_id = $1 AND entry_type = $2 LIMIT 1', [suborderId, 'capture'], c);

  // Stock: still reserved goes back to available; already committed goes back to on hand only if food was not yet prepared.
  const items = await query<any>('SELECT * FROM order_items WHERE suborder_id = $1', [suborderId], c);
  const variantIds = items.map((i) => i.variant_id);
  const before = await query<any>(`SELECT variant_id FROM inventory_movements WHERE ref_type='order' AND ref_id=$1 AND variant_id = ANY($2::uuid[]) GROUP BY variant_id HAVING sum(delta_reserved) > 0`, [s.order_id, variantIds], c);
  const stillReserved = new Set(before.map((r) => r.variant_id));
  await releaseOrder(c, s.order_id, actor.userId, [...stillReserved]);
  if (['confirmed', 'vendor_accepted', 'pending_payment'].includes(from)) {
    for (const it of items) if (!stillReserved.has(it.variant_id)) await returnStock(c, it.variant_id, it.quantity - it.refunded_qty, s.order_id, actor.userId);
  }
  await cancelJobForSuborder(c, suborderId, `Order cancelled: ${opts.reason}`);

  if (captured) {
    await refundSuborder(c, { suborderId, fullItems: true, includeDelivery: true, includeServiceFee: true, includeTip: true, bearer: opts.refundBearer ?? 'vendor', reason: opts.reason }, actor);
  } else if (from !== 'pending_payment') {
    // Authorized but not yet captured (on_acceptance mode): nothing to refund, return any credit used.
    const order = await one<any>('SELECT credit_applied, total FROM orders WHERE id = $1', [s.order_id], c);
    const share = toCents(order.total) > 0 ? Math.round((toCents(order.credit_applied) * toCents(s.customer_total)) / toCents(order.total)) : 0;
    await returnCredit(c, s.order_id, share, `Credit returned for cancelled ${s.number}`);
  }
  // If every suborder is now cancelled and the payment was only authorized, void the authorization.
  const open = await one('SELECT 1 FROM suborders WHERE order_id = $1 AND status <> $2 LIMIT 1', [s.order_id, 'cancelled'], c);
  if (!open) {
    const p = await one<any>("SELECT * FROM payments WHERE order_id = $1 AND status = 'authorized'", [s.order_id], c);
    if (p) {
      await getProvider().void(p.provider_ref);
      await query("UPDATE payments SET status = 'voided', voided_at = now() WHERE id = $1", [p.id], c);
      await query("INSERT INTO payment_transactions(payment_id, kind, amount, status, provider_ref) VALUES ($1,'void',$2,'succeeded',$3)", [p.id, p.amount, p.provider_ref], c);
      await query("UPDATE orders SET payment_status = 'voided' WHERE id = $1", [s.order_id], c);
    }
  }
  await reversePromotions(c, s.order_id);
  const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [s.order_id], c);
  await notify({ userId: order.user_id, kind: 'order_cancelled', title: `Order ${s.number} cancelled`, body: `${opts.reason}. ${captured ? 'You have been refunded in full.' : 'You were not charged.'}`, data: { orderId: s.order_id, suborderId } }, c);
  if (opts.by !== 'vendor') await notifyVendor(s.vendor_id, { kind: 'order_cancelled', title: `Order ${s.number} cancelled`, body: opts.reason, data: { suborderId } }, c);
  await recomputeOrderStatus(c, s.order_id, actor);
  await audit(actor, 'suborder.cancelled', 'suborder', suborderId, { reason: opts.reason, by: opts.by, from }, c);
}

/** Admin: cancel with explicit bearer, used from the operations console. */
export async function adminCancel(suborderId: string, reason: string, actor: Actor) {
  return tx(async (c) => { await cancelSuborder(c, suborderId, actor, { reason, by: 'admin', refundBearer: 'platform' }); });
}

/** Vendor never responded. Cancel and alert operations. */
export async function vendorAcceptTimeout(suborderId: string) {
  await tx(async (c) => {
    const s = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [suborderId], c);
    if (!s || s.status !== 'confirmed') return;
    await cancelSuborder(c, suborderId, { userId: null, role: 'system' }, { reason: 'The store did not respond in time', by: 'system', refundBearer: 'platform' });
    await notifyStaff('orders.manage', { kind: 'vendor_issue', title: `Vendor missed order ${s.number}`, body: 'The store did not accept in time and the order was cancelled and refunded.', data: { suborderId } }, c);
    await query(`INSERT INTO operational_alerts(kind, severity, title, details, entity_type, entity_id, dedupe_key) VALUES ('vendor_timeout','high',$1,$2,'suborder',$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`Vendor did not accept ${s.number}`, JSON.stringify({ vendorId: s.vendor_id }), suborderId, `vt:${suborderId}`], c);
  });
}
