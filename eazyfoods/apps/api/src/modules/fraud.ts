// Risk signals. Detectors raise signals for human review. Nothing here blocks or accuses anyone automatically.
import { query, one, pool, type Db } from '../db.js';
import { getSetting } from '../lib/settings.js';
import { notifyStaff } from '../lib/notifications.js';
import { audit, type Actor } from '../lib/audit.js';
import { notFound, badRequest } from '../errors.js';

async function raise(db: Db, s: { type: string; id: string; kind: string; severity: 'low' | 'medium' | 'high'; details: any; key: string }) {
  const r = await one<any>(
    `INSERT INTO risk_signals(subject_type, subject_id, kind, severity, details, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [s.type, s.id, s.kind, s.severity, JSON.stringify(s.details), s.key], db);
  if (r && s.severity === 'high') await notifyStaff('fraud.read', { kind: 'fraud_alert', title: `Risk signal: ${s.kind.replace(/_/g, ' ')}`, body: 'A high severity signal needs review.', data: { signalId: r.id } }, db);
  return !!r;
}

/** Signals triggered by a new order. */
export async function scanOrder(orderId: string, db: Db = pool) {
  const cfg = await getSetting('fraud', db);
  const o = await one<any>('SELECT * FROM orders WHERE id = $1', [orderId], db);
  if (!o) return 0;
  let n = 0;
  const day = new Date().toISOString().slice(0, 10);
  const refunds = await one<any>(`SELECT count(*)::int AS n FROM refunds r JOIN orders x ON x.id = r.order_id WHERE x.user_id = $1 AND r.created_at > now() - interval '30 days'`, [o.user_id], db);
  if (refunds.n >= cfg.refunds_30d) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'excessive_refunds', severity: 'medium', details: { refunds30d: refunds.n }, key: `refunds:${o.user_id}:${day}` }));
  const coupons = await one<any>(`SELECT count(*)::int AS n FROM promotion_redemptions WHERE user_id = $1 AND created_at > now() - interval '7 days' AND status = 'active'`, [o.user_id], db);
  if (coupons.n >= cfg.coupon_redemptions_7d) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'high_coupon_usage', severity: 'medium', details: { redemptions7d: coupons.n }, key: `coupons:${o.user_id}:${day}` }));
  const cancels = await one<any>(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND status = 'cancelled' AND placed_at > now() - interval '30 days'`, [o.user_id], db);
  if (cancels.n >= cfg.cancellations_30d) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'excessive_cancellations', severity: 'low', details: { cancellations30d: cancels.n }, key: `cancels:${o.user_id}:${day}` }));
  const u = await one<any>('SELECT phone, device_fingerprint, created_at FROM users WHERE id = $1', [o.user_id], db);
  if (u?.phone) {
    const shared = await one<any>("SELECT count(*)::int AS n FROM users WHERE phone = $1 AND status = 'active'", [u.phone], db);
    if (shared.n > cfg.shared_phone_accounts) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'multiple_accounts', severity: 'medium', details: { sharedPhoneAccounts: shared.n }, key: `phone:${u.phone}` }));
  }
  if (u?.device_fingerprint) {
    const shared = await one<any>("SELECT count(*)::int AS n FROM users WHERE device_fingerprint = $1 AND status = 'active'", [u.device_fingerprint], db);
    if (shared.n > 2) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'multiple_accounts', severity: 'medium', details: { sharedDeviceAccounts: shared.n }, key: `device:${u.device_fingerprint}` }));
  }
  const failed = await one<any>("SELECT count(*)::int AS n FROM payments p JOIN orders x ON x.id = p.order_id WHERE x.user_id = $1 AND p.status = 'failed' AND p.created_at > now() - interval '1 day'", [o.user_id], db);
  if (failed.n >= 3) n += +(await raise(db, { type: 'customer', id: o.user_id, kind: 'repeated_payment_failures', severity: 'high', details: { failures24h: failed.n }, key: `payfail:${o.user_id}:${day}` }));
  const prior = await one<any>("SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND id <> $2 AND status NOT IN ('cancelled','pending_payment')", [o.user_id, orderId], db);
  if (prior.n === 0 && Number(o.total) >= 300) n += +(await raise(db, { type: 'order', id: orderId, kind: 'large_first_order', severity: 'low', details: { total: Number(o.total) }, key: `bigfirst:${orderId}` }));
  return n;
}

/** Periodic scan for vendor, driver and review patterns. */
export async function scanPlatform(db: Db = pool) {
  let n = 0;
  const day = new Date().toISOString().slice(0, 10);
  const vendors = await query<any>(
    `SELECT s.vendor_id, count(*)::int AS total, count(*) FILTER (WHERE s.status = 'cancelled' AND s.cancelled_by IN ('vendor','system'))::int AS vcancel,
            count(*) FILTER (WHERE s.refunded_amount > 0)::int AS refunded FROM suborders s WHERE s.created_at > now() - interval '30 days' GROUP BY 1 HAVING count(*) >= 10`, [], db);
  for (const v of vendors) {
    if (v.vcancel / v.total >= 0.25) n += +(await raise(db, { type: 'vendor', id: v.vendor_id, kind: 'high_cancellation_rate', severity: 'medium', details: { rate: Math.round((v.vcancel / v.total) * 100) }, key: `vcancel:${v.vendor_id}:${day}` }));
    if (v.refunded / v.total >= 0.3) n += +(await raise(db, { type: 'vendor', id: v.vendor_id, kind: 'high_refund_rate', severity: 'medium', details: { rate: Math.round((v.refunded / v.total) * 100) }, key: `vrefund:${v.vendor_id}:${day}` }));
  }
  const bursts = await query<any>(
    `SELECT r.subject_id, count(*)::int AS n FROM reviews r WHERE r.subject_type = 'vendor' AND r.rating = 5 AND r.created_at > now() - interval '24 hours'
        AND (SELECT count(*) FROM orders o WHERE o.user_id = r.user_id) <= 1 GROUP BY 1 HAVING count(*) >= 5`, [], db);
  for (const b of bursts) n += +(await raise(db, { type: 'vendor', id: b.subject_id, kind: 'suspicious_review_burst', severity: 'medium', details: { fiveStarFromNewAccounts24h: b.n }, key: `revburst:${b.subject_id}:${day}` }));
  const drivers = await query<any>(
    `SELECT driver_id, count(*) FILTER (WHERE status = 'offered' OR 1=1)::int AS offers, count(*) FILTER (WHERE status = 'rejected')::int AS rej FROM delivery_offers WHERE offered_at > now() - interval '7 days' GROUP BY 1 HAVING count(*) >= 15`, [], db);
  for (const d of drivers) if (d.rej / d.offers >= 0.8) n += +(await raise(db, { type: 'driver', id: d.driver_id, kind: 'very_low_acceptance', severity: 'low', details: { rejectionRate: Math.round((d.rej / d.offers) * 100) }, key: `drej:${d.driver_id}:${day}` }));
  return n;
}

export async function reviewSignal(id: string, status: 'reviewed' | 'dismissed' | 'actioned', note: string | undefined, actor: Actor) {
  if (status === 'actioned' && !note?.trim()) throw badRequest('VALIDATION', 'Record what action was taken.');
  const r = await one<any>('UPDATE risk_signals SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *', [id, status, note ?? null, actor.userId]);
  if (!r) throw notFound('That signal');
  await audit(actor, `risk.${status}`, 'risk_signal', id, { note });
  return r;
}
