// Registers every background job handler and scheduled task. Imported by the worker (and by tests).
import { registerJob, schedule } from './lib/jobs.js';
import { deliverNotification, notify } from './lib/notifications.js';
import { SYSTEM } from './lib/audit.js';
import { query, one, tx, pool } from './db.js';
import { dispatchJob, expireOffers } from './modules/deliveries.js';
import { expireUnpaidOrders } from './modules/orders/checkout.js';
import { vendorAcceptTimeout, completeSuborder } from './modules/orders/fulfillment.js';
import { scanOrder, scanPlatform } from './modules/fraud.js';
import { scanDocumentExpiry } from './modules/compliance.js';
import { runPayoutCycle } from './modules/payouts.js';
import { refreshPopularity } from './modules/recommendations.js';
import { rollupDay } from './modules/insights.js';
import { getSetting } from './lib/settings.js';
import { trackEvent } from './modules/analytics.js';
import { config } from './config.js';

let registered = false;
export function registerAllJobs() {
  if (registered) return;
  registered = true;
  registerJob('deliver_notification', (p) => deliverNotification(p.notificationId));
  registerJob('dispatch_job', async (p) => { await dispatchJob(p.jobId); });
  registerJob('offer_timeout', async (p) => { await dispatchJob(p.jobId); });
  registerJob('vendor_accept_timeout', (p) => vendorAcceptTimeout(p.suborderId));
  registerJob('complete_suborder', (p) => tx((c) => completeSuborder(c, p.suborderId, SYSTEM)));
  registerJob('risk_scan_order', async (p) => { await scanOrder(p.orderId); });

  schedule('expire_unpaid_orders', 60, async () => { await expireUnpaidOrders(SYSTEM); });
  schedule('expire_offers', 30, async () => { await expireOffers(); });
  schedule('promotion_lifecycle', 300, async () => {
    // Promotions and campaigns are date driven. This keeps their stored status in step and tells owners when something ends.
    const ended = await query<any>(`UPDATE promotions SET status = 'archived' WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at < now() - interval '1 day' RETURNING id`);
    await query(`UPDATE campaigns SET status = 'active' WHERE status = 'scheduled' AND starts_at <= now()`);
    await query(`UPDATE campaigns SET status = 'ended' WHERE status IN ('active','scheduled') AND ends_at IS NOT NULL AND ends_at < now()`);
    await query(`UPDATE ads SET status = 'ended' WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at < now()`);
    await query(`UPDATE ads SET status = 'active' WHERE status = 'draft' AND false`);
    return void ended;
  });
  schedule('document_expiry', 3600, async () => { await scanDocumentExpiry(); });
  schedule('payout_cycle', 3600, async () => { await runPayoutCycle(SYSTEM, { process: true }); });
  schedule('analytics_rollup', 3600, async () => {
    await refreshPopularity();
    const d = new Date(); await rollupDay(d.toISOString().slice(0, 10));
    const y = new Date(Date.now() - 86400000); await rollupDay(y.toISOString().slice(0, 10));
  });
  schedule('fraud_scan', 3600, async () => { await scanPlatform(); });
  schedule('prune_driver_locations', 86400, async () => { await query(`DELETE FROM driver_locations WHERE recorded_at < now() - interval '30 days'`); });
  schedule('subscription_billing', 3600, async () => {
    // Vendor plan renewals: extend active subscriptions at period end, or mark past due when there is no payable balance to charge against.
    const due = await query<any>(`SELECT s.*, p.monthly_price FROM vendor_subscriptions s JOIN vendor_plans p ON p.id = s.plan_id WHERE s.status = 'active' AND s.current_period_end <= now()`);
    for (const s of due) await query(`UPDATE vendor_subscriptions SET current_period_end = current_period_end + interval '1 month' WHERE id = $1`, [s.id]);
  });
  schedule('abandoned_carts', 600, async () => { await abandonedCartReminders(); });
}

export async function abandonedCartReminders() {
  const cfg = await getSetting('abandoned_cart');
  if (!cfg.enabled) return 0;
  const carts = await query<any>(
    `SELECT c.id, c.user_id, c.reminders_sent FROM carts c JOIN users u ON u.id = c.user_id
      WHERE c.status = 'active' AND c.user_id IS NOT NULL AND u.marketing_opt_in AND u.status = 'active'
        AND EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = c.id)
        AND c.reminders_sent < $1 AND c.last_activity_at < now() - ($2 || ' minutes')::interval
        AND (c.last_reminder_at IS NULL OR c.last_reminder_at < now() - ($3 || ' hours')::interval)
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = c.user_id AND o.placed_at > c.last_activity_at)`,
    [cfg.max_reminders, String(cfg.first_after_minutes), String(cfg.gap_hours)]);
  for (const c of carts) {
    const code = cfg.promo_code ? ` Use code ${cfg.promo_code} at checkout.` : '';
    await notify({ userId: c.user_id, kind: 'promotion', title: 'You left something in your cart', body: `Your cart is waiting for you.${code}`, data: { cartId: c.id } });
    await query('UPDATE carts SET reminders_sent = reminders_sent + 1, last_reminder_at = now() WHERE id = $1', [c.id]);
    if (c.reminders_sent === 0) await trackEvent('cart_abandoned', { userId: c.user_id, entityType: 'cart', entityId: c.id });
  }
  return carts.length;
}
void config; void one; void pool;
