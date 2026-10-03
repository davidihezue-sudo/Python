// Loyalty points, store credit and referrals. All values come from the admin configuration.
import type pg from 'pg';
import { query, one, tx, pool, type Db } from '../db.js';
import { badRequest, conflict } from '../errors.js';
import { getSetting } from '../lib/settings.js';
import { fromCents, toCents } from '../money.js';
import { notify } from '../lib/notifications.js';
import { postCreditGrant } from './ledger.js';
import { randomToken } from '../lib/auth.js';

type C = pg.PoolClient;

export async function loyaltyStatus(userId: string, db: Db = pool) {
  const cfg = await getSetting('loyalty', db as any);
  const r = await one<any>(
    `SELECT coalesce(sum(points),0)::int AS balance, coalesce(sum(points) FILTER (WHERE points > 0),0)::int AS lifetime FROM loyalty_ledger WHERE user_id = $1`, [userId], db);
  const tiers = [...cfg.tiers].sort((a, b) => a.min_points - b.min_points);
  const tier = [...tiers].reverse().find((t) => r.lifetime >= t.min_points) ?? tiers[0];
  const next = tiers.find((t) => t.min_points > r.lifetime) ?? null;
  const credit = await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [userId], db);
  return {
    enabled: cfg.enabled, balance: r.balance, lifetime: r.lifetime, tier: tier?.key ?? null, nextTier: next ? { key: next.key, pointsNeeded: next.min_points - r.lifetime } : null,
    redeemUnit: { points: cfg.redeem_points, value: cfg.redeem_value }, storeCredit: Number(credit.b),
  };
}

export async function redeemPoints(userId: string, points: number) {
  const cfg = await getSetting('loyalty');
  if (!cfg.enabled) throw badRequest('LOYALTY_OFF', 'Rewards are not available right now.');
  if (!Number.isInteger(points) || points <= 0 || points % cfg.redeem_points !== 0) throw badRequest('VALIDATION', `Redeem points in multiples of ${cfg.redeem_points}.`);
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`loyalty:${userId}`]);
    const bal = (await one<any>('SELECT coalesce(sum(points),0)::int AS b FROM loyalty_ledger WHERE user_id = $1', [userId], c))!.b;
    if (bal < points) throw conflict('INSUFFICIENT_POINTS', 'You do not have enough points for that.');
    const value = (points / cfg.redeem_points) * cfg.redeem_value;
    await query('INSERT INTO loyalty_ledger(user_id, points, reason) VALUES ($1,$2,$3)', [userId, -points, 'redeemed'], c);
    await query('INSERT INTO customer_credit_entries(user_id, amount, reason) VALUES ($1,$2,$3)', [userId, value, `Redeemed ${points} points`], c);
    await postCreditGrant(c, userId, toCents(value), 'loyalty redemption');
    return { points, credit: value };
  });
}

/** Called when every suborder of an order is complete. */
export async function awardOrderCompletion(c: C, orderId: string) {
  const cfg = await getSetting('loyalty', c as any);
  if (!cfg.enabled) return;
  const order = await one<any>('SELECT * FROM orders WHERE id = $1', [orderId], c);
  const net = toCents(order.subtotal) - toCents(order.vendor_discount_total) - toCents(order.platform_discount_total);
  const points = Math.floor((Math.max(0, net) / 100) * cfg.points_per_dollar);
  if (points > 0) await query(`INSERT INTO loyalty_ledger(user_id, points, reason, order_id) VALUES ($1,$2,'order_earn',$3) ON CONFLICT DO NOTHING`, [order.user_id, points, orderId], c);

  // Referral qualification: the referred customer's first completed order above the minimum.
  const ref = await one<any>("SELECT * FROM referrals WHERE referred_id = $1 AND status = 'pending' FOR UPDATE", [order.user_id], c);
  if (!ref) return;
  const prior = await one("SELECT 1 FROM orders WHERE user_id = $1 AND status = 'completed' AND id <> $2 LIMIT 1", [order.user_id, orderId], c);
  if (prior) return;
  if (toCents(order.total) < toCents(cfg.referral_min_order)) return;
  const [a, b] = await Promise.all([
    one<any>('SELECT phone, device_fingerprint FROM users WHERE id = $1', [ref.referrer_id], c),
    one<any>('SELECT phone, device_fingerprint FROM users WHERE id = $1', [ref.referred_id], c),
  ]);
  const sameAddress = await one(
    `SELECT 1 FROM addresses x JOIN addresses y ON lower(x.line1) = lower(y.line1) AND x.postal_code = y.postal_code
      WHERE x.user_id = $1 AND y.user_id = $2 AND x.deleted_at IS NULL AND y.deleted_at IS NULL LIMIT 1`, [ref.referrer_id, ref.referred_id], c);
  const suspicious = (a?.phone && a.phone === b?.phone) || (a?.device_fingerprint && a.device_fingerprint === b?.device_fingerprint) || sameAddress;
  if (suspicious) {
    await query("UPDATE referrals SET status = 'rejected', rejection_reason = 'Shared phone, device or address with referrer', first_order_id = $2 WHERE id = $1", [ref.id, orderId], c);
    await query(`INSERT INTO risk_signals(subject_type, subject_id, kind, severity, details, dedupe_key) VALUES ('customer',$1,'referral_self_dealing','medium',$2,$3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [ref.referred_id, JSON.stringify({ referrer: ref.referrer_id }), `ref:${ref.id}`], c);
    return;
  }
  await query("UPDATE referrals SET status = 'rewarded', first_order_id = $2, reward_amount = $3, rewarded_at = now() WHERE id = $1", [ref.id, orderId, cfg.referral_reward], c);
  for (const [uid, amt, label] of [[ref.referrer_id, cfg.referral_reward, 'Referral reward'], [ref.referred_id, cfg.referee_reward, 'Welcome reward']] as const) {
    if (amt > 0) {
      await query('INSERT INTO customer_credit_entries(user_id, amount, reason, order_id) VALUES ($1,$2,$3,$4)', [uid, amt, label, orderId], c);
      await postCreditGrant(c, uid, toCents(amt), label, orderId);
      await notify({ userId: uid, kind: 'promotion', title: `${label}: $${amt} credit`, body: 'Store credit was added to your account.', data: { orderId } }, c);
    }
  }
}

export async function ensureReferralCode(userId: string) {
  const u = await one<any>('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (u?.referral_code) return u.referral_code as string;
  const code = 'EAZ' + randomToken(5).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 6);
  await query('UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL', [userId, code]);
  return (await one<any>('SELECT referral_code FROM users WHERE id = $1', [userId]))!.referral_code as string;
}
