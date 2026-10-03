// Analytics for every side of the marketplace, computed from orders, the ledger and tracked events.
import { query, one, pool, type Db } from '../db.js';

const LIVE = `o.status NOT IN ('cancelled','pending_payment')`;
const rangeOf = (days: number) => ({ since: new Date(Date.now() - days * 86400000) });
const n2 = (v: any) => Math.round(Number(v ?? 0) * 100) / 100;

export async function platformAnalytics(days = 30, db: Db = pool) {
  const { since } = rangeOf(days);
  const [sales, rev, payouts, refunds, cx, cust, funnel, series, topVendors, delivery] = await Promise.all([
    one<any>(`SELECT count(*)::int AS orders, coalesce(sum(o.total),0) AS gmv, coalesce(avg(o.total),0) AS aov, count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled, (SELECT count(*)::int FROM orders WHERE placed_at >= $1 AND status <> 'pending_payment') AS all_orders
               FROM orders o WHERE o.placed_at >= $1 AND o.status NOT IN ('pending_payment')`, [since], db),
    one<any>(`SELECT coalesce(sum(credit - debit) FILTER (WHERE account = 'revenue_commission'),0) AS commission, coalesce(sum(credit - debit) FILTER (WHERE account = 'revenue_delivery'),0) AS delivery,
                     coalesce(sum(credit - debit) FILTER (WHERE account = 'revenue_service_fee'),0) AS service_fee, coalesce(sum(debit - credit) FILTER (WHERE account = 'expense_driver_pay'),0) AS driver_cost,
                     coalesce(sum(debit - credit) FILTER (WHERE account = 'expense_promo'),0) AS promo_cost, coalesce(sum(debit - credit) FILTER (WHERE account = 'expense_refund'),0) AS refund_cost
                FROM ledger_entries WHERE created_at >= $1`, [since], db),
    one<any>(`SELECT coalesce(sum(net) FILTER (WHERE payee_type = 'vendor' AND status = 'paid'),0) AS vendor_paid, coalesce(sum(net) FILTER (WHERE payee_type = 'driver' AND status = 'paid'),0) AS driver_paid,
                     coalesce(sum(net) FILTER (WHERE payee_type = 'vendor' AND status IN ('pending','processing','held')),0) AS vendor_pending FROM payouts WHERE created_at >= $1`, [since], db),
    one<any>(`SELECT coalesce(sum(amount),0) AS refunded, count(*)::int AS n FROM refunds WHERE created_at >= $1`, [since], db),
    one<any>(`SELECT count(*) FILTER (WHERE name = 'product_view')::int AS views, count(*) FILTER (WHERE name = 'add_to_cart')::int AS carts, count(*) FILTER (WHERE name = 'checkout_completed')::int AS checkouts FROM analytics_events WHERE created_at >= $1`, [since], db),
    one<any>(`SELECT (SELECT count(*)::int FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'customer' WHERE u.created_at >= $1) AS new_customers,
                     (SELECT count(DISTINCT user_id)::int FROM orders o WHERE o.placed_at >= $1 AND ${LIVE}) AS active_customers,
                     (SELECT count(*)::int FROM (SELECT user_id FROM orders o WHERE o.placed_at >= $1 AND ${LIVE} GROUP BY 1 HAVING count(*) >= 2) x) AS repeat_customers`, [since], db),
    one<any>(`SELECT 1`, [], db),
    query<any>(`SELECT to_char(date_trunc('day', placed_at), 'YYYY-MM-DD') AS day, count(*)::int AS orders, coalesce(sum(total),0) AS gmv FROM orders o WHERE o.placed_at >= $1 AND ${LIVE} GROUP BY 1 ORDER BY 1`, [since], db),
    query<any>(`SELECT v.id, v.trading_name AS name, count(DISTINCT s.id)::int AS orders, coalesce(sum(s.customer_total),0) AS gmv FROM suborders s JOIN vendors v ON v.id = s.vendor_id
                 WHERE s.created_at >= $1 AND s.status NOT IN ('cancelled','pending_payment') GROUP BY 1,2 ORDER BY gmv DESC LIMIT 8`, [since], db),
    one<any>(`SELECT count(*)::int AS deliveries, coalesce(avg(extract(epoch FROM delivered_at - assigned_at)/60),0) AS avg_minutes, coalesce(sum(customer_fee),0) AS fees, coalesce(sum(driver_pay),0) AS driver_pay FROM delivery_jobs WHERE delivered_at >= $1`, [since], db),
  ]);
  const platformRevenue = Number(rev.commission) + Number(rev.delivery) + Number(rev.service_fee);
  return {
    days, orders: sales.orders, gmv: n2(sales.gmv), average_order_value: n2(sales.aov),
    cancellation_rate: sales.all_orders ? n2((sales.cancelled / sales.all_orders) * 100) : 0,
    revenue: { platform_revenue: n2(platformRevenue), commission: n2(rev.commission), delivery: n2(rev.delivery), service_fees: n2(rev.service_fee), costs: { driver_pay: n2(rev.driver_cost), promotions: n2(rev.promo_cost), refunds_absorbed: n2(rev.refund_cost) }, contribution: n2(platformRevenue - Number(rev.driver_cost) - Number(rev.promo_cost) - Number(rev.refund_cost)) },
    payouts: { vendors_paid: n2(payouts.vendor_paid), vendors_pending: n2(payouts.vendor_pending), drivers_paid: n2(payouts.driver_paid) },
    refunds: { amount: n2(refunds.refunded), count: refunds.n, rate: sales.orders ? n2((refunds.n / sales.orders) * 100) : 0 },
    customers: { new: cust.new_customers, active: cust.active_customers, repeat: cust.repeat_customers, retention_rate: cust.active_customers ? n2((cust.repeat_customers / cust.active_customers) * 100) : 0, order_frequency: cust.active_customers ? n2(sales.orders / cust.active_customers) : 0 },
    funnel: { product_views: cx.views, add_to_cart: cx.carts, checkouts: cx.checkouts, conversion_rate: cx.views ? n2((cx.checkouts / cx.views) * 100) : null },
    delivery: { deliveries: delivery.deliveries, avg_minutes: Math.round(Number(delivery.avg_minutes)), customer_fees: n2(delivery.fees), driver_pay: n2(delivery.driver_pay), margin: n2(Number(delivery.fees) - Number(delivery.driver_pay)) },
    series: series.map((s) => ({ ...s, gmv: n2(s.gmv) })), top_vendors: topVendors.map((v) => ({ ...v, gmv: n2(v.gmv) })),
  };
}

export async function vendorAnalytics(vendorId: string, days = 30, db: Db = pool) {
  const { since } = rangeOf(days);
  const [s, best, inv, daily, today, week, month, views, reviews, pending] = await Promise.all([
    one<any>(`SELECT count(*) FILTER (WHERE status NOT IN ('cancelled','pending_payment'))::int AS orders, coalesce(sum(items_subtotal - vendor_discount) FILTER (WHERE status NOT IN ('cancelled','pending_payment')),0) AS sales,
                     coalesce(sum(vendor_net) FILTER (WHERE status NOT IN ('cancelled','pending_payment')),0) AS net, coalesce(avg(customer_total) FILTER (WHERE status NOT IN ('cancelled','pending_payment')),0) AS aov,
                     count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, count(*) FILTER (WHERE refunded_amount > 0)::int AS refunded, count(*) FILTER (WHERE status <> 'pending_payment')::int AS total,
                     coalesce(sum(commission_amount + fixed_fee_amount) FILTER (WHERE status NOT IN ('cancelled','pending_payment')),0) AS fees
                FROM suborders WHERE vendor_id = $1 AND created_at >= $2`, [vendorId, since], db),
    query<any>(`SELECT oi.product_id AS id, oi.name, sum(oi.quantity)::int AS units, sum(oi.line_subtotal - oi.discount_vendor) AS revenue FROM order_items oi JOIN suborders s ON s.id = oi.suborder_id
                 WHERE oi.vendor_id = $1 AND s.created_at >= $2 AND s.status NOT IN ('cancelled','pending_payment') GROUP BY 1,2 ORDER BY revenue DESC LIMIT 8`, [vendorId, since], db),
    one<any>(`SELECT count(*) FILTER (WHERE i.on_hand - i.reserved <= i.reorder_threshold AND i.on_hand - i.reserved > 0)::int AS low, count(*) FILTER (WHERE i.on_hand - i.reserved <= 0)::int AS out,
                     coalesce(sum(i.on_hand * v.cost),0) AS stock_value FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE i.vendor_id = $1 AND v.is_active`, [vendorId], db),
    query<any>(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS orders, coalesce(sum(items_subtotal - vendor_discount),0) AS sales FROM suborders WHERE vendor_id = $1 AND created_at >= $2 AND status NOT IN ('cancelled','pending_payment') GROUP BY 1 ORDER BY 1`, [vendorId, since], db),
    one<any>(`SELECT count(*) FILTER (WHERE status = 'confirmed')::int AS pending, count(*) FILTER (WHERE status IN ('vendor_accepted','preparing'))::int AS preparing, count(*) FILTER (WHERE status IN ('ready_for_pickup','driver_assigned','driver_arriving'))::int AS ready,
                     count(*) FILTER (WHERE status IN ('completed','delivered'))::int AS completed, coalesce(sum(items_subtotal - vendor_discount) FILTER (WHERE status NOT IN ('cancelled','pending_payment')),0) AS sales_today
                FROM suborders WHERE vendor_id = $1 AND created_at >= date_trunc('day', now())`, [vendorId], db),
    one<any>(`SELECT coalesce(sum(items_subtotal - vendor_discount),0) AS s FROM suborders WHERE vendor_id = $1 AND created_at >= date_trunc('week', now()) AND status NOT IN ('cancelled','pending_payment')`, [vendorId], db),
    one<any>(`SELECT coalesce(sum(items_subtotal - vendor_discount),0) AS s FROM suborders WHERE vendor_id = $1 AND created_at >= date_trunc('month', now()) AND status NOT IN ('cancelled','pending_payment')`, [vendorId], db),
    one<any>(`SELECT count(*) FILTER (WHERE e.name = 'product_view')::int AS views, count(*) FILTER (WHERE e.name = 'add_to_cart')::int AS carts
                FROM analytics_events e WHERE e.created_at >= $2 AND e.entity_type = 'product' AND e.entity_id IN (SELECT id::text FROM products WHERE vendor_id = $1)`, [vendorId, since], db),
    query<any>(`SELECT r.id, r.rating, r.title, r.body, r.created_at, r.vendor_response FROM reviews r WHERE r.subject_type = 'vendor' AND r.subject_id = $1 ORDER BY r.created_at DESC LIMIT 5`, [vendorId], db),
    one<any>(`SELECT coalesce(sum(net) FILTER (WHERE status IN ('pending','processing','held')),0) AS pending FROM payouts WHERE payee_type = 'vendor' AND payee_id = $1`, [vendorId], db),
  ]);
  const unsettled = await one<any>(`SELECT coalesce(sum(credit - debit),0) AS b FROM ledger_entries WHERE account = 'liability_vendor' AND party_type = 'vendor' AND party_id = $1 AND entry_type NOT IN ('payout','payout_reversal')
                                       AND NOT EXISTS (SELECT 1 FROM payout_ledger_links l WHERE l.ledger_entry_id = ledger_entries.id)`, [vendorId], db);
  return {
    days, today: { pending: today.pending, preparing: today.preparing, ready: today.ready, completed: today.completed, sales: n2(today.sales_today) },
    sales: { week: n2(week.s), month: n2(month.s), period: n2(s.sales), net_after_fees: n2(s.net), fees: n2(s.fees) },
    orders: s.orders, average_order_value: n2(s.aov), cancellation_rate: s.total ? n2((s.cancelled / s.total) * 100) : 0, refund_rate: s.total ? n2((s.refunded / s.total) * 100) : 0,
    conversion: { views: views.views, add_to_cart: views.carts, orders: s.orders, view_to_order_pct: views.views ? n2((s.orders / views.views) * 100) : null },
    best_products: best.map((b) => ({ ...b, revenue: n2(b.revenue) })), inventory: { low_stock: inv.low, out_of_stock: inv.out, stock_value: n2(inv.stock_value) },
    pending_payouts: n2(Number(pending.pending) + Number(unsettled.b)), recent_reviews: reviews, series: daily.map((d) => ({ ...d, sales: n2(d.sales) })),
  };
}

export async function chefAnalytics(vendorId: string, days = 30, db: Db = pool) {
  const base = await vendorAnalytics(vendorId, days, db);
  const { since } = rangeOf(days);
  const [prep, cap, margin, dishes] = await Promise.all([
    one<any>(`SELECT coalesce(avg(extract(epoch FROM ready_at - accepted_at)/60),0) AS avg_prep FROM suborders WHERE vendor_id = $1 AND ready_at IS NOT NULL AND accepted_at IS NOT NULL AND created_at >= $2`, [vendorId, since], db),
    one<any>(`SELECT c.daily_capacity, coalesce(sum(s.portions) FILTER (WHERE s.status <> 'cancelled' AND (coalesce(s.requested_for, s.created_at) AT TIME ZONE v.timezone)::date = (now() AT TIME ZONE v.timezone)::date),0)::int AS used_today
                FROM chefs c JOIN vendors v ON v.id = c.vendor_id LEFT JOIN suborders s ON s.vendor_id = c.vendor_id WHERE c.vendor_id = $1 GROUP BY c.daily_capacity`, [vendorId], db),
    query<any>(`SELECT r.name, r.selling_price, (SELECT coalesce(sum(ri.quantity * i.cost_per_unit),0) FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = r.id) / r.yield_servings AS cost
                 FROM recipes r WHERE r.vendor_id = $1 AND r.selling_price IS NOT NULL`, [vendorId], db),
    query<any>(`SELECT oi.name, sum(oi.quantity)::int AS sold FROM order_items oi JOIN suborders s ON s.id = oi.suborder_id WHERE oi.vendor_id = $1 AND s.created_at >= $2 AND s.status NOT IN ('cancelled','pending_payment') GROUP BY 1 ORDER BY sold DESC LIMIT 5`, [vendorId, since], db),
  ]);
  const costs = margin.filter((m) => Number(m.selling_price) > 0);
  const avgFoodCost = costs.length ? costs.reduce((s, m) => s + Number(m.cost) / Number(m.selling_price), 0) / costs.length : null;
  return {
    ...base, avg_prep_minutes: Math.round(Number(prep.avg_prep)),
    capacity: cap ? { daily_capacity: cap.daily_capacity, used_today: cap.used_today, utilization_pct: cap.daily_capacity ? n2((cap.used_today / cap.daily_capacity) * 100) : null } : null,
    avg_food_cost_pct: avgFoodCost != null ? n2(avgFoodCost * 100) : null, avg_gross_margin_pct: avgFoodCost != null ? n2((1 - avgFoodCost) * 100) : null, best_dishes: dishes,
  };
}

export async function customerAnalytics(userId: string, db: Db = pool) {
  const [s, vendors, products] = await Promise.all([
    one<any>(`SELECT count(*)::int AS orders, coalesce(sum(total),0) AS spend, coalesce(avg(total),0) AS aov, min(placed_at) AS first_order, max(placed_at) AS last_order FROM orders o WHERE o.user_id = $1 AND ${LIVE}`, [userId], db),
    query<any>(`SELECT v.slug, v.trading_name AS name, count(*)::int AS orders FROM suborders s JOIN orders o ON o.id = s.order_id JOIN vendors v ON v.id = s.vendor_id WHERE o.user_id = $1 AND s.status NOT IN ('cancelled','pending_payment') GROUP BY 1,2 ORDER BY orders DESC LIMIT 5`, [userId], db),
    query<any>(`SELECT p.slug, p.name, sum(oi.quantity)::int AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.user_id = $1 AND ${LIVE} GROUP BY 1,2 ORDER BY units DESC LIMIT 5`, [userId], db),
  ]);
  const months = s.first_order ? Math.max(1, (Date.now() - new Date(s.first_order).getTime()) / (30 * 86400000)) : 1;
  return { orders: s.orders, spend: n2(s.spend), average_order_value: n2(s.aov), orders_per_month: n2(s.orders / months), first_order: s.first_order, last_order: s.last_order, favourite_vendors: vendors, favourite_products: products };
}

/** Daily rollup for dashboards that outgrow live queries. */
export async function rollupDay(day: string, db: Db = pool) {
  const d = await one<any>(`SELECT count(*)::int AS orders, coalesce(sum(total),0) AS gmv FROM orders o WHERE o.placed_at::date = $1::date AND ${LIVE}`, [day], db);
  for (const [m, v] of [['orders', d.orders], ['gmv', d.gmv]] as const) {
    await query(`INSERT INTO daily_metrics(day, scope, scope_id, metric, value) VALUES ($1,'platform','',$2,$3) ON CONFLICT (day, scope, scope_id, metric) DO UPDATE SET value = EXCLUDED.value`, [day, m, v], db);
  }
  const vend = await query<any>(`SELECT vendor_id, count(*)::int AS orders, coalesce(sum(items_subtotal - vendor_discount),0) AS sales FROM suborders WHERE created_at::date = $1::date AND status NOT IN ('cancelled','pending_payment') GROUP BY 1`, [day], db);
  for (const v of vend) for (const [m, val] of [['orders', v.orders], ['sales', v.sales]] as const) {
    await query(`INSERT INTO daily_metrics(day, scope, scope_id, metric, value) VALUES ($1,'vendor',$2,$3,$4) ON CONFLICT (day, scope, scope_id, metric) DO UPDATE SET value = EXCLUDED.value`, [day, v.vendor_id, m, val], db);
  }
}
