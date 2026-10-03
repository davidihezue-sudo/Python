import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, id, pagination } from '../lib/util.js';
import { query, one } from '../db.js';
import { requireUser, requirePerm } from '../lib/rbac.js';
import { createTicket, getTicket, replyToTicket, updateTicket, openDispute, resolveDispute, sendOrderMessage, listOrderMessages } from '../modules/support.js';
import { vendorAccess } from '../lib/rbac.js';

export async function supportRoutes(app: FastifyInstance) {
  // Tickets visible to the caller: their own, their store's, or everything for support staff.
  app.get('/tickets', async (req) => {
    const a = requireUser(req.auth);
    const q = parse(pagination.extend({ status: z.string().optional(), category: z.string().optional(), assigned: z.enum(['me', 'unassigned']).optional(), scope: z.enum(['mine', 'all']).default('mine'), q: z.string().max(80).optional() }), req.query);
    const staff = a.perms.has('support.read') && q.scope === 'all';
    const vendorIds = a.memberships.map((m) => m.vendor_id);
    const rows = await query<any>(
      `SELECT t.id, t.number, t.subject, t.status, t.priority, t.category, t.created_at, t.updated_at, t.assigned_to, o.number AS order_number, u.full_name AS requester, au.full_name AS assignee,
              (SELECT count(*)::int FROM messages m WHERE m.thread_type = 'ticket' AND m.thread_id = t.id) AS messages
         FROM support_tickets t JOIN users u ON u.id = t.requester_id LEFT JOIN users au ON au.id = t.assigned_to LEFT JOIN orders o ON o.id = t.order_id
        WHERE ($1::boolean OR t.requester_id = $2 OR t.vendor_id = ANY($3::uuid[]) OR t.driver_id = $2)
          AND ($4::text IS NULL OR t.status = ANY(string_to_array($4, ','))) AND ($5::text IS NULL OR t.category = $5)
          AND ($6::text IS NULL OR ($6 = 'me' AND t.assigned_to = $2) OR ($6 = 'unassigned' AND t.assigned_to IS NULL))
          AND ($7::text IS NULL OR t.number ILIKE $7 OR lower(t.subject) LIKE lower($7))
        ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT $8 OFFSET $9`,
      [staff, a.user.id, vendorIds, q.status ?? null, q.category ?? null, q.assigned ?? null, q.q ? `%${q.q}%` : null, q.limit, (q.page - 1) * q.limit]);
    return { tickets: rows };
  });
  app.post('/tickets', async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ category: z.string(), subject: z.string().min(3).max(200), body: z.string().min(3).max(4000), orderId: id.optional(), suborderId: id.optional() }), req.body);
    reply.status(201); return { ticket: await createTicket(a, b, req.actor) };
  });
  app.get('/tickets/:id', async (req) => getTicket(requireUser(req.auth), parse(z.object({ id }), req.params).id));
  app.post('/tickets/:id/messages', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ body: z.string().min(1).max(4000), internal: z.boolean().optional() }), req.body);
    return replyToTicket(a, parse(z.object({ id }), req.params).id, b.body, { internal: b.internal });
  });
  app.patch('/tickets/:id', async (req) => {
    requirePerm(req.auth, 'support.manage');
    const b = parse(z.object({ status: z.string().optional(), assigned_to: id.nullable().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), resolution_note: z.string().max(1000).optional() }), req.body);
    return { ticket: await updateTicket(parse(z.object({ id }), req.params).id, b, req.actor) };
  });
  app.get('/support/agents', async (req) => {
    requirePerm(req.auth, 'support.manage');
    return { agents: await query(`SELECT DISTINCT u.id, u.full_name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE rp.permission_key = 'support.manage' AND u.status = 'active' ORDER BY u.full_name`) };
  });

  // Order conversations between customer, store and driver. No personal contact details are exchanged.
  app.get('/suborders/:id/messages', async (req) => {
    const a = requireUser(req.auth);
    const q = parse(z.object({ channel: z.string() }), req.query);
    return { messages: await listOrderMessages(a, parse(z.object({ id }), req.params).id, q.channel) };
  });
  app.post('/suborders/:id/messages', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ channel: z.string(), body: z.string().min(1).max(1000) }), req.body);
    return sendOrderMessage(a, parse(z.object({ id }), req.params).id, b.channel, b.body);
  });

  app.post('/suborders/:id/dispute', async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ reason: z.string().min(5).max(2000), category: z.string().optional(), claimedAmount: z.number().min(0).optional() }), req.body);
    reply.status(201); return openDispute(a.user.id, parse(z.object({ id }), req.params).id, b, req.actor);
  });
  app.get('/disputes', async (req) => {
    requirePerm(req.auth, 'disputes.resolve', 'support.read');
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    return { disputes: await query(`SELECT d.*, s.number AS suborder_number, o.number AS order_number, v.trading_name AS vendor, u.full_name AS customer, s.customer_total
                                      FROM disputes d JOIN suborders s ON s.id = d.suborder_id JOIN orders o ON o.id = d.order_id JOIN vendors v ON v.id = s.vendor_id JOIN users u ON u.id = d.opened_by
                                     WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.created_at DESC LIMIT 100`, [q.status ?? null]) };
  });
  app.get('/disputes/:id', async (req) => {
    requirePerm(req.auth, 'disputes.resolve', 'support.read');
    const d = await one<any>('SELECT * FROM disputes WHERE id = $1', [parse(z.object({ id }), req.params).id]);
    if (!d) return { dispute: null };
    const [order, items, delivery, refunds] = await Promise.all([
      one('SELECT s.*, v.trading_name AS vendor FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1', [d.suborder_id]),
      query('SELECT id, name, variant_name, quantity, refunded_qty, unit_price, line_subtotal FROM order_items WHERE suborder_id = $1', [d.suborder_id]),
      one("SELECT status, proof, delivered_at, distance_km FROM delivery_jobs WHERE suborder_id = $1", [d.suborder_id]),
      query('SELECT amount, reason, bearer, created_at FROM refunds WHERE suborder_id = $1', [d.suborder_id]),
    ]);
    return { dispute: d, suborder: order, items, delivery, refunds };
  });
  app.post('/disputes/:id/resolve', async (req) => {
    requirePerm(req.auth, 'disputes.resolve');
    const b = parse(z.object({
      resolution: z.enum(['full_refund', 'partial_refund', 'replacement', 'vendor_credit', 'customer_credit', 'no_refund']), amount: z.number().positive().optional(), reason: z.string().min(3).max(1000),
      bearer: z.enum(['vendor', 'platform']).optional(), lines: z.array(z.object({ orderItemId: id, qty: z.number().int().min(1) })).optional(), includeDelivery: z.boolean().optional(),
    }), req.body);
    return resolveDispute(parse(z.object({ id }), req.params).id, b, req.actor);
  });
  void vendorAccess;
}
