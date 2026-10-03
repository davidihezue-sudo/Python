// Operations: the command centre and permission aware global search.
import { query, one, pool, type Db } from '../db.js';
import type { AuthCtx } from '../lib/auth.js';
import { getSetting } from '../lib/settings.js';

export async function commandCentre(db: Db = pool) {
  const dispatch = await getSetting('dispatch', db);
  const q = (sql: string, p: any[] = []) => query<any>(sql, p, db);
  const [orders, overview, attention, delayedPrep, noDriver, vendorsOffline, drivers, inProgress, failedPay, refundReq, escalations, compliance, lowInv, alerts, risk, support] = await Promise.all([
    one<any>(`SELECT count(*) FILTER (WHERE placed_at >= date_trunc('day', now()) AND status <> 'pending_payment')::int AS today, coalesce(sum(total) FILTER (WHERE placed_at >= date_trunc('day', now()) AND status NOT IN ('pending_payment','cancelled')),0) AS gmv_today FROM orders`, [], db),
    one<any>(`SELECT (SELECT count(*)::int FROM vendors WHERE verification_status = 'approved' AND seller_type <> 'chef') AS vendors, (SELECT count(*)::int FROM vendors WHERE verification_status = 'approved' AND seller_type = 'chef') AS chefs,
                     (SELECT count(DISTINCT user_id)::int FROM orders WHERE placed_at > now() - interval '30 days' AND status NOT IN ('cancelled','pending_payment')) AS active_customers,
                     (SELECT count(*)::int FROM driver_profiles WHERE verification_status = 'approved') AS drivers`, [], db),
    q(`SELECT s.id, s.number, s.status, s.created_at, v.trading_name AS vendor FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.status = 'confirmed' AND s.created_at < now() - interval '5 minutes' ORDER BY s.created_at LIMIT 20`),
    q(`SELECT s.id, s.number, s.status, s.estimated_ready_at, v.trading_name AS vendor FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.status IN ('vendor_accepted','preparing') AND s.estimated_ready_at < now() - interval '10 minutes' ORDER BY s.estimated_ready_at LIMIT 20`),
    q(`SELECT j.id, s.number, j.status, j.ready_at, v.trading_name AS vendor FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id JOIN vendors v ON v.id = j.vendor_id WHERE j.status IN ('awaiting_driver','offered') AND j.ready_at < now() - interval '3 minutes' ORDER BY j.ready_at LIMIT 20`),
    q(`SELECT v.id, v.trading_name AS name, v.accepting_orders FROM vendors v WHERE v.verification_status = 'approved' AND NOT v.accepting_orders LIMIT 20`),
    one<any>(`SELECT count(*) FILTER (WHERE availability = 'online')::int AS online,
                     count(*) FILTER (WHERE availability = 'online' AND NOT EXISTS (SELECT 1 FROM delivery_jobs j WHERE j.driver_id = d.user_id AND j.status IN ('assigned','at_pickup','picked_up','in_transit')))::int AS available
                FROM driver_profiles d WHERE verification_status = 'approved'`, [], db),
    q(`SELECT j.id, s.number, j.status, u.full_name AS driver FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id LEFT JOIN users u ON u.id = j.driver_id WHERE j.status IN ('assigned','at_pickup','picked_up','in_transit') ORDER BY j.assigned_at LIMIT 30`),
    q(`SELECT p.id, o.number, p.failure_code, p.created_at FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'failed' AND p.created_at > now() - interval '24 hours' ORDER BY p.created_at DESC LIMIT 20`),
    q(`SELECT id, number, subject, created_at FROM support_tickets WHERE category = 'refund_request' AND status NOT IN ('resolved','closed') ORDER BY created_at LIMIT 20`),
    q(`SELECT id, number, subject, priority, created_at FROM support_tickets WHERE priority IN ('high','urgent') AND status NOT IN ('resolved','closed') ORDER BY created_at LIMIT 20`),
    q(`SELECT 'document_expired' AS kind, owner_type, owner_id, doc_type, expiry_date AS at FROM compliance_documents WHERE status = 'expired'
       UNION ALL SELECT 'document_pending', owner_type, owner_id, doc_type, created_at::date FROM compliance_documents WHERE status = 'pending' LIMIT 30`),
    q(`SELECT i.variant_id, v.name AS variant, p.name AS product, vd.trading_name AS vendor, i.on_hand - i.reserved AS available FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id JOIN vendors vd ON vd.id = i.vendor_id
        WHERE i.on_hand - i.reserved <= i.reorder_threshold AND v.is_active AND p.status = 'active' ORDER BY available LIMIT 20`),
    q(`SELECT id, kind, severity, title, entity_type, entity_id, created_at FROM operational_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 20`),
    one<any>(`SELECT count(*)::int AS open, count(*) FILTER (WHERE severity = 'high')::int AS high FROM risk_signals WHERE status = 'open'`, [], db),
    one<any>(`SELECT count(*) FILTER (WHERE status IN ('open','assigned'))::int AS open, count(*) FILTER (WHERE status = 'open' AND assigned_to IS NULL)::int AS unassigned FROM support_tickets`, [], db),
  ]);
  const disputes = await one<any>("SELECT count(*)::int AS open FROM disputes WHERE status <> 'resolved'", [], db);
  const pendingApprovals = await one<any>(`SELECT (SELECT count(*)::int FROM vendors WHERE verification_status IN ('submitted','under_review')) AS vendors, (SELECT count(*)::int FROM driver_profiles WHERE verification_status IN ('submitted','under_review')) AS drivers`, [], db);
  return {
    generated_at: new Date().toISOString(),
    kpis: { orders_today: orders.today, gmv_today: Number(orders.gmv_today), active_vendors: overview.vendors, active_chefs: overview.chefs, active_customers: overview.active_customers, drivers_online: drivers.online, drivers_available: drivers.available, deliveries_in_progress: inProgress.length, open_disputes: disputes.open, support_open: support.open, risk_open: risk.open },
    attention: {
      vendor_not_responding: attention, delayed_preparation: delayedPrep, no_driver_assigned: noDriver, vendors_offline: vendorsOffline, deliveries_in_progress: inProgress, failed_payments: failedPay,
      refund_requests: refundReq, support_escalations: escalations, compliance_issues: compliance, low_inventory: lowInv, operational_alerts: alerts,
      pending_approvals: pendingApprovals, risk_signals: risk, dispatch_alert_minutes: dispatch.alert_after_minutes,
    },
  };
}

export async function globalSearch(a: AuthCtx, term: string, db: Db = pool) {
  const t = term.trim();
  if (t.length < 2) return {};
  const like = `%${t.toLowerCase()}%`;
  const out: Record<string, any[]> = {};
  const can = (p: string) => a.perms.has(p);
  const jobs: Promise<void>[] = [];
  const add = (key: string, sql: string, params: any[]) => jobs.push(query<any>(sql, params, db).then((r) => { out[key] = r; }));
  if (can('customers.read')) add('customers', `SELECT u.id, u.full_name AS title, u.email AS subtitle, u.status FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'customer' WHERE lower(u.full_name) LIKE $1 OR lower(u.email::text) LIKE $1 OR u.phone LIKE $1 LIMIT 8`, [like]);
  if (can('vendors.read')) {
    add('vendors', `SELECT id, trading_name AS title, legal_name || ' (' || verification_status || ')' AS subtitle, seller_type FROM vendors WHERE seller_type <> 'chef' AND (lower(trading_name) LIKE $1 OR lower(legal_name) LIKE $1 OR lower(email) LIKE $1) LIMIT 8`, [like]);
    add('chefs', `SELECT v.id, c.display_name AS title, v.trading_name || ' (' || v.verification_status || ')' AS subtitle FROM chefs c JOIN vendors v ON v.id = c.vendor_id WHERE lower(c.display_name) LIKE $1 OR lower(v.trading_name) LIKE $1 LIMIT 8`, [like]);
    add('products', `SELECT p.id, p.name AS title, v.trading_name AS subtitle, p.status FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.deleted_at IS NULL AND (lower(p.name) LIKE $1 OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND (upper(pv.sku) = upper($2) OR pv.barcode = $2))) LIMIT 8`, [like, t]);
  }
  if (can('drivers.read')) add('drivers', `SELECT d.user_id AS id, d.legal_name AS title, u.email AS subtitle, d.verification_status AS status FROM driver_profiles d JOIN users u ON u.id = d.user_id WHERE lower(d.legal_name) LIKE $1 OR lower(u.email::text) LIKE $1 OR d.phone LIKE $1 LIMIT 8`, [like]);
  if (can('orders.read')) add('orders', `SELECT o.id, o.number AS title, o.contact_email || ' · $' || o.total AS subtitle, o.status FROM orders o WHERE upper(o.number) LIKE upper($1) OR lower(o.contact_email) LIKE $2 OR lower(o.contact_name) LIKE $2 ORDER BY o.placed_at DESC LIMIT 8`, [`%${t}%`, like]);
  if (can('payments.read')) add('transactions', `SELECT p.id, coalesce(p.provider_ref, p.id::text) AS title, o.number || ' · ' || p.status || ' · $' || p.amount AS subtitle, o.id AS order_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_ref ILIKE $1 OR o.number ILIKE $1 LIMIT 8`, [`%${t}%`]);
  if (can('support.read')) add('tickets', `SELECT id, number || ' ' || subject AS title, status AS subtitle FROM support_tickets WHERE upper(number) LIKE upper($1) OR lower(subject) LIKE $2 ORDER BY created_at DESC LIMIT 8`, [`%${t}%`, like]);
  await Promise.all(jobs);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length));
}
