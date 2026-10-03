// Read models for orders: customer view with a tracking timeline, vendor view, and staff view.
import { query, one, pool, type Db } from '../db.js';
import { notFound, forbidden } from '../errors.js';
import { SUBORDER_LABELS } from '../lib/states.js';
import { getSetting } from '../lib/settings.js';
import type { AuthCtx } from '../lib/auth.js';
import { vendorAccess } from '../lib/rbac.js';

const num = (v: any) => (v == null ? v : Number(v));

function timeline(sub: any, hist: any[], job: any | null) {
  const at = (...statuses: string[]) => hist.filter((h) => statuses.includes(h.to_status)).map((h) => h.at)[0] ?? null;
  const steps: { key: string; label: string; at: string | null; done: boolean }[] = [
    { key: 'placed', label: 'Order placed', at: sub.created_at, done: true },
    { key: 'paid', label: 'Payment confirmed', at: at('confirmed'), done: false },
    { key: 'accepted', label: sub.fulfillment_type === 'pickup' ? 'Store confirmed' : 'Store confirmed', at: at('vendor_accepted'), done: false },
    { key: 'preparing', label: 'Preparing', at: at('preparing'), done: false },
    { key: 'ready', label: sub.fulfillment_type === 'pickup' ? 'Ready for pickup' : 'Ready', at: at('ready_for_pickup'), done: false },
  ];
  if (sub.fulfillment_type === 'delivery_platform') {
    steps.push({ key: 'driver', label: 'Driver assigned', at: at('driver_assigned'), done: false }, { key: 'pickedup', label: 'Driver picked up', at: at('picked_up'), done: false }, { key: 'approaching', label: 'On the way', at: at('in_transit'), done: false }, { key: 'delivered', label: 'Delivered', at: at('delivered'), done: false });
  } else if (sub.fulfillment_type === 'delivery_vendor') {
    steps.push({ key: 'pickedup', label: 'Out for delivery', at: at('picked_up'), done: false }, { key: 'delivered', label: 'Delivered', at: at('delivered'), done: false });
  } else steps.push({ key: 'collected', label: 'Collected', at: at('picked_up'), done: false });
  for (const s of steps) s.done = !!s.at;
  if (sub.status === 'cancelled') steps.push({ key: 'cancelled', label: 'Cancelled', at: sub.cancelled_at, done: true });
  void job;
  return steps;
}

export async function customerOrder(userId: string, orderId: string, db: Db = pool) {
  const o = await one<any>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId], db);
  if (!o) throw notFound('That order');
  return assemble(o, 'customer', db);
}

async function assemble(o: any, view: 'customer' | 'staff', db: Db) {
  const priv = await getSetting('privacy', db);
  const subs = await query<any>(
    `SELECT s.*, v.trading_name AS vendor_name, v.slug AS vendor_slug, v.seller_type, v.logo_url, v.line1 AS v_line1, v.city AS v_city, v.lat AS v_lat, v.lng AS v_lng
       FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.order_id = $1 ORDER BY s.suffix`, [o.id], db);
  const out: any[] = [];
  for (const s of subs) {
    const [items, hist, job, reviews, dispute] = await Promise.all([
      query<any>('SELECT id, product_id, variant_id, name, variant_name, image_url, unit_price, quantity, line_subtotal, discount_vendor, discount_platform, tax_amount, refunded_qty FROM order_items WHERE suborder_id = $1 ORDER BY name', [s.id], db),
      query<any>(`SELECT to_status, at, note FROM order_status_history WHERE entity_type = 'suborder' AND entity_id = $1 ORDER BY at, id`, [s.id], db),
      one<any>(`SELECT j.*, u.full_name AS driver_name, (SELECT vehicle_type FROM vehicles v WHERE v.driver_id = j.driver_id AND v.is_active LIMIT 1) AS vehicle, d.rating_avg AS driver_rating, d.current_lat, d.current_lng, d.location_updated_at
                  FROM delivery_jobs j LEFT JOIN users u ON u.id = j.driver_id LEFT JOIN driver_profiles d ON d.user_id = j.driver_id WHERE j.suborder_id = $1`, [s.id], db),
      query<any>('SELECT subject_type, subject_id FROM reviews WHERE suborder_id = $1 AND user_id = $2', [s.id, o.user_id], db),
      one<any>('SELECT id, status, resolution, resolution_amount, resolution_reason FROM disputes WHERE suborder_id = $1 ORDER BY created_at DESC LIMIT 1', [s.id], db),
    ]);
    const live = job && ['assigned', 'at_pickup', 'picked_up', 'in_transit'].includes(job.status);
    const delivery = job ? {
      status: job.status, estimatedMinutes: job.est_minutes, distanceKm: num(job.distance_km),
      driver: job.driver_id && view === 'customer' ? { first_name: String(job.driver_name).split(' ')[0], vehicle: job.vehicle, rating: num(job.driver_rating) } : job.driver_id ? { name: job.driver_name, id: job.driver_id } : null,
      location: live && priv.show_driver_location_to_customer && job.current_lat != null ? { lat: job.current_lat, lng: job.current_lng, updated_at: job.location_updated_at } : null,
      dropoff: { lat: job.dropoff_lat, lng: job.dropoff_lng }, pickup: { lat: job.pickup_lat, lng: job.pickup_lng },
      pin: ['assigned', 'at_pickup', 'picked_up', 'in_transit'].includes(job.status) ? job.delivery_pin : null,
      proof: view === 'staff' ? job.proof : job.status === 'delivered' ? { delivered_at: job.delivered_at } : null,
    } : null;
    const reviewed = new Set(reviews.map((r) => `${r.subject_type}:${r.subject_id}`));
    out.push({
      id: s.id, number: s.number, status: s.status, statusLabel: SUBORDER_LABELS[s.status], fulfillment: s.fulfillment_type,
      vendor: { id: s.vendor_id, name: s.vendor_name, slug: s.vendor_slug, seller_type: s.seller_type, logo_url: s.logo_url, address: [s.v_line1, s.v_city].filter(Boolean).join(', '), lat: s.v_lat, lng: s.v_lng },
      requestedFor: s.requested_for, promisedAt: s.promised_at, estimatedReadyAt: s.estimated_ready_at, prepMinutes: s.prep_minutes,
      pickupCode: s.fulfillment_type === 'pickup' && !['completed', 'cancelled'].includes(s.status) ? s.pickup_code : null,
      items: items.map((i) => ({ ...i, unit_price: num(i.unit_price), line_subtotal: num(i.line_subtotal), discount_vendor: num(i.discount_vendor), discount_platform: num(i.discount_platform), tax_amount: num(i.tax_amount) })),
      totals: { items: num(s.items_subtotal), discount: num(s.vendor_discount) + num(s.platform_discount), tax: num(s.tax_total), delivery: num(s.delivery_fee) - num(s.delivery_subsidy_vendor) - num(s.delivery_subsidy_platform), service: num(s.service_fee), tip: num(s.tip), total: num(s.customer_total), refunded: num(s.refunded_amount) },
      timeline: timeline(s, hist, job), delivery, cancelReason: s.cancel_reason, dispute,
      reviewed: [...reviewed], cancellable: ['pending_payment', 'confirmed'].includes(s.status),
      canReview: ['delivered', 'completed', 'partially_refunded'].includes(s.status), canDispute: ['delivered', 'completed', 'partially_refunded'].includes(s.status) && !dispute,
      driverId: view === 'staff' ? job?.driver_id ?? null : undefined, jobId: view === 'staff' ? job?.id ?? null : undefined,
      financials: view === 'staff' ? { commission: num(s.commission_amount), fixed_fee: num(s.fixed_fee_amount), vendor_net: num(s.vendor_net), commission_rate: num(s.commission_rate), subsidy_vendor: num(s.delivery_subsidy_vendor), subsidy_platform: num(s.delivery_subsidy_platform), platform_discount: num(s.platform_discount), vendor_discount: num(s.vendor_discount) } : undefined,
    });
  }
  const [payment, refunds] = await Promise.all([
    one<any>(`SELECT status, card_brand, card_last4, provider, amount, refunded_amount, failure_code FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [o.id], db),
    query<any>('SELECT id, suborder_id, amount, reason, bearer, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at', [o.id], db),
  ]);
  const base = {
    id: o.id, number: o.number, status: o.status, payment_status: o.payment_status, placed_at: o.placed_at, address: o.delivery_address, note: o.customer_note, coupon_codes: o.coupon_codes,
    totals: { subtotal: num(o.subtotal), discount: num(o.vendor_discount_total) + num(o.platform_discount_total), tax: num(o.tax_total), delivery: num(o.delivery_fee_total) - num(o.delivery_subsidy_total), service: num(o.service_fee_total), tip: num(o.tip_total), total: num(o.total), credit_applied: num(o.credit_applied), charged: num(o.amount_charged) },
    suborders: out, payment: payment ? { status: payment.status, card: payment.card_brand ? `${payment.card_brand} ending ${payment.card_last4}` : null, refunded: num(payment.refunded_amount), failure_code: view === 'staff' ? payment.failure_code : undefined, provider: view === 'staff' ? payment.provider : undefined } : null,
    refunds: refunds.map((r) => ({ ...r, amount: num(r.amount) })), payment_deadline: o.payment_deadline,
  };
  if (view === 'staff') {
    const notes = await query<any>(`SELECT al.created_at, al.action, al.changes, u.full_name AS actor FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.entity_type IN ('order','suborder') AND al.entity_id = ANY($1::text[]) ORDER BY al.created_at DESC LIMIT 50`, [[o.id, ...subs.map((s) => s.id)]], db);
    const customer = await one<any>('SELECT id, full_name, email, phone FROM users WHERE id = $1', [o.user_id], db);
    return { ...base, customer, audit: notes, internal_notes: notes.filter((n) => n.action === 'order.note') };
  }
  return base;
}

export async function staffOrder(orderId: string, db: Db = pool) {
  const o = await one<any>('SELECT * FROM orders WHERE id = $1', [orderId], db);
  if (!o) throw notFound('That order');
  return assemble(o, 'staff', db);
}

/** Vendor sees only its own suborder, with customer details limited to what fulfilment needs. */
export async function vendorSuborder(a: AuthCtx, vendorId: string, suborderId: string, db: Db = pool) {
  const s = await one<any>(`SELECT s.*, o.number AS order_number, o.contact_name, o.customer_note, o.delivery_address, o.placed_at FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND s.vendor_id = $2`, [suborderId, vendorId], db);
  if (!s) throw notFound('That order');
  if (!vendorAccess(a, vendorId, 'orders')) throw forbidden();
  const [items, job] = await Promise.all([
    query<any>('SELECT id, name, variant_name, sku, quantity, unit_price, line_subtotal, discount_vendor, note FROM order_items WHERE suborder_id = $1 ORDER BY name', [suborderId], db),
    one<any>(`SELECT j.status, u.full_name AS driver_name, (SELECT vehicle_type FROM vehicles v WHERE v.driver_id = j.driver_id AND v.is_active LIMIT 1) AS vehicle FROM delivery_jobs j LEFT JOIN users u ON u.id = j.driver_id WHERE j.suborder_id = $1`, [suborderId], db),
  ]);
  const addr = s.delivery_address;
  return {
    id: s.id, number: s.number, order_number: s.order_number, status: s.status, fulfillment: s.fulfillment_type, placed_at: s.placed_at, requested_for: s.requested_for, prep_minutes: s.prep_minutes, estimated_ready_at: s.estimated_ready_at,
    customer: { first_name: String(s.contact_name ?? '').split(' ')[0], note: s.customer_note, area: addr ? `${addr.city ?? ''} ${String(addr.postal_code ?? '').slice(0, 3)}`.trim() : null },
    items: items.map((i) => ({ ...i, unit_price: num(i.unit_price), line_subtotal: num(i.line_subtotal) })),
    totals: { items: num(s.items_subtotal), discount: num(s.vendor_discount), commission: num(s.commission_amount) + num(s.fixed_fee_amount), net: num(s.vendor_net) },
    pickup_code_required: s.fulfillment_type === 'pickup', driver: job?.driver_name ? { first_name: String(job.driver_name).split(' ')[0], vehicle: job.vehicle, status: job.status } : null, portions: s.portions, cancel_reason: s.cancel_reason,
  };
}
