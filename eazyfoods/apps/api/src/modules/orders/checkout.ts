// Checkout: quote, reserve, create the master order and vendor suborders, take payment, confirm.
import type pg from 'pg';
import { query, one, tx, advisoryLock } from '../../db.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { buildQuote, quoteToJson, type QuoteRequest } from '../../pricing/service.js';
import type { GroupQuote, Quote } from '../../pricing/types.js';
import { fromCents, toCents, allocate } from '../../money.js';
import { capacityProblem, reserve, commitOrder, deductRecipeIngredients, lowStockCheck } from '../inventory.js';
import { getProvider } from '../../payments/providers.js';
import { getSetting } from '../../lib/settings.js';
import { notify, notifyVendor, notifyStaff } from '../../lib/notifications.js';
import { publish } from '../../lib/events.js';
import { enqueue } from '../../lib/jobs.js';
import { audit, type Actor } from '../../lib/audit.js';
import { randomDigits } from '../../lib/util.js';
import { addHistory, recomputeOrderStatus, transitionSuborder } from './core.js';
import { postCapture, type SuborderMoney } from '../ledger.js';
import { createDeliveryJob } from '../deliveries.js';
import { trackEvent } from '../analytics.js';

type C = pg.PoolClient;
const SUFFIX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface CheckoutInput extends Omit<QuoteRequest, 'userId'> {
  idempotencyKey: string;
  expectedTotal?: number;           // dollars, what the customer saw
  contact?: { name?: string; phone?: string; email?: string };
  note?: string;
  paymentToken?: string;
  cartId?: string;
}

export async function quoteForUser(userId: string | null, req: Omit<QuoteRequest, 'userId'>) {
  const { quote, address } = await buildQuote({ ...req, userId });
  // Chef capacity warnings (non locking preview)
  for (const g of quote.groups) {
    const prob = await capacityFor(null, g, req.fulfillment?.[g.vendorId]?.scheduledFor ?? null);
    if (prob) quote.blockers.push({ code: 'CAPACITY', message: prob, vendorId: g.vendorId });
  }
  quote.canCheckout = quote.blockers.length === 0 && quote.groups.length > 0;
  return { quote, json: quoteToJson(quote), address };
}

async function capacityFor(c: C | null, g: GroupQuote, scheduledFor: string | null) {
  const byProduct = new Map<string, number>();
  g.lines.forEach((l) => byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.qty));
  const when = scheduledFor ? new Date(scheduledFor) : (g.delivery.etaAt ?? new Date());
  return capacityProblem((c ?? (await import('../../db.js')).pool) as any, { vendorId: g.vendorId, portions: g.portions, byProduct, when }, !!c);
}

export async function checkout(userId: string, input: CheckoutInput, actor: Actor) {
  if (!input.idempotencyKey) throw badRequest('VALIDATION', 'Missing checkout reference. Please refresh and try again.');
  const existing = await one<any>('SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2', [userId, input.idempotencyKey]);
  if (existing) return { orderId: existing.id as string, reused: true };

  const { quote, address } = await buildQuote({ ...input, userId });
  if (!quote.canCheckout) {
    const first = quote.blockers[0];
    throw new AppError('CHECKOUT_BLOCKED', 409, first?.message ?? 'Your cart needs attention before checkout.', { blockers: quote.blockers });
  }
  if (input.expectedTotal != null && toCents(input.expectedTotal) !== quote.total) {
    throw new AppError('QUOTE_CHANGED', 409, 'Prices or fees changed while you were checking out. Please review the updated total.', { quote: quoteToJson(quote) });
  }
  if (quote.groups.some((g) => g.mode === 'delivery') && !address) throw badRequest('ADDRESS_REQUIRED', 'Choose a delivery address to continue.');

  const settings = { orders: await getSetting('orders'), inventory: await getSetting('inventory') };
  const user = await one<any>('SELECT email, full_name, phone FROM users WHERE id = $1', [userId]);

  const orderId = await tx(async (c) => {
    // Capacity is checked inside the transaction under an advisory lock so two checkouts cannot both take the last portion.
    for (const g of quote.groups) {
      const prob = await capacityFor(c, g, input.fulfillment?.[g.vendorId]?.scheduledFor ?? null);
      if (prob) throw conflict('CAPACITY_EXCEEDED', prob);
    }
    const num = (await one<{ n: number }>("SELECT nextval('order_number_seq')::int AS n", [], c))!.n;
    const number = `EAZ-${num}`;
    const deadline = new Date(Date.now() + settings.orders.reservation_ttl_minutes * 60000);
    const order = (await one<any>(
      `INSERT INTO orders(number, user_id, subtotal, vendor_discount_total, platform_discount_total, tax_total, delivery_fee_total, delivery_subsidy_total, service_fee_total, tip_total,
                          total, credit_applied, amount_charged, delivery_address, coupon_codes, contact_name, contact_phone, contact_email, customer_note, quote, idempotency_key, payment_deadline, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [number, userId, fromCents(quote.subtotal), fromCents(quote.vendorDiscount), fromCents(quote.platformDiscount), fromCents(quote.tax), fromCents(quote.deliveryFee), fromCents(quote.deliverySubsidy),
        fromCents(quote.serviceFee), fromCents(quote.tip), fromCents(quote.total), fromCents(quote.creditApplied), fromCents(quote.amountDue),
        address ? JSON.stringify({ label: address.label, recipient_name: address.recipient_name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, region: address.region, postal_code: address.postal_code, country: address.country, lat: address.lat, lng: address.lng, instructions: address.instructions }) : null,
        quote.appliedPromotions.map((p) => p.code).filter(Boolean), input.contact?.name ?? user.full_name, input.contact?.phone ?? user.phone, input.contact?.email ?? user.email,
        input.note ?? null, JSON.stringify(quoteToJson(quote)), input.idempotencyKey, deadline, quote.currency], c))!;
    await addHistory(c, 'order', order.id, null, 'pending_payment', actor);

    let i = 0;
    for (const g of quote.groups) {
      const suffix = SUFFIX[i++];
      const sub = (await one<any>(
        `INSERT INTO suborders(order_id, vendor_id, suffix, number, fulfillment_type, requested_for, prep_minutes, estimated_ready_at, promised_at, distance_km, zone_id,
                               items_subtotal, vendor_discount, platform_discount, tax_total, delivery_fee, delivery_subsidy_vendor, delivery_subsidy_platform, service_fee, tip,
                               commission_rate, commission_amount, fixed_fee_amount, vendor_net, customer_total, portions, pickup_code, vendor_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING *`,
        [order.id, g.vendorId, suffix, `${number}-${suffix}`, g.fulfillmentType, g.scheduledFor, g.prepMinutes, new Date(Date.now() + g.prepMinutes * 60000),
          g.delivery.etaAt, g.delivery.distanceKm, g.delivery.zoneId,
          fromCents(g.itemsSubtotal), fromCents(g.vendorDiscount), fromCents(g.platformDiscount), fromCents(g.tax), fromCents(g.deliveryFee), fromCents(g.deliverySubsidyVendor), fromCents(g.deliverySubsidyPlatform),
          fromCents(g.serviceFee), fromCents(g.tip), g.commissionRate, fromCents(g.commission), fromCents(g.fixedFee), fromCents(g.vendorNet), fromCents(g.customerTotal), g.portions,
          g.mode === 'pickup' ? randomDigits(4) : null, null], c))!;
      await addHistory(c, 'suborder', sub.id, null, 'pending_payment', actor);
      for (const l of g.lines) {
        await query(
          `INSERT INTO order_items(order_id, suborder_id, vendor_id, product_id, variant_id, name, variant_name, sku, image_url, product_type, unit_price, quantity, line_subtotal,
                                   discount_vendor, discount_platform, tax_class, tax_rate, tax_amount, portions, commission)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [order.id, sub.id, g.vendorId, l.productId, l.variantId, l.name, l.variantName, l.sku, l.imageUrl, l.productType, fromCents(l.unitPrice), l.qty, fromCents(l.lineSubtotal),
            fromCents(l.discountVendor), fromCents(l.discountPlatform), l.taxClass, l.taxRate, fromCents(l.tax), l.portions, fromCents(l.commission)], c);
      }
    }

    await reserve(c, quote.groups.flatMap((g) => g.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }))), order.id, userId);

    // Promotion redemptions: re-check limits under a row lock so a limited promotion can never be oversubscribed.
    for (const ap of quote.appliedPromotions) {
      const p = await one<any>('SELECT usage_limit, per_customer_limit, redemption_count FROM promotions WHERE id = $1 FOR UPDATE', [ap.id], c);
      const mine = (await one<{ n: number }>("SELECT count(*)::int AS n FROM promotion_redemptions WHERE promotion_id = $1 AND user_id = $2 AND status = 'active'", [ap.id, userId], c))!.n;
      if ((p.usage_limit != null && p.redemption_count >= p.usage_limit) || (p.per_customer_limit != null && mine >= p.per_customer_limit)) {
        throw conflict('PROMO_UNAVAILABLE', 'A promotion on your order just reached its limit. Please review your updated total.');
      }
      await query('INSERT INTO promotion_redemptions(promotion_id, user_id, order_id, amount) VALUES ($1,$2,$3,$4)', [ap.id, userId, order.id, fromCents(ap.amount)], c);
      await query('UPDATE promotions SET redemption_count = redemption_count + 1 WHERE id = $1', [ap.id], c);
    }

    if (quote.creditApplied > 0) {
      await advisoryLock(c, `credit:${userId}`);
      const bal = toCents((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [userId], c))!.b);
      if (bal < quote.creditApplied) throw conflict('CREDIT_CHANGED', 'Your store credit balance changed. Please review your total.');
      await query('INSERT INTO customer_credit_entries(user_id, amount, reason, order_id) VALUES ($1,$2,$3,$4)', [userId, -fromCents(quote.creditApplied), 'Applied at checkout', order.id], c);
    }
    if (input.cartId) await query("UPDATE carts SET status = 'converted' WHERE id = $1 AND (user_id = $2)", [input.cartId, userId], c);
    await audit(actor, 'order.created', 'order', order.id, { number, total: fromCents(quote.total) }, c);
    return order.id as string;
  });

  trackEvent('checkout_completed', { userId, entityType: 'order', entityId: orderId, props: { total: fromCents(quote.total) } }).catch(() => {});
  if (input.paymentToken !== undefined || quote.amountDue === 0) {
    const paid = await payOrder(userId, orderId, input.paymentToken ?? '', actor);
    return { orderId, paid };
  }
  return { orderId };
}

const SAFE_REASON: Record<string, string> = { card_declined: 'declined', insufficient_funds: 'insufficient_funds', expired_card: 'expired_card', processing_error: 'processing_error', invalid_token: 'invalid_card' };
export class PaymentFailed extends AppError {
  constructor(public orderId: string, internal: string, code: string) {
    // The processor's own code stays in logs. Customers get a short category they can act on.
    super('PAYMENT_FAILED', 402, 'Your payment could not be completed and your card was not charged. Please check your card details or try another card.', { orderId, reason: SAFE_REASON[code] ?? 'declined' }, `${code}: ${internal}`);
  }
}

/** Take payment for a pending order. Safe to retry until the reservation deadline. */
export async function payOrder(userId: string, orderId: string, token: string, actor: Actor) {
  const pay = await getSetting('payments');
  const provider = getProvider();
  let failure: { code: string; internal: string } | null = null;
  const result = await tx(async (c) => {
    await advisoryLock(c, `pay:${orderId}`);
    const order = await one<any>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
    if (!order || order.user_id !== userId) throw notFound('That order');
    if (order.status === 'cancelled') throw conflict('ORDER_CANCELLED', 'This order was cancelled, so it can not be paid. Your items were released, so please start a new checkout.');
    if (order.status !== 'pending_payment') return { already: true, status: order.status };
    if (order.payment_deadline && new Date(order.payment_deadline) < new Date()) throw conflict('ORDER_EXPIRED', 'This order timed out before payment. Your items were released, so please start a new checkout.');
    const amount = toCents(order.amount_charged);
    const attempt = (await one<{ n: number }>('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [orderId], c))!.n + 1;
    const idem = `${orderId}:${attempt}`;
    const capture = pay.capture_mode === 'automatic';

    if (amount === 0) {
      const p = await one<any>(
        `INSERT INTO payments(order_id, provider, status, amount, currency, capture_mode, idempotency_key, authorized_at, captured_at) VALUES ($1,'credit','captured',0,$2,'automatic',$3,now(),now()) RETURNING *`, [orderId, order.currency, idem], c);
      await confirmPaid(c, order, p, true, actor);
      return { paymentId: p.id, status: 'confirmed' };
    }
    const p = await one<any>(
      `INSERT INTO payments(order_id, provider, status, amount, currency, capture_mode, idempotency_key) VALUES ($1,$2,'requires_payment',$3,$4,$5,$6) RETURNING *`,
      [orderId, provider.name, fromCents(amount), order.currency, pay.capture_mode, idem], c);
    const res = await provider.authorize({ amount, currency: order.currency, token, idempotencyKey: idem, capture, description: `EAZyfoods order ${order.number}`, metadata: { order_number: order.number, order_id: orderId } });
    await query(`INSERT INTO payment_transactions(payment_id, kind, amount, status, provider_ref, meta) VALUES ($1,'authorize',$2,$3,$4,$5)`,
      [p.id, fromCents(amount), res.ok ? 'succeeded' : 'failed', res.ref ?? null, JSON.stringify({ code: res.failureCode ?? null, brand: res.brand ?? null })], c);
    if (!res.ok) {
      await query(`UPDATE payments SET status='failed', failure_code=$2, failure_internal=$3, card_brand=$4, card_last4=$5 WHERE id=$1`, [p.id, res.failureCode ?? 'declined', res.failureInternal ?? null, res.brand ?? null, res.last4 ?? null], c);
      await query(`UPDATE orders SET payment_status='failed' WHERE id=$1`, [orderId], c);
      failure = { code: res.failureCode ?? 'declined', internal: res.failureInternal ?? 'declined' };
      return { failed: true };
    }
    const upd = await one<any>(
      `UPDATE payments SET status=$2, provider_ref=$3, card_brand=$4, card_last4=$5, authorized_at=now(), captured_at=CASE WHEN $6 THEN now() END WHERE id=$1 RETURNING *`,
      [p.id, capture ? 'captured' : 'authorized', res.ref, res.brand ?? null, res.last4 ?? null, capture], c);
    if (capture) await query(`INSERT INTO payment_transactions(payment_id, kind, amount, status, provider_ref) VALUES ($1,'capture',$2,'succeeded',$3)`, [p.id, fromCents(amount), res.ref], c);
    await confirmPaid(c, order, upd, capture, actor);
    return { paymentId: p.id, status: 'confirmed' };
  });
  if (failure) {
    const f = failure as { code: string; internal: string };
    notifyStaff('payments.read', { kind: 'payment_failed', title: 'Payment failed', body: `Order payment declined (${f.code}).`, data: { orderId } }).catch(() => {});
    throw new PaymentFailed(orderId, f.internal, f.code);
  }
  return result;
}

/** Everything that happens when payment succeeds. Runs inside the payment transaction. */
export async function confirmPaid(c: C, order: any, payment: any, captured: boolean, actor: Actor) {
  const inv = await getSetting('inventory', c as any);
  await query(`UPDATE orders SET status='confirmed', payment_status=$2 WHERE id=$1`, [order.id, captured ? 'paid' : 'authorized'], c);
  await addHistory(c, 'order', order.id, 'pending_payment', 'confirmed', actor, 'Payment ' + (captured ? 'captured' : 'authorized'));
  const subs = await query<any>('SELECT * FROM suborders WHERE order_id = $1 ORDER BY suffix', [order.id], c);
  for (const s of subs) {
    await transitionSuborder(c, s.id, 'confirmed', actor, { note: 'Payment received' });
    if (s.fulfillment_type === 'delivery_platform') await createDeliveryJob(c, s.id);
  }
  if (inv.commit_stage === 'payment') await commitOrder(c, order.id, undefined, order.user_id);
  await deductRecipeIngredients(c, order.id);
  if (captured) await captureLedger(c, order.id);
  for (const s of subs) {
    await notifyVendor(s.vendor_id, { kind: 'new_order', title: `New order ${s.number}`, body: `A new order is waiting for you to accept.`, data: { suborderId: s.id, orderId: order.id } }, c);
    publish(`vendor:${s.vendor_id}`, 'order.new', { suborderId: s.id, number: s.number });
    // Escalation if the vendor does not respond in time
    const s2 = await getSetting('orders', c as any);
    await enqueue('vendor_accept_timeout', { suborderId: s.id }, { runAt: new Date(Date.now() + s2.vendor_accept_timeout_minutes * 60000), uniqueKey: `vat:${s.id}`, db: c });
  }
  await notify({ userId: order.user_id, kind: 'order_confirmed', title: `Order ${order.number} confirmed`, body: 'We have your order and sent it to the stores.', data: { orderId: order.id } }, c);
  await audit(actor, 'payment.confirmed', 'order', order.id, { captured }, c);
  await enqueue('risk_scan_order', { orderId: order.id }, { db: c });
  publish('admin', 'order.new', { orderId: order.id, number: order.number });
  for (const s of subs) { for (const it of await query<any>('SELECT variant_id FROM order_items WHERE suborder_id = $1', [s.id], c)) await lowStockCheck(c, s.vendor_id, it.variant_id); }
}

/** Post ledger entries for every live suborder that has not been captured yet. Idempotent per suborder. */
export async function captureLedger(c: C, orderId: string) {
  const order = await one<any>('SELECT * FROM orders WHERE id = $1', [orderId], c);
  const subs = await query<any>(`SELECT s.* FROM suborders s WHERE s.order_id = $1 AND s.status <> 'cancelled'
      AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.suborder_id = s.id AND l.entry_type = 'capture') ORDER BY suffix`, [orderId], c);
  if (!subs.length) return 0;
  const credit = toCents(order.credit_applied);
  const shares = credit > 0 ? allocate(credit, subs.map((s) => toCents(s.customer_total))) : subs.map(() => 0);
  let captured = 0;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const m: SuborderMoney = {
      id: s.id, order_id: orderId, vendor_id: s.vendor_id, fulfillment_type: s.fulfillment_type,
      items_subtotal: toCents(s.items_subtotal), vendor_discount: toCents(s.vendor_discount), platform_discount: toCents(s.platform_discount), tax_total: toCents(s.tax_total),
      delivery_fee: toCents(s.delivery_fee), delivery_subsidy_vendor: toCents(s.delivery_subsidy_vendor), delivery_subsidy_platform: toCents(s.delivery_subsidy_platform),
      service_fee: toCents(s.service_fee), tip: toCents(s.tip), customer_total: toCents(s.customer_total), commission_amount: toCents(s.commission_amount), fixed_fee_amount: toCents(s.fixed_fee_amount),
    };
    await postCapture(c, m, shares[i]);
    captured += m.customer_total - shares[i];
  }
  return captured;
}

/** For on_acceptance capture mode: capture the payment once a vendor accepts. */
export async function ensureCaptured(c: C, orderId: string, actor: Actor) {
  const p = await one<any>(`SELECT * FROM payments WHERE order_id = $1 AND status = 'authorized' FOR UPDATE`, [orderId], c);
  if (!p) return;
  const live = await query<any>(`SELECT customer_total FROM suborders WHERE order_id = $1 AND status <> 'cancelled'`, [orderId], c);
  const order = await one<any>('SELECT credit_applied, amount_charged FROM orders WHERE id = $1', [orderId], c);
  const total = live.reduce((s, x) => s + toCents(x.customer_total), 0) - toCents(order.credit_applied);
  const amount = Math.max(0, Math.min(total, toCents(p.amount)));
  const res = await getProvider().capture(p.provider_ref, amount, `cap:${p.id}`);
  if (!res.ok) throw new AppError('CAPTURE_FAILED', 502, 'We could not confirm the payment for this order. Please contact support.', undefined, res.failureInternal);
  await query(`UPDATE payments SET status='captured', captured_at=now(), amount=$2 WHERE id=$1`, [p.id, fromCents(amount)], c);
  await query(`INSERT INTO payment_transactions(payment_id, kind, amount, status, provider_ref) VALUES ($1,'capture',$2,'succeeded',$3)`, [p.id, fromCents(amount), res.ref], c);
  await query(`UPDATE orders SET payment_status='paid' WHERE id=$1`, [orderId], c);
  await captureLedger(c, orderId);
  await audit(actor, 'payment.captured', 'order', orderId, { amount: fromCents(amount) }, c);
}

/** Release unpaid orders whose reservation window has passed. Run by the scheduler. */
export async function expireUnpaidOrders(actor: Actor) {
  const rows = await query<any>(`SELECT id FROM orders WHERE status = 'pending_payment' AND payment_deadline < now() LIMIT 100`);
  const { cancelUnpaidOrder } = await import('./fulfillment.js');
  let n = 0;
  for (const r of rows) { await tx((c) => cancelUnpaidOrder(c, r.id, actor, 'Payment was not completed in time')); n++; }
  return n;
}
export { recomputeOrderStatus };
