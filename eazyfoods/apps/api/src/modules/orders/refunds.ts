// Refunds: full, partial, line based or amount based. Calculates exactly what is returned to the
// customer, who bears the cost, and posts balanced ledger entries.
import type pg from 'pg';
import { query, one } from '../../db.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { fromCents, toCents, type Cents } from '../../money.js';
import { getProvider } from '../../payments/providers.js';
import { postRefund } from '../ledger.js';
import { returnStock } from '../inventory.js';
import { notify } from '../../lib/notifications.js';
import { audit, type Actor } from '../../lib/audit.js';
import { addHistory, transitionSuborder, recomputeOrderStatus } from './core.js';
import { publish } from '../../lib/events.js';

type C = pg.PoolClient;
export interface RefundRequest {
  suborderId: string;
  lines?: { orderItemId: string; qty: number }[];
  fullItems?: boolean;
  amount?: number;                 // goodwill dollars, spread across remaining item value
  includeDelivery?: boolean;
  includeServiceFee?: boolean;
  includeTip?: boolean;
  bearer: 'vendor' | 'platform';
  reason: string;
  returnToStock?: boolean;
  disputeId?: string | null;
}

const SUM_KEYS = ['items', 'tax', 'gross_vendor', 'platform_discount', 'commission', 'fixed_fee', 'delivery', 'service_fee', 'tip', 'subsidy_vendor', 'subsidy_platform'] as const;
type Breakdown = Record<(typeof SUM_KEYS)[number], Cents>;
const zero = (): Breakdown => Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Breakdown;

/** cumulative rounding: parts add up exactly across any sequence of partial refunds */
const cum = (total: Cents, done: number, q: number, Q: number) => Math.round((total * (done + q)) / Q) - Math.round((total * done) / Q);

export async function refundSuborder(c: C, req: RefundRequest, actor: Actor) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [req.suborderId], c);
  if (!s) throw notFound('That order');
  const captured = await one('SELECT 1 FROM ledger_entries WHERE suborder_id = $1 AND entry_type = $2 LIMIT 1', [s.id, 'capture'], c);
  if (!captured) throw conflict('NOT_CAPTURED', 'Payment has not been collected for this order, so there is nothing to refund.');
  const payment = await one<any>(`SELECT * FROM payments WHERE order_id = $1 AND status IN ('captured','partially_refunded','refunded') FOR UPDATE`, [s.order_id], c);
  const items = await query<any>('SELECT * FROM order_items WHERE suborder_id = $1 ORDER BY id FOR UPDATE', [s.id], c);
  const prior = zero();
  for (const r of await query<any>(`SELECT breakdown FROM refunds WHERE suborder_id = $1 AND status = 'succeeded'`, [s.id], c)) for (const k of SUM_KEYS) prior[k] += Number(r.breakdown[k] ?? 0);

  const b = zero();
  const itemUpdates: { id: string; qty: number; variantId: string }[] = [];
  const lineTargets = req.fullItems ? items.filter((i) => i.refunded_qty < i.quantity).map((i) => ({ orderItemId: i.id, qty: i.quantity - i.refunded_qty })) : req.lines ?? [];
  for (const l of lineTargets) {
    const it = items.find((i) => i.id === l.orderItemId);
    if (!it) throw badRequest('VALIDATION', 'That item is not part of this order.');
    if (l.qty <= 0 || l.qty > it.quantity - it.refunded_qty) throw badRequest('VALIDATION', `Only ${it.quantity - it.refunded_qty} of ${it.name} can still be refunded.`);
    const Q = it.quantity, done = it.refunded_qty;
    const sub = toCents(it.line_subtotal), dv = toCents(it.discount_vendor), dp = toCents(it.discount_platform);
    b.items += cum(sub - dv - dp, done, l.qty, Q);
    b.gross_vendor += cum(sub - dv, done, l.qty, Q);
    b.platform_discount += cum(dp, done, l.qty, Q);
    b.tax += cum(toCents(it.tax_amount), done, l.qty, Q);
    b.commission += cum(toCents(it.commission), done, l.qty, Q);
    itemUpdates.push({ id: it.id, qty: l.qty, variantId: it.variant_id });
  }
  if (req.amount != null && !lineTargets.length) {
    // Goodwill amount: spread proportionally over what is still refundable.
    const totalNet = items.reduce((sum, i) => sum + toCents(i.line_subtotal) - toCents(i.discount_vendor) - toCents(i.discount_platform), 0);
    const remainingNet = totalNet - prior.items;
    const want = toCents(req.amount);
    if (want <= 0 || remainingNet <= 0) throw badRequest('VALIDATION', 'There is no item value left to refund on this order.');
    const f = Math.min(1, want / remainingNet);
    const rem = (total: Cents, p: Cents) => Math.max(0, total - p);
    const itemTotals = (fn: (i: any) => Cents) => items.reduce((sum, i) => sum + fn(i), 0);
    if (want > remainingNet) throw badRequest('REFUND_TOO_LARGE', `You can refund up to $${(remainingNet / 100).toFixed(2)} of item value on this order.`);
    b.items = want;
    b.tax = Math.round(rem(itemTotals((i) => toCents(i.tax_amount)), prior.tax) * f);
    b.gross_vendor = Math.round(rem(itemTotals((i) => toCents(i.line_subtotal) - toCents(i.discount_vendor)), prior.gross_vendor) * f);
    b.platform_discount = Math.round(rem(itemTotals((i) => toCents(i.discount_platform)), prior.platform_discount) * f);
    b.commission = Math.round(rem(itemTotals((i) => toCents(i.commission)), prior.commission) * f);
  }
  const allItemsGone = items.every((i) => i.quantity - i.refunded_qty - (itemUpdates.find((u) => u.id === i.id)?.qty ?? 0) <= 0) || (req.amount != null && !lineTargets.length && b.items + prior.items >= items.reduce((sum, i) => sum + toCents(i.line_subtotal) - toCents(i.discount_vendor) - toCents(i.discount_platform), 0));
  if (allItemsGone) b.fixed_fee = Math.max(0, toCents(s.fixed_fee_amount) - prior.fixed_fee);

  const payableDelivery = Math.max(0, toCents(s.delivery_fee) - toCents(s.delivery_subsidy_vendor) - toCents(s.delivery_subsidy_platform));
  if (req.includeDelivery) {
    b.delivery = Math.max(0, payableDelivery - prior.delivery);
    b.subsidy_vendor = Math.max(0, toCents(s.delivery_subsidy_vendor) - prior.subsidy_vendor);
    b.subsidy_platform = Math.max(0, toCents(s.delivery_subsidy_platform) - prior.subsidy_platform);
  }
  if (req.includeServiceFee) b.service_fee = Math.max(0, toCents(s.service_fee) - prior.service_fee);
  if (req.includeTip) b.tip = Math.max(0, toCents(s.tip) - prior.tip);

  const R = b.items + b.tax + b.delivery + b.service_fee + b.tip;
  if (R <= 0) throw badRequest('NOTHING_TO_REFUND', 'There is nothing left to refund for that selection.');
  const refundedSoFar = toCents(s.refunded_amount);
  if (refundedSoFar + R > toCents(s.customer_total)) throw badRequest('REFUND_TOO_LARGE', 'That refund is more than the customer paid for this order.');

  const cardCapacity = toCents(payment.amount) - toCents(payment.refunded_amount);
  const toCard = Math.min(R, Math.max(0, cardCapacity));
  const toCredit = R - toCard;
  let providerRef: string | null = null;
  if (toCard > 0 && payment.provider !== 'credit') {
    const res = await getProvider().refund(payment.provider_ref, toCard, `refund:${s.id}:${prior.items}:${prior.delivery}:${R}:${refundedSoFar}`);
    if (!res.ok) throw new AppError('REFUND_FAILED', 502, 'We could not process this refund with the payment provider. Nothing was changed. Please try again shortly.', undefined, res.failureInternal);
    providerRef = res.ref;
  }

  const refund = (await one<any>(
    `INSERT INTO refunds(order_id, suborder_id, payment_id, amount, breakdown, lines, reason, bearer, status, provider_ref, dispute_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'succeeded',$9,$10,$11) RETURNING *`,
    [s.order_id, s.id, payment.id, fromCents(R), JSON.stringify(b), JSON.stringify(itemUpdates), req.reason, req.bearer, providerRef, req.disputeId ?? null, actor.userId], c))!;

  const own = s.fulfillment_type === 'delivery_vendor';
  await postRefund(c, { orderId: s.order_id, suborderId: s.id, vendorId: s.vendor_id, refundId: refund.id }, {
    grossVendor: b.gross_vendor, platformDiscount: b.platform_discount, netItems: b.items, tax: b.tax, delivery: b.delivery, serviceFee: b.service_fee, tip: b.tip,
    commission: b.commission, fixedFee: b.fixed_fee, subsidyVendor: b.subsidy_vendor, subsidyPlatform: b.subsidy_platform, deliveryOwn: own, bearer: req.bearer, toCard, toCredit,
  });
  if (toCard > 0) {
    await query(`INSERT INTO payment_transactions(payment_id, kind, amount, status, provider_ref, meta) VALUES ($1,'refund',$2,'succeeded',$3,$4)`, [payment.id, fromCents(toCard), providerRef, JSON.stringify({ refundId: refund.id })], c);
    const newRefunded = toCents(payment.refunded_amount) + toCard;
    await query(`UPDATE payments SET refunded_amount = $2, status = $3 WHERE id = $1`, [payment.id, fromCents(newRefunded), newRefunded >= toCents(payment.amount) ? 'refunded' : 'partially_refunded'], c);
  }
  if (toCredit > 0) await query('INSERT INTO customer_credit_entries(user_id, amount, reason, order_id, created_by) SELECT user_id, $2, $3, id, $4 FROM orders WHERE id = $1', [s.order_id, fromCents(toCredit), `Refund for ${s.number}`, actor.userId], c);
  for (const u of itemUpdates) {
    await query('UPDATE order_items SET refunded_qty = refunded_qty + $2 WHERE id = $1', [u.id, u.qty], c);
    if (req.returnToStock) await returnStock(c, u.variantId, u.qty, s.order_id, actor.userId);
  }
  await query('UPDATE suborders SET refunded_amount = refunded_amount + $2 WHERE id = $1', [s.id, fromCents(R)], c);

  // Status: only post-delivery orders change status because of a refund. Cancelled orders keep their cancelled state.
  const after = await one<any>('SELECT * FROM suborders WHERE id = $1', [s.id], c);
  const fullyRefunded = toCents(after.refunded_amount) >= toCents(after.customer_total);
  if (['delivered', 'completed', 'partially_refunded', 'disputed'].includes(after.status)) {
    const target = fullyRefunded ? 'refunded' : 'partially_refunded';
    if (after.status !== target) await transitionSuborder(c, s.id, target, actor, { note: `Refund of $${fromCents(R).toFixed(2)}: ${req.reason}` });
  }
  const allPaid = await one<any>(`SELECT coalesce(sum(refunded_amount),0) AS r, coalesce(sum(customer_total),0) AS t FROM suborders WHERE order_id = $1`, [s.order_id], c);
  await query(`UPDATE orders SET payment_status = $2 WHERE id = $1`, [s.order_id, Number(allPaid.r) >= Number(allPaid.t) ? 'refunded' : 'partially_refunded'], c);
  await recomputeOrderStatus(c, s.order_id, actor);
  const order = await one<any>('SELECT user_id, number FROM orders WHERE id = $1', [s.order_id], c);
  await notify({ userId: order.user_id, kind: 'refund_issued', title: `Refund for ${s.number}`, body: `We refunded $${fromCents(R).toFixed(2)}. ${toCredit > 0 ? `$${fromCents(toCredit).toFixed(2)} was added to your store credit.` : 'It can take a few business days to appear on your statement.'}`, data: { orderId: s.order_id, refundId: refund.id } }, c);
  await audit(actor, 'refund.issued', 'suborder', s.id, { refundId: refund.id, amount: fromCents(R), bearer: req.bearer, reason: req.reason, breakdown: b }, c);
  publish('admin', 'refund.issued', { orderId: s.order_id, amount: fromCents(R) });
  return { refundId: refund.id as string, amount: fromCents(R), toCard: fromCents(toCard), toCredit: fromCents(toCredit), breakdown: b };
}
export { addHistory };
