import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, id, pagination, patch } from '../lib/util.js';
import { query, one, tx } from '../db.js';
import { requirePerm, requireUser, PERMISSIONS, ROLES, assignRole, isStaff } from '../lib/rbac.js';
import { badRequest, notFound, conflict, forbidden } from '../errors.js';
import { audit, diff } from '../lib/audit.js';
import { commandCentre, globalSearch } from '../modules/admin.js';
import { platformAnalytics, vendorAnalytics, chefAnalytics, customerAnalytics } from '../modules/insights.js';
import { staffOrder } from '../modules/orderviews.js';
import { adminCancel } from '../modules/orders/fulfillment.js';
import { refundSuborder } from '../modules/orders/refunds.js';
import { transitionSuborder, recomputeOrderStatus } from '../modules/orders/core.js';
import { adminReassign } from '../modules/deliveries.js';
import { reviewVendor } from '../modules/vendors.js';
import { reviewDriver } from '../modules/drivers.js';
import { reviewDocument, requirementsFor, jurisdictionFor } from '../modules/compliance.js';
import { trialBalance, reconcile } from '../modules/ledger.js';
import { createVendorPayout, processPayout, holdPayout, releasePayout, reversePayout, runPayoutCycle, payoutStatement } from '../modules/payouts.js';
import { reviewSignal } from '../modules/fraud.js';
import { moderateReview } from '../modules/reviews.js';
import { listSettings, setSetting, SETTING_DEFS, type SettingKey } from '../lib/settings.js';
import { saveCategory } from '../modules/catalog.js';
import { revokeAllSessions, hashPassword, passwordProblem } from '../lib/auth.js';
import { notify } from '../lib/notifications.js';
import { createUser } from '../modules/accounts.js';
import { sendOrderMessage } from '../modules/support.js';

const zoneBody = z.object({
  name: z.string().min(2).max(80), zone_type: z.enum(['radius', 'postal', 'polygon']), center_lat: z.number().optional().nullable(), center_lng: z.number().optional().nullable(), radius_km: z.number().min(0.5).max(200).optional().nullable(),
  postal_prefixes: z.array(z.string().min(1).max(7)).default([]), polygon: z.array(z.tuple([z.number(), z.number()])).min(3).optional().nullable(), fee_model: z.enum(['flat', 'distance']).default('distance'),
  base_fee: z.number().min(0).max(200).default(0), per_km_fee: z.number().min(0).max(50).default(0), free_over: z.number().min(0).optional().nullable(), min_order: z.number().min(0).default(0), max_distance_km: z.number().min(0.5).optional().nullable(),
  priority: z.number().int().default(0), is_active: z.boolean().default(true),
});

export async function adminRoutes(app: FastifyInstance) {
  // ---------------- dashboard, analytics, search ----------------
  app.get('/command-centre', async (req) => { requirePerm(req.auth, 'orders.read', 'analytics.read', 'dispatch.manage'); return commandCentre(); });
  app.get('/analytics', async (req) => { requirePerm(req.auth, 'analytics.read'); return platformAnalytics(parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query).days); });
  app.get('/analytics/vendor/:id', async (req) => {
    requirePerm(req.auth, 'analytics.read');
    const vid = parse(z.object({ id }), req.params).id;
    const v = await one<any>('SELECT seller_type FROM vendors WHERE id = $1', [vid]);
    if (!v) throw notFound('That vendor');
    return v.seller_type === 'chef' ? chefAnalytics(vid) : vendorAnalytics(vid);
  });
  app.get('/search', async (req) => { const a = requirePerm(req.auth, 'search.global'); return { results: await globalSearch(a, parse(z.object({ q: z.string().min(2).max(80) }), req.query).q) }; });
  app.get('/alerts', async (req) => { requirePerm(req.auth, 'orders.read', 'dispatch.manage'); return { alerts: await query('SELECT * FROM operational_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100') }; });
  app.post('/alerts/:id/resolve', async (req) => {
    requirePerm(req.auth, 'orders.manage', 'dispatch.manage');
    await query('UPDATE operational_alerts SET resolved_at = now(), resolved_by = $2 WHERE id = $1', [parse(z.object({ id }), req.params).id, req.auth!.user.id]);
    return { ok: true };
  });

  // ---------------- orders ----------------
  app.get('/orders', async (req) => {
    requirePerm(req.auth, 'orders.read');
    const q = parse(pagination.extend({ status: z.string().optional(), q: z.string().max(80).optional(), vendor: id.optional(), from: z.string().optional(), to: z.string().optional(), payment: z.string().optional() }), req.query);
    const rows = await query<any>(
      `SELECT o.id, o.number, o.status, o.payment_status, o.total, o.placed_at, o.contact_name, o.contact_email,
              (SELECT string_agg(v.trading_name || ' (' || s.status || ')', ', ') FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.order_id = o.id) AS vendors
         FROM orders o WHERE ($1::text IS NULL OR o.status = ANY(string_to_array($1, ','))) AND ($2::text IS NULL OR o.number ILIKE $2 OR lower(o.contact_email) LIKE lower($2) OR lower(o.contact_name) LIKE lower($2))
          AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM suborders s WHERE s.order_id = o.id AND s.vendor_id = $3)) AND ($4::timestamptz IS NULL OR o.placed_at >= $4) AND ($5::timestamptz IS NULL OR o.placed_at < $5)
          AND ($6::text IS NULL OR o.payment_status = $6)
        ORDER BY o.placed_at DESC LIMIT $7 OFFSET $8`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.vendor ?? null, q.from ?? null, q.to ?? null, q.payment ?? null, q.limit, (q.page - 1) * q.limit]);
    return { orders: rows.map((r) => ({ ...r, total: Number(r.total) })) };
  });
  app.get('/orders/:id', async (req) => { requirePerm(req.auth, 'orders.read'); return { order: await staffOrder(parse(z.object({ id }), req.params).id) }; });
  app.post('/orders/:id/notes', async (req) => {
    requirePerm(req.auth, 'orders.manage');
    const b = parse(z.object({ note: z.string().min(2).max(1000) }), req.body);
    await audit(req.actor, 'order.note', 'order', parse(z.object({ id }), req.params).id, { note: b.note });
    return { ok: true };
  });
  app.post('/suborders/:id/cancel', async (req) => {
    requirePerm(req.auth, 'orders.cancel');
    const b = parse(z.object({ reason: z.string().min(3).max(300) }), req.body);
    await adminCancel(parse(z.object({ id }), req.params).id, b.reason, req.actor);
    return { ok: true };
  });
  app.post('/suborders/:id/refund', async (req) => {
    requirePerm(req.auth, 'refunds.issue');
    const b = parse(z.object({
      lines: z.array(z.object({ orderItemId: id, qty: z.number().int().min(1) })).optional(), fullItems: z.boolean().optional(), amount: z.number().positive().optional(), includeDelivery: z.boolean().optional(),
      includeServiceFee: z.boolean().optional(), includeTip: z.boolean().optional(), bearer: z.enum(['vendor', 'platform']).default('platform'), reason: z.string().min(3).max(500), returnToStock: z.boolean().optional(),
    }), req.body);
    if (!b.lines && !b.fullItems && b.amount == null && !b.includeDelivery) throw badRequest('VALIDATION', 'Choose items, an amount or the delivery fee to refund.');
    return tx((c) => refundSuborder(c, { suborderId: parse(z.object({ id }), req.params).id, ...b }, req.actor));
  });
  // Operational status changes are still validated by the state machine; only forward moves that make sense for staff are offered.
  app.post('/suborders/:id/status', async (req) => {
    requirePerm(req.auth, 'orders.manage');
    const b = parse(z.object({ status: z.enum(['vendor_accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered']), note: z.string().min(3).max(300) }), req.body);
    const sid = parse(z.object({ id }), req.params).id;
    return tx(async (c) => {
      const s = await one<any>('SELECT order_id FROM suborders WHERE id = $1', [sid], c);
      if (!s) throw notFound('That order');
      await transitionSuborder(c, sid, b.status, req.actor, { note: `Operations: ${b.note}` });
      await recomputeOrderStatus(c, s.order_id, req.actor);
      await audit(req.actor, 'suborder.status_override', 'suborder', sid, b, c);
      return { ok: true };
    });
  });

  // ---------------- dispatch ----------------
  app.get('/deliveries', async (req) => {
    requirePerm(req.auth, 'orders.read', 'dispatch.manage');
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    return { deliveries: await query(`SELECT j.id, j.status, j.distance_km, j.est_minutes, j.customer_fee, j.driver_pay, j.platform_margin, j.tip, j.ready_at, j.assigned_at, j.delivered_at, j.dispatch_attempts, j.batch_id, s.number, v.trading_name AS vendor, u.full_name AS driver, j.driver_id
                                        FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id JOIN vendors v ON v.id = j.vendor_id LEFT JOIN users u ON u.id = j.driver_id
                                       WHERE ($1::text IS NULL OR j.status = ANY(string_to_array($1, ','))) ORDER BY j.created_at DESC LIMIT 200`, [q.status ?? null]) };
  });
  app.get('/deliveries/:id', async (req) => {
    requirePerm(req.auth, 'orders.read', 'dispatch.manage');
    const jid = parse(z.object({ id }), req.params).id;
    const [job, offers, hist, issues] = await Promise.all([
      one('SELECT j.*, s.number, u.full_name AS driver FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id LEFT JOIN users u ON u.id = j.driver_id WHERE j.id = $1', [jid]),
      query('SELECT o.*, u.full_name AS driver FROM delivery_offers o JOIN users u ON u.id = o.driver_id WHERE o.job_id = $1 ORDER BY o.offered_at', [jid]),
      query("SELECT * FROM order_status_history WHERE entity_type = 'delivery' AND entity_id = $1 ORDER BY at", [jid]),
      query('SELECT * FROM driver_issues WHERE job_id = $1 ORDER BY created_at', [jid]),
    ]);
    if (!job) throw notFound('That delivery');
    return { job, offers, history: hist, issues };
  });
  app.post('/deliveries/:id/reassign', async (req) => {
    requirePerm(req.auth, 'dispatch.manage');
    const b = parse(z.object({ driverId: id.nullable() }), req.body);
    return adminReassign(parse(z.object({ id }), req.params).id, b.driverId, req.actor);
  });
  app.get('/drivers/online', async (req) => {
    requirePerm(req.auth, 'drivers.read', 'dispatch.manage');
    return { drivers: await query(`SELECT d.user_id AS id, d.legal_name AS name, d.current_lat AS lat, d.current_lng AS lng, d.location_updated_at,
                                          (SELECT count(*)::int FROM delivery_jobs j WHERE j.driver_id = d.user_id AND j.status IN ('assigned','at_pickup','picked_up','in_transit')) AS active_jobs
                                     FROM driver_profiles d WHERE d.availability = 'online' AND d.verification_status = 'approved' ORDER BY d.legal_name`) };
  });

  // ---------------- vendors and chefs ----------------
  app.get('/vendors', async (req) => {
    requirePerm(req.auth, 'vendors.read');
    const q = parse(pagination.extend({ status: z.string().optional(), type: z.string().optional(), q: z.string().max(80).optional() }), req.query);
    const rows = await query<any>(
      `SELECT v.id, v.slug, v.trading_name, v.legal_name, v.seller_type, v.verification_status, v.city, v.region, v.submitted_at, v.approved_at, v.accepting_orders, v.rating_avg, v.commission_override_pct, v.is_featured, v.created_at,
              (SELECT count(*)::int FROM compliance_documents d WHERE d.owner_type = 'vendor' AND d.owner_id = v.id AND d.status = 'pending') AS pending_docs,
              (SELECT count(*)::int FROM products p WHERE p.vendor_id = v.id AND p.deleted_at IS NULL AND p.status = 'active') AS products
         FROM vendors v WHERE v.deleted_at IS NULL AND ($1::text IS NULL OR v.verification_status = ANY(string_to_array($1, ','))) AND ($2::text IS NULL OR v.seller_type = ANY(string_to_array($2, ',')))
          AND ($3::text IS NULL OR lower(v.trading_name) LIKE lower($3) OR lower(v.legal_name) LIKE lower($3)) ORDER BY CASE v.verification_status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, v.created_at DESC LIMIT $4 OFFSET $5`,
      [q.status ?? null, q.type ?? null, q.q ? `%${q.q}%` : null, q.limit, (q.page - 1) * q.limit]);
    return { vendors: rows };
  });
  app.get('/vendors/:id', async (req) => {
    requirePerm(req.auth, 'vendors.read');
    const vid = parse(z.object({ id }), req.params).id;
    const v = await one<any>('SELECT * FROM vendors WHERE id = $1', [vid]);
    if (!v) throw notFound('That vendor');
    const [docs, team, chef, history, reqs, stats] = await Promise.all([
      query('SELECT d.*, f.mime, f.original_name FROM compliance_documents d LEFT JOIN uploaded_files f ON f.id = d.file_id WHERE d.owner_type = \'vendor\' AND d.owner_id = $1 ORDER BY d.created_at DESC', [vid]),
      query('SELECT vu.member_role, u.id, u.full_name, u.email FROM vendor_users vu JOIN users u ON u.id = vu.user_id WHERE vu.vendor_id = $1', [vid]),
      one('SELECT * FROM chefs WHERE vendor_id = $1', [vid]),
      query("SELECT al.action, al.changes, al.created_at, u.full_name AS actor FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.entity_type = 'vendor' AND al.entity_id = $1 ORDER BY al.created_at DESC LIMIT 30", [vid]),
      requirementsFor(v.seller_type === 'chef' ? 'chef' : 'vendor', await jurisdictionFor(v.country, v.region)),
      one("SELECT count(*)::int AS orders, coalesce(sum(customer_total),0) AS gmv FROM suborders WHERE vendor_id = $1 AND status NOT IN ('cancelled','pending_payment')", [vid]),
    ]);
    return { vendor: v, documents: docs, team, chef, history, requirements: reqs, stats };
  });
  app.post('/vendors/:id/review', async (req) => {
    requirePerm(req.auth, 'vendors.approve');
    const b = parse(z.object({ action: z.enum(['start_review', 'request_info', 'approve', 'reject', 'suspend', 'reinstate']), note: z.string().max(1000).optional() }), req.body);
    return reviewVendor(parse(z.object({ id }), req.params).id, b.action, b.note, req.actor);
  });
  app.patch('/vendors/:id', async (req) => {
    requirePerm(req.auth, 'vendors.manage', 'vendors.approve');
    const vid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ commission_override_pct: z.number().min(0).max(100).nullable().optional(), is_featured: z.boolean().optional(), accepting_orders: z.boolean().optional() }), req.body);
    const before = await one<any>('SELECT * FROM vendors WHERE id = $1', [vid]);
    if (!before) throw notFound('That vendor');
    const after = await patch('vendors', 'id', vid, b, ['commission_override_pct', 'is_featured', 'accepting_orders']);
    await audit(req.actor, 'vendor.admin_updated', 'vendor', vid, diff(before, after ?? before));
    return { vendor: after };
  });
  app.get('/documents', async (req) => {
    requirePerm(req.auth, 'compliance.read');
    const q = parse(z.object({ status: z.string().default('pending'), owner_type: z.string().optional() }), req.query);
    return { documents: await query(`SELECT d.*, CASE WHEN d.owner_type = 'vendor' THEN v.trading_name ELSE u.full_name END AS owner_name, f.mime, f.original_name
                                       FROM compliance_documents d LEFT JOIN vendors v ON d.owner_type = 'vendor' AND v.id = d.owner_id LEFT JOIN users u ON d.owner_type = 'driver' AND u.id = d.owner_id LEFT JOIN uploaded_files f ON f.id = d.file_id
                                      WHERE d.status = ANY(string_to_array($1, ',')) AND ($2::text IS NULL OR d.owner_type = $2) ORDER BY d.expiry_date NULLS LAST, d.created_at LIMIT 200`, [q.status, q.owner_type ?? null]) };
  });
  app.post('/documents/:id/review', async (req) => {
    requirePerm(req.auth, 'compliance.manage');
    const b = parse(z.object({ status: z.enum(['verified', 'rejected']), note: z.string().max(500).optional() }), req.body);
    return reviewDocument(parse(z.object({ id }), req.params).id, b.status, b.note, req.actor);
  });
  app.get('/compliance/rules', async (req) => { requirePerm(req.auth, 'compliance.read'); return { rules: await query('SELECT * FROM compliance_rules ORDER BY applies_to, jurisdiction, doc_type') }; });
  app.put('/compliance/rules', async (req) => {
    requirePerm(req.auth, 'compliance.manage');
    const b = parse(z.object({ jurisdiction: z.string().min(1).max(12), applies_to: z.enum(['vendor', 'chef', 'driver']), doc_type: z.string().min(2).max(60), label: z.string().min(2).max(120), required: z.boolean().default(true), warn_days: z.number().int().min(0).default(30), active: z.boolean().default(true) }), req.body);
    await query(`INSERT INTO compliance_rules(jurisdiction, applies_to, doc_type, label, required, warn_days, active) VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (jurisdiction, applies_to, doc_type) DO UPDATE SET label = $4, required = $5, warn_days = $6, active = $7`, [b.jurisdiction.toUpperCase() === '*' ? '*' : b.jurisdiction.toUpperCase(), b.applies_to, b.doc_type, b.label, b.required, b.warn_days, b.active]);
    await audit(req.actor, 'compliance.rule_saved', 'compliance_rule', `${b.jurisdiction}:${b.applies_to}:${b.doc_type}`, b);
    return { ok: true };
  });

  // ---------------- drivers ----------------
  app.get('/drivers', async (req) => {
    requirePerm(req.auth, 'drivers.read');
    const q = parse(pagination.extend({ status: z.string().optional(), q: z.string().max(80).optional() }), req.query);
    return { drivers: await query(`SELECT d.user_id AS id, d.legal_name, u.email, d.phone, d.verification_status, d.availability, d.rating_avg, d.jobs_completed, d.offers_received, d.offers_accepted, d.created_at,
                                          (SELECT vehicle_type FROM vehicles v WHERE v.driver_id = d.user_id AND v.is_active LIMIT 1) AS vehicle,
                                          (SELECT count(*)::int FROM compliance_documents c WHERE c.owner_type = 'driver' AND c.owner_id = d.user_id AND c.status = 'pending') AS pending_docs
                                     FROM driver_profiles d JOIN users u ON u.id = d.user_id WHERE ($1::text IS NULL OR d.verification_status = ANY(string_to_array($1, ','))) AND ($2::text IS NULL OR lower(d.legal_name) LIKE lower($2))
                                    ORDER BY CASE d.verification_status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, d.created_at DESC LIMIT $3 OFFSET $4`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.get('/drivers/:id', async (req) => {
    requirePerm(req.auth, 'drivers.read');
    const did = parse(z.object({ id }), req.params).id;
    const d = await one<any>('SELECT d.*, u.email FROM driver_profiles d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1', [did]);
    if (!d) throw notFound('That driver');
    const [vehicles, docs, jobs, history] = await Promise.all([
      query('SELECT * FROM vehicles WHERE driver_id = $1', [did]),
      query('SELECT d.*, f.mime FROM compliance_documents d LEFT JOIN uploaded_files f ON f.id = d.file_id WHERE d.owner_type = \'driver\' AND d.owner_id = $1 ORDER BY d.created_at DESC', [did]),
      query("SELECT j.id, j.status, s.number, j.driver_pay, j.tip, j.delivered_at, j.distance_km FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id WHERE j.driver_id = $1 ORDER BY j.created_at DESC LIMIT 20", [did]),
      query("SELECT al.action, al.changes, al.created_at, u.full_name AS actor FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.entity_type = 'driver' AND al.entity_id = $1 ORDER BY al.created_at DESC LIMIT 30", [did]),
    ]);
    return { driver: d, vehicles, documents: docs, jobs, history };
  });
  app.post('/drivers/:id/review', async (req) => {
    requirePerm(req.auth, 'drivers.approve');
    const b = parse(z.object({ action: z.enum(['start_review', 'request_documents', 'approve', 'reject', 'suspend', 'reactivate']), note: z.string().max(1000).optional() }), req.body);
    return reviewDriver(parse(z.object({ id }), req.params).id, b.action, b.note, req.actor);
  });

  // ---------------- customers and staff ----------------
  app.get('/customers', async (req) => {
    requirePerm(req.auth, 'customers.read');
    const q = parse(pagination.extend({ q: z.string().max(80).optional(), status: z.string().optional() }), req.query);
    return { customers: await query(`SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at, u.last_login_at,
                                            (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','pending_payment')) AS orders,
                                            (SELECT coalesce(sum(total),0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','pending_payment')) AS spend,
                                            (SELECT count(*)::int FROM risk_signals r WHERE r.subject_id = u.id AND r.status = 'open') AS open_risk
                                       FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'customer'
                                      WHERE u.deleted_at IS NULL AND ($1::text IS NULL OR lower(u.full_name) LIKE lower($1) OR lower(u.email::text) LIKE lower($1) OR u.phone LIKE $1) AND ($2::text IS NULL OR u.status = $2)
                                      ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`, [q.q ? `%${q.q}%` : null, q.status ?? null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.get('/customers/:id', async (req) => {
    requirePerm(req.auth, 'customers.read');
    const uid = parse(z.object({ id }), req.params).id;
    const u = await one<any>('SELECT id, full_name, email, phone, status, status_reason, created_at, last_login_at, marketing_opt_in FROM users WHERE id = $1', [uid]);
    if (!u) throw notFound('That customer');
    const [orders, insights, risk, tickets, addresses] = await Promise.all([
      query("SELECT id, number, status, total, placed_at FROM orders WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 20", [uid]),
      customerAnalytics(uid), query("SELECT * FROM risk_signals WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 20", [uid]),
      query('SELECT id, number, subject, status FROM support_tickets WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 10', [uid]),
      query('SELECT label, city, region, postal_code FROM addresses WHERE user_id = $1 AND deleted_at IS NULL', [uid]),
    ]);
    return { customer: u, orders, insights, risk, tickets, addresses };
  });
  const setUserStatus = (status: 'active' | 'suspended') => async (req: any) => {
    requirePerm(req.auth, 'customers.suspend', 'users.manage');
    const uid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ reason: z.string().min(3).max(300).optional() }), req.body);
    if (status === 'suspended' && !b.reason) throw badRequest('VALIDATION', 'Please record a reason.');
    if (uid === req.auth.user.id) throw forbidden('You can not suspend your own account.');
    const r = await one('UPDATE users SET status = $2, status_reason = $3 WHERE id = $1 AND status <> \'deleted\' RETURNING id', [uid, status, b.reason ?? null]);
    if (!r) throw notFound('That user');
    if (status === 'suspended') await revokeAllSessions(uid);
    await audit(req.actor, status === 'suspended' ? 'user.suspended' : 'user.reactivated', 'user', uid, { reason: b.reason });
    return { ok: true };
  };
  app.post('/users/:id/suspend', setUserStatus('suspended'));
  app.post('/users/:id/reactivate', setUserStatus('active'));

  app.get('/staff', async (req) => {
    requirePerm(req.auth, 'users.read');
    return { staff: await query(`SELECT u.id, u.full_name, u.email, u.status, u.last_login_at, array_agg(r.key ORDER BY r.key) AS roles FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.kind = 'staff' GROUP BY u.id ORDER BY u.full_name`) };
  });
  app.post('/staff', async (req, reply) => {
    requirePerm(req.auth, 'roles.manage');
    const b = parse(z.object({ email: z.string().email(), full_name: z.string().min(2), password: z.string(), role: z.string() }), req.body);
    if (!ROLES[b.role] || ROLES[b.role].kind !== 'staff') throw badRequest('VALIDATION', 'Choose a staff role.');
    const u = await tx(async (c) => { const user = await createUser({ email: b.email, password: b.password, full_name: b.full_name }, b.role, req.actor, c); return user; });
    await audit(req.actor, 'staff.created', 'user', u.id, { role: b.role });
    reply.status(201); return { user: u };
  });
  app.post('/users/:id/roles', async (req) => {
    requirePerm(req.auth, 'roles.manage');
    const uid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ role: z.string() }), req.body);
    const role = await one<any>('SELECT id, kind FROM roles WHERE key = $1', [b.role]);
    if (!role) throw notFound('That role');
    if (b.role === 'super_admin' && !req.auth!.roles.includes('super_admin')) throw forbidden('Only a super admin can grant super admin.');
    await assignRole(uid, b.role, req.auth!.user.id);
    await audit(req.actor, 'role.granted', 'user', uid, { role: b.role });
    return { ok: true };
  });
  app.delete('/users/:id/roles/:role', async (req) => {
    requirePerm(req.auth, 'roles.manage');
    const p = parse(z.object({ id, role: z.string() }), req.params);
    if (p.id === req.auth!.user.id && p.role === 'super_admin') throw forbidden('You can not remove your own super admin role.');
    if (p.role === 'super_admin') {
      const others = await one<any>("SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin' AND ur.user_id <> $1", [p.id]);
      if (others.n === 0) throw conflict('LAST_SUPER_ADMIN', 'At least one super admin must remain.');
    }
    await query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE key = $2)', [p.id, p.role]);
    await revokeAllSessions(p.id);
    await audit(req.actor, 'role.revoked', 'user', p.id, { role: p.role });
    return { ok: true };
  });
  app.get('/roles', async (req) => {
    requirePerm(req.auth, 'users.read', 'roles.manage');
    const roles = await query<any>(`SELECT r.id, r.key, r.name, r.kind, r.description, coalesce(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
                                           (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS members FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.kind, r.name`);
    return { roles, permissions: Object.entries(PERMISSIONS).map(([key, [area, description]]) => ({ key, area, description })) };
  });
  app.put('/roles/:key/permissions', async (req) => {
    requirePerm(req.auth, 'roles.manage');
    const key = parse(z.object({ key: z.string() }), req.params).key;
    const b = parse(z.object({ permissions: z.array(z.string()).max(100) }), req.body);
    const role = await one<any>('SELECT id, kind FROM roles WHERE key = $1', [key]);
    if (!role) throw notFound('That role');
    if (key === 'super_admin') throw forbidden('The super admin role always has every permission.');
    if (role.kind !== 'staff') throw forbidden('Only staff roles can be edited.');
    for (const p of b.permissions) if (!PERMISSIONS[p]) throw badRequest('VALIDATION', `Unknown permission ${p}.`);
    const before = (await query<any>('SELECT permission_key FROM role_permissions WHERE role_id = $1', [role.id])).map((r) => r.permission_key);
    await tx(async (c) => { await query('DELETE FROM role_permissions WHERE role_id = $1', [role.id], c); for (const p of b.permissions) await query('INSERT INTO role_permissions(role_id, permission_key) VALUES ($1,$2)', [role.id, p], c); });
    await audit(req.actor, 'role.permissions_changed', 'role', key, { added: b.permissions.filter((p) => !before.includes(p)), removed: before.filter((p: string) => !b.permissions.includes(p)) });
    return { ok: true };
  });

  // ---------------- catalog oversight ----------------
  app.get('/products', async (req) => {
    requirePerm(req.auth, 'vendors.read', 'catalog.manage');
    const q = parse(pagination.extend({ q: z.string().max(80).optional(), status: z.string().optional(), vendor: id.optional() }), req.query);
    return { products: await query(`SELECT p.id, p.slug, p.name, p.status, p.product_type, p.updated_at, v.trading_name AS vendor, u.full_name AS created_by_name, p.dietary, p.dietary_verified
                                      FROM products p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN users u ON u.id = p.created_by WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR lower(p.name) LIKE lower($1)) AND ($2::text IS NULL OR p.status = $2) AND ($3::uuid IS NULL OR p.vendor_id = $3)
                                     ORDER BY p.updated_at DESC LIMIT $4 OFFSET $5`, [q.q ? `%${q.q}%` : null, q.status ?? null, q.vendor ?? null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.post('/products/:id/status', async (req) => {
    requirePerm(req.auth, 'catalog.manage');
    const pid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ status: z.enum(['active', 'draft', 'archived']), reason: z.string().max(300).optional() }), req.body);
    const r = await one<any>('UPDATE products SET status = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id', [pid, b.status]);
    if (!r) throw notFound('That product');
    await audit(req.actor, 'product.status_changed', 'product', pid, b);
    return { ok: true };
  });
  // Dietary claims are vendor declared. Staff can mark specific claims verified once evidence is seen.
  app.post('/products/:id/verify-dietary', async (req) => {
    requirePerm(req.auth, 'catalog.manage', 'compliance.manage');
    const pid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ verified: z.array(z.string()).max(10) }), req.body);
    const p = await one<any>('SELECT dietary FROM products WHERE id = $1', [pid]);
    if (!p) throw notFound('That product');
    const ok = b.verified.filter((v) => p.dietary.includes(v));
    await query('UPDATE products SET dietary_verified = $2 WHERE id = $1', [pid, ok]);
    await audit(req.actor, 'product.dietary_verified', 'product', pid, { verified: ok });
    return { verified: ok };
  });
  app.post('/categories', async (req, reply) => {
    requirePerm(req.auth, 'catalog.manage');
    reply.status(201); return { category: await saveCategory(parse(z.object({ name: z.string().min(2).max(80), parent_id: id.nullable().optional(), description: z.string().max(500).optional(), image_url: z.string().max(500).optional(), position: z.number().int().optional(), is_active: z.boolean().optional() }), req.body), req.actor) };
  });
  app.put('/categories/:id', async (req) => {
    requirePerm(req.auth, 'catalog.manage');
    return { category: await saveCategory({ ...parse(z.object({ name: z.string().min(2).max(80), parent_id: id.nullable().optional(), description: z.string().max(500).optional(), image_url: z.string().max(500).optional(), position: z.number().int().optional(), is_active: z.boolean().optional() }), req.body), id: parse(z.object({ id }), req.params).id }, req.actor) };
  });
  app.get('/categories', async (req) => { requirePerm(req.auth, 'catalog.manage', 'vendors.read', 'marketing.manage'); return { categories: await query('SELECT * FROM categories ORDER BY position, name') }; });
  app.post('/reviews/:id/moderate', async (req) => {
    requirePerm(req.auth, 'reviews.moderate');
    const b = parse(z.object({ status: z.enum(['published', 'hidden', 'flagged']), note: z.string().max(300).optional() }), req.body);
    await moderateReview(parse(z.object({ id }), req.params).id, b.status, b.note, req.actor);
    return { ok: true };
  });
  app.get('/reviews', async (req) => {
    requirePerm(req.auth, 'reviews.moderate');
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    return { reviews: await query(`SELECT r.*, u.full_name AS author, s.number FROM reviews r JOIN users u ON u.id = r.user_id JOIN suborders s ON s.id = r.suborder_id WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 100`, [q.status ?? null]) };
  });

  // ---------------- finance ----------------
  app.get('/finance/summary', async (req) => {
    requirePerm(req.auth, 'ledger.read', 'payments.read');
    const [tb, rec, pending] = await Promise.all([
      trialBalance(), reconcile(),
      one<any>("SELECT coalesce(sum(net) FILTER (WHERE status IN ('pending','processing') AND payee_type = 'vendor'),0) AS vendors, coalesce(sum(net) FILTER (WHERE status IN ('pending','processing') AND payee_type = 'driver'),0) AS drivers, coalesce(sum(net) FILTER (WHERE status = 'held'),0) AS held, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM payouts"),
    ]);
    return { trial_balance: tb, reconciliation: rec, payouts: pending };
  });
  app.get('/finance/ledger', async (req) => {
    requirePerm(req.auth, 'ledger.read');
    const q = parse(pagination.extend({ order: z.string().optional(), account: z.string().optional(), party: id.optional() }), req.query);
    return { entries: await query(`SELECT e.*, o.number AS order_number FROM ledger_entries e LEFT JOIN orders o ON o.id = e.order_id
                                    WHERE ($1::text IS NULL OR o.number = $1) AND ($2::text IS NULL OR e.account = $2) AND ($3::uuid IS NULL OR e.party_id = $3) ORDER BY e.id DESC LIMIT $4 OFFSET $5`, [q.order ?? null, q.account ?? null, q.party ?? null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.get('/finance/payments', async (req) => {
    requirePerm(req.auth, 'payments.read');
    const q = parse(pagination.extend({ status: z.string().optional() }), req.query);
    return { payments: await query(`SELECT p.*, o.number FROM payments p JOIN orders o ON o.id = p.order_id WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`, [q.status ?? null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.get('/finance/refunds', async (req) => {
    requirePerm(req.auth, 'payments.read', 'refunds.issue');
    return { refunds: await query(`SELECT r.*, o.number AS order_number, s.number AS suborder_number, u.full_name AS issued_by FROM refunds r JOIN orders o ON o.id = r.order_id LEFT JOIN suborders s ON s.id = r.suborder_id LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC LIMIT 200`) };
  });
  app.get('/finance/payouts', async (req) => {
    requirePerm(req.auth, 'payouts.read');
    const q = parse(z.object({ status: z.string().optional(), type: z.string().optional() }), req.query);
    return { payouts: await query(`SELECT p.*, CASE WHEN p.payee_type = 'vendor' THEN v.trading_name ELSE u.full_name END AS payee_name FROM payouts p LEFT JOIN vendors v ON p.payee_type = 'vendor' AND v.id = p.payee_id LEFT JOIN users u ON p.payee_type = 'driver' AND u.id = p.payee_id
                                     WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.payee_type = $2) ORDER BY p.created_at DESC LIMIT 200`, [q.status ?? null, q.type ?? null]) };
  });
  app.get('/finance/payouts/:id', async (req) => { requirePerm(req.auth, 'payouts.read'); return payoutStatement(parse(z.object({ id }), req.params).id); });
  app.post('/finance/payouts/run', async (req) => {
    requirePerm(req.auth, 'payouts.manage');
    const b = parse(z.object({ process: z.boolean().default(false), force: z.boolean().default(false) }), req.body);
    return { created: await runPayoutCycle(req.actor, b) };
  });
  app.post('/finance/payouts/:id/process', async (req) => { requirePerm(req.auth, 'payouts.manage'); return { payout: await processPayout(parse(z.object({ id }), req.params).id, req.actor) }; });
  app.post('/finance/payouts/:id/hold', async (req) => { requirePerm(req.auth, 'payouts.manage'); await holdPayout(parse(z.object({ id }), req.params).id, parse(z.object({ reason: z.string().min(3).max(300) }), req.body).reason, req.actor); return { ok: true }; });
  app.post('/finance/payouts/:id/release', async (req) => { requirePerm(req.auth, 'payouts.manage'); await releasePayout(parse(z.object({ id }), req.params).id, req.actor); return { ok: true }; });
  app.post('/finance/payouts/:id/reverse', async (req) => { requirePerm(req.auth, 'payouts.manage'); await reversePayout(parse(z.object({ id }), req.params).id, parse(z.object({ reason: z.string().min(3).max(300) }), req.body).reason, req.actor); return { ok: true }; });
  app.post('/finance/vendors/:id/payout', async (req) => {
    requirePerm(req.auth, 'payouts.manage');
    const p = await tx((c) => createVendorPayout(c, parse(z.object({ id }), req.params).id, req.actor, { force: true }));
    return { payout: p };
  });

  // ---------------- configuration engine ----------------
  app.get('/settings', async (req) => { requirePerm(req.auth, 'settings.read'); return { settings: await listSettings() }; });
  app.put('/settings/:key', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const key = parse(z.object({ key: z.string() }), req.params).key as SettingKey;
    if (!(key in SETTING_DEFS)) throw notFound('That setting');
    const r = await setSetting(key, parse(z.object({ value: z.any() }), req.body).value, req.auth!.user.id);
    await audit(req.actor, 'setting.updated', 'setting', key, r);
    return { ok: true };
  });
  app.get('/zones', async (req) => { requirePerm(req.auth, 'settings.read'); return { zones: await query("SELECT * FROM delivery_zones WHERE scope = 'platform' ORDER BY priority DESC, name") }; });
  app.post('/zones', async (req, reply) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(zoneBody, req.body);
    const z_ = await one<any>(`INSERT INTO delivery_zones(scope, name, zone_type, center_lat, center_lng, radius_km, postal_prefixes, polygon, fee_model, base_fee, per_km_fee, free_over, min_order, max_distance_km, priority, is_active)
      VALUES ('platform',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [b.name, b.zone_type, b.center_lat ?? null, b.center_lng ?? null, b.radius_km ?? null, b.postal_prefixes, b.polygon ? JSON.stringify(b.polygon) : null, b.fee_model, b.base_fee, b.per_km_fee, b.free_over ?? null, b.min_order, b.max_distance_km ?? null, b.priority, b.is_active]);
    await audit(req.actor, 'zone.created', 'delivery_zone', z_.id, b);
    reply.status(201); return { zone: z_ };
  });
  app.put('/zones/:id', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(zoneBody, req.body);
    const z_ = await one<any>(`UPDATE delivery_zones SET name=$2, zone_type=$3, center_lat=$4, center_lng=$5, radius_km=$6, postal_prefixes=$7, polygon=$8, fee_model=$9, base_fee=$10, per_km_fee=$11, free_over=$12, min_order=$13, max_distance_km=$14, priority=$15, is_active=$16
      WHERE id=$1 AND scope='platform' RETURNING *`, [parse(z.object({ id }), req.params).id, b.name, b.zone_type, b.center_lat ?? null, b.center_lng ?? null, b.radius_km ?? null, b.postal_prefixes, b.polygon ? JSON.stringify(b.polygon) : null, b.fee_model, b.base_fee, b.per_km_fee, b.free_over ?? null, b.min_order, b.max_distance_km ?? null, b.priority, b.is_active]);
    if (!z_) throw notFound('That zone');
    await audit(req.actor, 'zone.updated', 'delivery_zone', z_.id, b);
    return { zone: z_ };
  });
  app.get('/fee-rules', async (req) => { requirePerm(req.auth, 'settings.read'); return { rules: await query('SELECT * FROM delivery_fee_rules ORDER BY priority, name') }; });
  app.put('/fee-rules', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(z.object({ id: id.optional(), name: z.string().min(2).max(80), kind: z.enum(['surcharge', 'multiplier', 'discount']), amount: z.number().min(0).max(100).optional().nullable(), multiplier: z.number().min(0.1).max(5).optional().nullable(), priority: z.number().int().default(0), is_active: z.boolean().default(true),
      conditions: z.object({ distance_km_gte: z.number().optional(), distance_km_lt: z.number().optional(), subtotal_gte: z.number().optional(), subtotal_lt: z.number().optional(), weight_kg_gte: z.number().optional(), has_product_type: z.string().optional(), multi_vendor: z.boolean().optional(), demand_ratio_gte: z.number().optional(), weather_severe: z.boolean().optional(), hours: z.tuple([z.string(), z.string()]).optional(), weekdays: z.array(z.number().int().min(0).max(6)).optional() }).default({}) }), req.body);
    if (b.kind === 'multiplier' && !b.multiplier) throw badRequest('VALIDATION', 'Enter the multiplier.');
    if (b.kind !== 'multiplier' && !b.amount) throw badRequest('VALIDATION', 'Enter the amount.');
    const row = b.id
      ? await one('UPDATE delivery_fee_rules SET name=$2, kind=$3, amount=$4, multiplier=$5, conditions=$6, priority=$7, is_active=$8 WHERE id=$1 RETURNING *', [b.id, b.name, b.kind, b.amount ?? null, b.multiplier ?? null, JSON.stringify(b.conditions), b.priority, b.is_active])
      : await one('INSERT INTO delivery_fee_rules(name, kind, amount, multiplier, conditions, priority, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [b.name, b.kind, b.amount ?? null, b.multiplier ?? null, JSON.stringify(b.conditions), b.priority, b.is_active]);
    await audit(req.actor, 'fee_rule.saved', 'delivery_fee_rule', (row as any).id, b);
    return { rule: row };
  });
  app.get('/commission-rules', async (req) => { requirePerm(req.auth, 'settings.read'); return { rules: await query('SELECT r.*, v.trading_name AS vendor_name, c.name AS category_name FROM commission_rules r LEFT JOIN vendors v ON v.id = r.vendor_id LEFT JOIN categories c ON c.id = r.category_id ORDER BY r.scope, r.name') }; });
  app.put('/commission-rules', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(z.object({ id: id.optional(), name: z.string().min(2).max(80), scope: z.enum(['global', 'category', 'vendor']), vendor_id: id.optional().nullable(), category_id: id.optional().nullable(), percent: z.number().min(0).max(100), fixed_fee: z.number().min(0).default(0), valid_from: z.coerce.date().optional().nullable(), valid_to: z.coerce.date().optional().nullable(), is_active: z.boolean().default(true) }), req.body);
    if (b.scope === 'vendor' && !b.vendor_id) throw badRequest('VALIDATION', 'Choose a vendor.');
    if (b.scope === 'category' && !b.category_id) throw badRequest('VALIDATION', 'Choose a category.');
    const row = b.id
      ? await one('UPDATE commission_rules SET name=$2, scope=$3, vendor_id=$4, category_id=$5, percent=$6, fixed_fee=$7, valid_from=$8, valid_to=$9, is_active=$10 WHERE id=$1 RETURNING *', [b.id, b.name, b.scope, b.vendor_id ?? null, b.category_id ?? null, b.percent, b.fixed_fee, b.valid_from ?? null, b.valid_to ?? null, b.is_active])
      : await one('INSERT INTO commission_rules(name, scope, vendor_id, category_id, percent, fixed_fee, valid_from, valid_to, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [b.name, b.scope, b.vendor_id ?? null, b.category_id ?? null, b.percent, b.fixed_fee, b.valid_from ?? null, b.valid_to ?? null, b.is_active]);
    await audit(req.actor, 'commission_rule.saved', 'commission_rule', (row as any).id, b);
    return { rule: row };
  });
  app.get('/tax-rules', async (req) => { requirePerm(req.auth, 'settings.read'); return { rules: await query('SELECT * FROM tax_rules ORDER BY country, region, tax_class') }; });
  app.put('/tax-rules', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(z.object({ country: z.string().length(2).default('CA'), region: z.string().min(1).max(5), tax_class: z.string().min(2).max(30), name: z.string().min(2).max(40), rate: z.number().min(0).max(50), active: z.boolean().default(true) }), req.body);
    await query(`INSERT INTO tax_rules(country, region, tax_class, name, rate, active) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (country, region, tax_class, name) DO UPDATE SET rate = $5, active = $6`, [b.country, b.region.toUpperCase(), b.tax_class, b.name, b.rate, b.active]);
    await audit(req.actor, 'tax_rule.saved', 'tax_rule', `${b.region}:${b.tax_class}`, b);
    return { ok: true };
  });
  app.get('/plans', async (req) => { requirePerm(req.auth, 'settings.read'); return { plans: await query('SELECT * FROM vendor_plans ORDER BY monthly_price') }; });
  app.post('/plans/assign', async (req) => {
    requirePerm(req.auth, 'settings.manage');
    const b = parse(z.object({ vendor_id: id, plan_key: z.string() }), req.body);
    const plan = await one<any>('SELECT id FROM vendor_plans WHERE key = $1 AND is_active', [b.plan_key]);
    if (!plan) throw notFound('That plan');
    await tx(async (c) => {
      await query("UPDATE vendor_subscriptions SET status = 'cancelled' WHERE vendor_id = $1 AND status = 'active'", [b.vendor_id], c);
      await query("INSERT INTO vendor_subscriptions(vendor_id, plan_id, current_period_end) VALUES ($1,$2, now() + interval '1 month')", [b.vendor_id, plan.id], c);
    });
    await audit(req.actor, 'vendor.plan_assigned', 'vendor', b.vendor_id, b);
    return { ok: true };
  });

  // ---------------- risk and audit ----------------
  app.get('/risk', async (req) => {
    requirePerm(req.auth, 'fraud.read');
    const q = parse(z.object({ status: z.string().default('open') }), req.query);
    return { signals: await query(`SELECT r.*, CASE r.subject_type WHEN 'customer' THEN (SELECT full_name FROM users WHERE id = r.subject_id) WHEN 'vendor' THEN (SELECT trading_name FROM vendors WHERE id = r.subject_id) WHEN 'driver' THEN (SELECT legal_name FROM driver_profiles WHERE user_id = r.subject_id) END AS subject_name
                                     FROM risk_signals r WHERE r.status = ANY(string_to_array($1, ',')) ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 200`, [q.status]) };
  });
  app.post('/risk/:id/review', async (req) => {
    requirePerm(req.auth, 'fraud.manage');
    const b = parse(z.object({ status: z.enum(['reviewed', 'dismissed', 'actioned']), note: z.string().max(500).optional() }), req.body);
    return { signal: await reviewSignal(parse(z.object({ id }), req.params).id, b.status, b.note, req.actor) };
  });
  app.get('/audit', async (req) => {
    requirePerm(req.auth, 'audit.read');
    const q = parse(pagination.extend({ entityType: z.string().optional(), entityId: z.string().optional(), actor: id.optional(), action: z.string().optional() }), req.query);
    return { entries: await query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.changes, a.ip, a.user_agent, a.created_at, a.actor_role, u.full_name AS actor_name, u.email AS actor_email
                                     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
                                    WHERE ($1::text IS NULL OR a.entity_type = $1) AND ($2::text IS NULL OR a.entity_id = $2) AND ($3::uuid IS NULL OR a.actor_user_id = $3) AND ($4::text IS NULL OR a.action LIKE $4)
                                    ORDER BY a.id DESC LIMIT $5 OFFSET $6`, [q.entityType ?? null, q.entityId ?? null, q.actor ?? null, q.action ? `${q.action}%` : null, q.limit, (q.page - 1) * q.limit]) };
  });
  app.get('/outbox', async (req) => {
    requirePerm(req.auth, 'settings.read');
    return { messages: await query('SELECT id, channel, recipient, subject, body, provider, status, created_at FROM message_outbox ORDER BY id DESC LIMIT 100') };
  });
  void requireUser; void isStaff; void notify; void hashPassword; void passwordProblem; void sendOrderMessage;
}
