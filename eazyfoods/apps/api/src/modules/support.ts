// Support tickets, order messaging between parties, and disputes.
import { query, one, tx } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Actor } from '../lib/audit.js';
import { notify, notifyStaff, notifyVendor } from '../lib/notifications.js';
import { publish } from '../lib/events.js';
import { getSetting } from '../lib/settings.js';
import { fromCents, toCents } from '../money.js';
import type { AuthCtx } from '../lib/auth.js';
import { vendorAccess } from '../lib/rbac.js';
import { refundSuborder } from './orders/refunds.js';
import { transitionSuborder, recomputeOrderStatus } from './orders/core.js';
import { postCreditGrant, postTxn } from './ledger.js';

export const TICKET_STATUSES = ['open', 'assigned', 'waiting_customer', 'waiting_vendor', 'waiting_driver', 'resolved', 'closed'] as const;
const CATEGORIES = ['missing_items', 'incorrect_items', 'late_delivery', 'damaged', 'payment_issue', 'refund_request', 'vendor_complaint', 'driver_complaint', 'driver_issue', 'vendor_support', 'other'];

export async function createTicket(user: AuthCtx, p: { category: string; subject: string; body: string; orderId?: string; suborderId?: string }, actor: Actor) {
  if (!CATEGORIES.includes(p.category)) throw badRequest('VALIDATION', 'Choose what your question is about.');
  return tx(async (c) => {
    let orderId = p.orderId ?? null, suborderId = p.suborderId ?? null, vendorId: string | null = null, driverId: string | null = null;
    if (suborderId) {
      const s = await one<any>('SELECT s.*, o.user_id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1', [suborderId], c);
      if (!s) throw notFound('That order');
      const isCustomer = s.user_id === user.user.id;
      const isVendor = vendorAccess(user, s.vendor_id, 'support');
      if (!isCustomer && !isVendor && !user.perms.has('support.manage')) throw forbidden();
      orderId = s.order_id; vendorId = s.vendor_id;
      driverId = (await one<any>('SELECT driver_id FROM delivery_jobs WHERE suborder_id = $1', [suborderId], c))?.driver_id ?? null;
    } else if (orderId) {
      const o = await one<any>('SELECT user_id FROM orders WHERE id = $1', [orderId], c);
      if (!o || (o.user_id !== user.user.id && !user.perms.has('support.manage'))) throw notFound('That order');
    }
    const num = (await one<any>("SELECT nextval('ticket_number_seq')::int AS n", [], c))!.n;
    const priority = ['payment_issue', 'missing_items'].includes(p.category) ? 'high' : 'normal';
    const t = (await one<any>(
      `INSERT INTO support_tickets(number, requester_id, order_id, suborder_id, vendor_id, driver_id, category, subject, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [`T-${num}`, user.user.id, orderId, suborderId, vendorId, driverId, p.category, p.subject.slice(0, 200), priority], c))!;
    await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body) VALUES ('ticket',$1,$2,$3,$4)", [t.id, user.user.id, roleLabel(user), p.body], c);
    await notifyStaff('support.manage', { kind: 'support_escalation', title: `New ticket ${t.number}`, body: p.subject, data: { ticketId: t.id } }, c);
    publish('admin', 'ticket.new', { ticketId: t.id });
    await audit(actor, 'ticket.created', 'ticket', t.id, { category: p.category }, c);
    return t;
  });
}
const roleLabel = (a: AuthCtx) => (a.perms.has('support.manage') ? 'support' : a.memberships.length ? 'vendor' : a.roles.includes('driver') ? 'driver' : 'customer');

export async function canViewTicket(a: AuthCtx, t: any) {
  if (t.requester_id === a.user.id || a.perms.has('support.read')) return true;
  if (t.vendor_id && vendorAccess(a, t.vendor_id, 'support')) return true;
  if (t.driver_id && t.driver_id === a.user.id) return true;
  return false;
}

export async function getTicket(a: AuthCtx, ticketId: string) {
  const t = await one<any>(
    `SELECT t.*, o.number AS order_number, s.number AS suborder_number, u.full_name AS requester_name FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN suborders s ON s.id = t.suborder_id JOIN users u ON u.id = t.requester_id WHERE t.id = $1`, [ticketId]);
  if (!t || !(await canViewTicket(a, t))) throw notFound('That ticket');
  const staff = a.perms.has('support.read');
  const messages = await query<any>(
    `SELECT m.id, m.sender_id, m.sender_role, m.body, m.is_internal, m.created_at, u.full_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.thread_type = 'ticket' AND m.thread_id = $1 ${staff ? '' : 'AND NOT m.is_internal'} ORDER BY m.created_at`, [ticketId]);
  const dispute = await one<any>('SELECT * FROM disputes WHERE ticket_id = $1', [ticketId]);
  return { ticket: t, messages: messages.map((m) => ({ ...m, mine: m.sender_id === a.user.id })), dispute };
}

export async function replyToTicket(a: AuthCtx, ticketId: string, body: string, opts: { internal?: boolean } = {}) {
  if (!body.trim()) throw badRequest('VALIDATION', 'Write a message first.');
  return tx(async (c) => {
    const t = await one<any>('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId], c);
    if (!t || !(await canViewTicket(a, t))) throw notFound('That ticket');
    if (t.status === 'closed') throw conflict('TICKET_CLOSED', 'This ticket is closed. Please open a new one if you still need help.');
    const staff = a.perms.has('support.manage');
    const internal = !!opts.internal && staff;
    await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body, is_internal) VALUES ('ticket',$1,$2,$3,$4,$5)", [ticketId, a.user.id, roleLabel(a), body.trim(), internal], c);
    let next = t.status;
    if (!internal) {
      if (t.requester_id === a.user.id) next = ['waiting_customer', 'resolved'].includes(t.status) ? (t.assigned_to ? 'assigned' : 'open') : t.status;
      else if (staff && ['open', 'assigned'].includes(t.status)) next = 'waiting_customer';
      else if (!staff && t.status.startsWith('waiting_')) next = t.assigned_to ? 'assigned' : 'open';
    }
    if (next !== t.status) await query('UPDATE support_tickets SET status = $2 WHERE id = $1', [ticketId, next], c);
    else await query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [ticketId], c);
    if (!internal) {
      if (t.requester_id !== a.user.id) await notify({ userId: t.requester_id, kind: 'support_update', title: `Update on ${t.number}`, body: body.trim().slice(0, 140), data: { ticketId } }, c);
      else if (t.assigned_to) await notify({ userId: t.assigned_to, kind: 'support_update', title: `Reply on ${t.number}`, body: body.trim().slice(0, 140), data: { ticketId } }, c);
      else await notifyStaff('support.manage', { kind: 'support_escalation', title: `Reply on ${t.number}`, body: body.trim().slice(0, 140), data: { ticketId } }, c);
      publish(`user:${t.requester_id}`, 'ticket.message', { ticketId });
    }
    publish('admin', 'ticket.message', { ticketId });
    return { status: next };
  });
}

export async function updateTicket(ticketId: string, p: { status?: string; assigned_to?: string | null; priority?: string; resolution_note?: string }, actor: Actor) {
  if (p.status && !TICKET_STATUSES.includes(p.status as any)) throw badRequest('VALIDATION', 'That status is not valid.');
  return tx(async (c) => {
    const t = await one<any>('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [ticketId], c);
    if (!t) throw notFound('That ticket');
    if (p.assigned_to) {
      const staff = await one(`SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1 AND rp.permission_key = 'support.manage' LIMIT 1`, [p.assigned_to], c);
      if (!staff) throw badRequest('VALIDATION', 'That person can not be assigned tickets.');
    }
    const status = p.status ?? (p.assigned_to && t.status === 'open' ? 'assigned' : t.status);
    const row = await one<any>(
      `UPDATE support_tickets SET status = $2, assigned_to = coalesce($3, assigned_to), priority = coalesce($4, priority), resolution_note = coalesce($5, resolution_note),
              closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END WHERE id = $1 RETURNING *`, [ticketId, status, p.assigned_to ?? null, p.priority ?? null, p.resolution_note ?? null], c);
    await audit(actor, 'ticket.updated', 'ticket', ticketId, { from: t.status, to: status, assigned_to: p.assigned_to }, c);
    if (['resolved', 'closed'].includes(status) && t.status !== status) await notify({ userId: t.requester_id, kind: 'support_update', title: `${t.number} ${status}`, body: p.resolution_note ?? 'Your ticket was updated.', data: { ticketId } }, c);
    return row;
  });
}

// ---------------- order messaging ----------------
const CHANNELS = ['customer_vendor', 'customer_driver', 'vendor_driver'] as const;
type Channel = (typeof CHANNELS)[number];

async function orderParties(a: AuthCtx, suborderId: string) {
  const s = await one<any>(`SELECT s.id, s.status, s.vendor_id, s.number, s.completed_at, o.user_id, j.driver_id, j.status AS job_status FROM suborders s JOIN orders o ON o.id = s.order_id LEFT JOIN delivery_jobs j ON j.suborder_id = s.id WHERE s.id = $1`, [suborderId]);
  if (!s) throw notFound('That order');
  const roles = new Set<string>();
  if (s.user_id === a.user.id) roles.add('customer');
  if (vendorAccess(a, s.vendor_id, 'orders')) roles.add('vendor');
  if (s.driver_id === a.user.id) roles.add('driver');
  return { s, roles };
}
function channelAllowed(ch: Channel, roles: Set<string>) { return ch.split('_').some((r) => roles.has(r)); }

export async function sendOrderMessage(a: AuthCtx, suborderId: string, channel: string, body: string) {
  if (!CHANNELS.includes(channel as Channel)) throw badRequest('VALIDATION', 'Unknown conversation.');
  if (!body.trim()) throw badRequest('VALIDATION', 'Write a message first.');
  const { s, roles } = await orderParties(a, suborderId);
  if (!channelAllowed(channel as Channel, roles)) throw forbidden();
  const done = ['completed', 'cancelled', 'refunded'].includes(s.status);
  if (channel.includes('driver')) {
    if (!s.driver_id || ['delivered', 'cancelled', 'failed'].includes(s.job_status ?? 'cancelled')) throw conflict('CHAT_CLOSED', 'This conversation is closed because the delivery has finished.');
  } else if (done && s.completed_at && Date.now() - new Date(s.completed_at).getTime() > 86400000) {
    throw conflict('CHAT_CLOSED', 'This conversation is closed. Please open a support ticket if you still need help.');
  }
  const role = [...roles].find((r) => channel.includes(r))!;
  await query("INSERT INTO messages(thread_type, thread_id, channel, sender_id, sender_role, body) VALUES ('order',$1,$2,$3,$4,$5)", [suborderId, channel, a.user.id, role, body.trim()]);
  const [x, y] = channel.split('_');
  const others: string[] = [];
  const parties: Record<string, () => Promise<string[]>> = {
    customer: async () => [s.user_id], driver: async () => (s.driver_id ? [s.driver_id] : []),
    vendor: async () => (await query<any>('SELECT user_id FROM vendor_users WHERE vendor_id = $1', [s.vendor_id])).map((r) => r.user_id),
  };
  for (const r of [x, y]) if (r !== role) others.push(...(await parties[r]()));
  for (const uid of others) {
    await notify({ userId: uid, kind: 'message', title: `Message about ${s.number}`, body: body.trim().slice(0, 140), data: { suborderId, channel } });
    publish(`user:${uid}`, 'order.message', { suborderId, channel });
  }
  return { ok: true };
}
export async function listOrderMessages(a: AuthCtx, suborderId: string, channel: string) {
  if (!CHANNELS.includes(channel as Channel)) throw badRequest('VALIDATION', 'Unknown conversation.');
  const { roles } = await orderParties(a, suborderId);
  if (!channelAllowed(channel as Channel, roles) && !a.perms.has('orders.read')) throw forbidden();
  const rows = await query<any>(`SELECT m.id, m.sender_id, m.sender_role, m.body, m.created_at FROM messages m WHERE m.thread_type = 'order' AND m.thread_id = $1 AND m.channel = $2 ORDER BY m.created_at`, [suborderId, channel]);
  return rows.map((m) => ({ ...m, mine: m.sender_id === a.user.id, sender_id: undefined }));
}

// ---------------- disputes ----------------
export async function openDispute(userId: string, suborderId: string, p: { reason: string; category?: string; claimedAmount?: number }, actor: Actor) {
  if (!p.reason.trim()) throw badRequest('VALIDATION', 'Tell us what went wrong.');
  const refunds = await getSetting('refunds');
  return tx(async (c) => {
    const s = await one<any>('SELECT s.*, o.user_id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s', [suborderId], c);
    if (!s || s.user_id !== userId) throw notFound('That order');
    if (!['delivered', 'completed', 'partially_refunded'].includes(s.status)) throw conflict('NOT_DISPUTABLE', 'You can report a problem once the order has been delivered.');
    const at = s.delivered_at ?? s.completed_at;
    if (at && Date.now() - new Date(at).getTime() > refunds.window_days * 86400000) throw conflict('WINDOW_PASSED', `The ${refunds.window_days} day window to report a problem has passed. Please contact support.`);
    if (await one("SELECT 1 FROM disputes WHERE suborder_id = $1 AND status <> 'resolved'", [suborderId], c)) throw conflict('DISPUTE_EXISTS', 'You already have an open report for this order.');
    const num = (await one<any>("SELECT nextval('ticket_number_seq')::int AS n", [], c))!.n;
    const driverId = (await one<any>('SELECT driver_id FROM delivery_jobs WHERE suborder_id = $1', [suborderId], c))?.driver_id ?? null;
    const t = (await one<any>(
      `INSERT INTO support_tickets(number, requester_id, order_id, suborder_id, vendor_id, driver_id, category, subject, priority, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'high','waiting_vendor') RETURNING *`,
      [`T-${num}`, userId, s.order_id, s.id, s.vendor_id, driverId, p.category && CATEGORIES.includes(p.category) ? p.category : 'refund_request', `Problem with order ${s.number}`], c))!;
    await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body) VALUES ('ticket',$1,$2,'customer',$3)", [t.id, userId, p.reason], c);
    const d = (await one<any>('INSERT INTO disputes(ticket_id, order_id, suborder_id, opened_by, reason, claimed_amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [t.id, s.order_id, s.id, userId, p.reason, p.claimedAmount ?? null], c))!;
    await transitionSuborder(c, s.id, 'disputed', actor, { note: 'Customer opened a dispute' });
    await recomputeOrderStatus(c, s.order_id, actor);
    await notifyVendor(s.vendor_id, { kind: 'support_ticket', title: `Customer reported a problem with ${s.number}`, body: 'Please review and respond so we can resolve it quickly.', data: { disputeId: d.id, ticketId: t.id } }, c);
    await notifyStaff('disputes.resolve', { kind: 'support_escalation', title: `New dispute ${t.number}`, body: p.reason.slice(0, 120), data: { disputeId: d.id } }, c);
    await audit(actor, 'dispute.opened', 'dispute', d.id, { suborderId }, c);
    return { dispute: d, ticket: t };
  });
}

export async function vendorRespondDispute(vendorId: string, disputeId: string, text: string, actor: Actor) {
  return tx(async (c) => {
    const d = await one<any>('SELECT d.*, s.vendor_id FROM disputes d JOIN suborders s ON s.id = d.suborder_id WHERE d.id = $1 FOR UPDATE OF d', [disputeId], c);
    if (!d || d.vendor_id !== vendorId) throw notFound('That dispute');
    if (d.status === 'resolved') throw conflict('DISPUTE_CLOSED', 'This dispute is already resolved.');
    if (!text.trim()) throw badRequest('VALIDATION', 'Write your response.');
    await query("UPDATE disputes SET vendor_response = $2, vendor_responded_at = now(), status = 'under_review' WHERE id = $1", [disputeId, text.trim()], c);
    await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body) VALUES ('ticket',$1,$2,'vendor',$3)", [d.ticket_id, actor.userId, text.trim()], c);
    await query("UPDATE support_tickets SET status = 'open' WHERE id = $1", [d.ticket_id], c);
    await notifyStaff('disputes.resolve', { kind: 'support_escalation', title: 'Vendor responded to a dispute', body: text.slice(0, 120), data: { disputeId } }, c);
    await audit(actor, 'dispute.vendor_response', 'dispute', disputeId, null, c);
  });
}

export interface Resolution { resolution: 'full_refund' | 'partial_refund' | 'replacement' | 'vendor_credit' | 'customer_credit' | 'no_refund'; amount?: number; reason: string; bearer?: 'vendor' | 'platform'; lines?: { orderItemId: string; qty: number }[]; includeDelivery?: boolean }
export async function resolveDispute(disputeId: string, r: Resolution, actor: Actor) {
  if (!r.reason?.trim()) throw badRequest('VALIDATION', 'Record the reason for your decision.');
  return tx(async (c) => {
    const d = await one<any>('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [disputeId], c);
    if (!d) throw notFound('That dispute');
    if (d.status === 'resolved') throw conflict('DISPUTE_CLOSED', 'This dispute is already resolved.');
    const s = await one<any>('SELECT s.*, o.user_id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1', [d.suborder_id], c);
    let amount: number | null = null;
    const bearer = r.bearer ?? 'vendor';
    if (r.resolution === 'full_refund') {
      const res = await refundSuborder(c, { suborderId: s.id, fullItems: true, includeDelivery: r.includeDelivery ?? false, bearer, reason: r.reason, disputeId }, actor);
      amount = res.amount;
    } else if (r.resolution === 'partial_refund') {
      if (!r.amount && !r.lines?.length) throw badRequest('VALIDATION', 'Enter the refund amount or choose items.');
      const res = await refundSuborder(c, { suborderId: s.id, amount: r.lines?.length ? undefined : r.amount, lines: r.lines, includeDelivery: r.includeDelivery, bearer, reason: r.reason, disputeId }, actor);
      amount = res.amount;
    } else if (r.resolution === 'customer_credit') {
      if (!r.amount || r.amount <= 0) throw badRequest('VALIDATION', 'Enter the credit amount.');
      await query('INSERT INTO customer_credit_entries(user_id, amount, reason, order_id, dispute_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [s.user_id, r.amount, `Dispute credit for ${s.number}`, s.order_id, disputeId, actor.userId], c);
      await postCreditGrant(c, s.user_id, toCents(r.amount), `dispute ${disputeId}`, s.order_id);
      amount = r.amount;
    } else if (r.resolution === 'vendor_credit') {
      if (!r.amount || r.amount <= 0) throw badRequest('VALIDATION', 'Enter the credit amount.');
      await postTxn(c, { entryType: 'vendor_credit', orderId: s.order_id, suborderId: s.id, memo: `Dispute ${disputeId}` }, [
        { account: 'expense_refund', side: 'debit', amount: toCents(r.amount) }, { account: 'liability_vendor', side: 'credit', amount: toCents(r.amount), partyType: 'vendor', partyId: s.vendor_id }]);
      amount = r.amount;
    }
    await query(`UPDATE disputes SET status = 'resolved', resolution = $2, resolution_amount = $3, resolution_reason = $4, resolved_by = $5, resolved_at = now() WHERE id = $1`, [disputeId, r.resolution, amount, r.reason, actor.userId], c);
    // A disputed suborder goes back to completed unless a refund already moved it.
    const now = await one<any>('SELECT status FROM suborders WHERE id = $1', [s.id], c);
    if (now.status === 'disputed') await transitionSuborder(c, s.id, 'completed', actor, { note: `Dispute resolved: ${r.resolution}` });
    await recomputeOrderStatus(c, s.order_id, actor);
    await query("UPDATE support_tickets SET status = 'resolved', resolution_note = $2 WHERE id = $1", [d.ticket_id, `${r.resolution.replace(/_/g, ' ')}: ${r.reason}`], c);
    await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body) VALUES ('ticket',$1,$2,'support',$3)", [d.ticket_id, actor.userId, `Decision: ${r.resolution.replace(/_/g, ' ')}${amount ? ` ($${amount.toFixed(2)})` : ''}. ${r.reason}`], c);
    await notify({ userId: s.user_id, kind: 'support_update', title: `Your report for ${s.number} was resolved`, body: `${r.resolution.replace(/_/g, ' ')}. ${r.reason}`, data: { disputeId } }, c);
    await notifyVendor(s.vendor_id, { kind: 'support_ticket', title: `Dispute resolved for ${s.number}`, body: `Decision: ${r.resolution.replace(/_/g, ' ')}.`, data: { disputeId } }, c);
    await audit(actor, 'dispute.resolved', 'dispute', disputeId, { ...r, amount }, c);
    return { resolution: r.resolution, amount };
  });
}
export { fromCents };
