// Order state machine core. All suborder status changes go through transitionSuborder.
import type pg from 'pg';
import { query, one } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { assertSuborderTransition, SUBORDER_LABELS, type SuborderStatus } from '../../lib/states.js';
import { publish } from '../../lib/events.js';
import type { Actor } from '../../lib/audit.js';

type C = pg.PoolClient;

export async function addHistory(c: C, entityType: 'order' | 'suborder' | 'delivery', entityId: string, from: string | null, to: string, actor: Actor, note?: string) {
  await query(
    `INSERT INTO order_status_history(entity_type, entity_id, from_status, to_status, actor_user_id, actor_role, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [entityType, entityId, from, to, actor.userId, actor.role ?? null, note ?? null], c);
}

const STAMP: Partial<Record<SuborderStatus, string>> = {
  vendor_accepted: 'accepted_at', ready_for_pickup: 'ready_at', picked_up: 'picked_up_at', delivered: 'delivered_at', completed: 'completed_at', cancelled: 'cancelled_at',
};

export async function transitionSuborder(c: C, suborderId: string, to: SuborderStatus, actor: Actor, opts: { note?: string; set?: Record<string, any>; lock?: boolean } = {}) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [suborderId], c);
  if (!s) throw notFound('That order');
  if (s.status === to) return s; // idempotent
  assertSuborderTransition(s.status, to, s.fulfillment_type);
  const sets: string[] = ['status = $2'];
  const vals: any[] = [suborderId, to];
  const stamp = STAMP[to];
  if (stamp) sets.push(`${stamp} = now()`);
  for (const [k, v] of Object.entries(opts.set ?? {})) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  const updated = await one<any>(`UPDATE suborders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals, c);
  await addHistory(c, 'suborder', suborderId, s.status, to, actor, opts.note);
  publish(`order:${s.order_id}`, 'suborder.status', { suborderId, orderId: s.order_id, status: to, label: SUBORDER_LABELS[to] });
  publish(`vendor:${s.vendor_id}`, 'suborder.status', { suborderId, orderId: s.order_id, status: to });
  publish('admin', 'suborder.status', { suborderId, orderId: s.order_id, vendorId: s.vendor_id, status: to });
  return updated;
}

/** Derive the customer facing order status from its suborders and payment. */
export async function recomputeOrderStatus(c: C, orderId: string, actor: Actor) {
  const o = await one<any>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
  if (!o) return;
  const subs = await query<any>('SELECT status, refunded_amount, customer_total FROM suborders WHERE order_id = $1', [orderId], c);
  const st = subs.map((s) => s.status as string);
  let next: string;
  if (st.every((s) => s === 'pending_payment')) next = 'pending_payment';
  else if (st.every((s) => s === 'cancelled')) next = 'cancelled';
  else if (st.some((s) => s === 'disputed')) next = 'disputed';
  else if (st.every((s) => ['completed', 'cancelled', 'refunded', 'partially_refunded', 'delivered'].includes(s)) && st.some((s) => s !== 'cancelled')) {
    const live = subs.filter((s) => s.status !== 'cancelled');
    const refundedAll = live.every((s) => s.status === 'refunded');
    const anyRefund = live.some((s) => ['refunded', 'partially_refunded'].includes(s.status) || Number(s.refunded_amount) > 0);
    next = refundedAll ? 'refunded' : anyRefund ? 'partially_refunded' : st.every((s) => ['completed', 'cancelled'].includes(s)) ? 'completed' : 'in_progress';
  } else if (st.every((s) => ['confirmed', 'cancelled'].includes(s))) next = 'confirmed';
  else next = 'in_progress';
  if (next !== o.status) {
    await query('UPDATE orders SET status = $2 WHERE id = $1', [orderId, next], c);
    await addHistory(c, 'order', orderId, o.status, next, actor);
    publish(`order:${orderId}`, 'order.status', { orderId, status: next });
    publish('admin', 'order.status', { orderId, status: next });
  }
  return next;
}

export async function getSuborder(c: C | undefined, id: string) {
  const s = await one<any>('SELECT * FROM suborders WHERE id = $1', [id], c as any);
  if (!s) throw notFound('That order');
  return s;
}

export function friendly(e: unknown, fallback: string): AppError {
  return e instanceof AppError ? e : new AppError('FAILED', 500, fallback, undefined, String((e as Error)?.message ?? e));
}
