import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rl } from '../lib/limits.js';
import { parse, id } from '../lib/util.js';
import { query, one } from '../db.js';
import { requireUser } from '../lib/rbac.js';
import { badRequest, notFound } from '../errors.js';
import { getOrCreateCart, findCart, addItem, setQuantity, clearCart, updateCartOptions, cartView } from '../modules/carts.js';
import { quoteForUser, checkout, payOrder } from '../modules/orders/checkout.js';
import { customerCancel } from '../modules/orders/fulfillment.js';
import { customerOrder } from '../modules/orderviews.js';
import { saveAddress, deleteAddress } from '../modules/accounts.js';
import { createReview } from '../modules/reviews.js';
import { loyaltyStatus, redeemPoints, ensureReferralCode } from '../modules/loyalty.js';
import { customerAnalytics } from '../modules/insights.js';
import { byIds } from '../modules/marketing.js';
import { CART_COOKIE } from '../app.js';
import { config } from '../config.js';
import { toCents } from '../money.js';
import { trackEvent } from '../modules/analytics.js';

const fulfillmentSchema = z.record(z.guid(), z.object({ mode: z.enum(['delivery', 'pickup']), scheduledFor: z.string().datetime().nullable().optional() }));
const address = z.object({
  label: z.string().max(30).optional(), recipient_name: z.string().max(120).optional(), phone: z.string().max(30).optional(), line1: z.string().min(3).max(200), line2: z.string().max(100).optional(),
  city: z.string().min(2).max(100), region: z.string().min(2).max(10), postal_code: z.string().min(3).max(12), country: z.string().max(2).optional(), lat: z.number().optional(), lng: z.number().optional(),
  instructions: z.string().max(300).optional(), is_default: z.boolean().optional(),
});

export async function customerRoutes(app: FastifyInstance) {
  // -------- cart --------
  const cartFor = async (req: any, reply: any) => {
    const { cart, anonToken } = await getOrCreateCart(req.auth?.user.id ?? null, req.cookies?.[CART_COOKIE] ?? null);
    if (anonToken && anonToken !== req.cookies?.[CART_COOKIE]) reply.setCookie(CART_COOKIE, anonToken, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: 30 * 86400 });
    return cart;
  };
  app.get('/carts/current', async (req, reply) => {
    const existing = await findCart(req.auth?.user.id ?? null, req.cookies?.[CART_COOKIE] ?? null);
    if (!existing) return { cart: { empty: true, itemCount: 0, items: [], quote: null, options: {} } };
    return { cart: await cartView(req.auth?.user.id ?? null, existing) };
  });
  app.post('/carts/items', async (req, reply) => {
    const b = parse(z.object({ variantId: id, qty: z.coerce.number().int().min(1).max(200).default(1), note: z.string().max(200).optional() }), req.body);
    const cart = await cartFor(req, reply);
    await addItem(cart.id, b.variantId, b.qty, b.note);
    return { cart: await cartView(req.auth?.user.id ?? null, cart) };
  });
  app.patch('/carts/items/:variantId', async (req, reply) => {
    const { variantId } = parse(z.object({ variantId: id }), req.params);
    const b = parse(z.object({ qty: z.coerce.number().int().min(0).max(200) }), req.body);
    const cart = await cartFor(req, reply);
    await setQuantity(cart.id, variantId, b.qty);
    return { cart: await cartView(req.auth?.user.id ?? null, cart) };
  });
  app.delete('/carts/items/:variantId', async (req, reply) => {
    const { variantId } = parse(z.object({ variantId: id }), req.params);
    const cart = await cartFor(req, reply);
    await setQuantity(cart.id, variantId, 0);
    return { cart: await cartView(req.auth?.user.id ?? null, cart) };
  });
  app.delete('/carts/current', async (req, reply) => { const cart = await cartFor(req, reply); await clearCart(cart.id); return { ok: true }; });
  app.patch('/carts/options', async (req, reply) => {
    const b = parse(z.object({ addressId: id.nullable().optional(), couponCodes: z.array(z.string().max(30)).max(5).optional(), tip: z.coerce.number().min(0).max(500).optional(), fulfillment: fulfillmentSchema.optional(), useCredit: z.boolean().optional() }), req.body);
    const cart = await cartFor(req, reply);
    if (b.addressId) {
      const a = requireUser(req.auth);
      if (!(await one('SELECT 1 FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [b.addressId, a.user.id]))) throw notFound('That address');
    }
    const updated = await updateCartOptions(cart.id, b);
    return { cart: await cartView(req.auth?.user.id ?? null, updated) };
  });
  // Stateless price check for an arbitrary list of items (guest address by coordinates).
  app.post('/carts/quote', async (req) => {
    const b = parse(z.object({ items: z.array(z.object({ variantId: id, qty: z.number().int().min(1).max(200) })).min(1).max(100), addressId: id.optional(), address: z.object({ lat: z.number(), lng: z.number(), region: z.string(), postal_code: z.string(), country: z.string().optional() }).optional(), couponCodes: z.array(z.string()).max(5).optional(), tip: z.number().min(0).optional(), fulfillment: fulfillmentSchema.optional(), useCredit: z.boolean().optional() }), req.body);
    const { json } = await quoteForUser(req.auth?.user.id ?? null, { items: b.items, addressId: b.addressId, address: b.address, couponCodes: b.couponCodes, tipCents: toCents(b.tip ?? 0), fulfillment: b.fulfillment, useCredit: b.useCredit });
    return { quote: json };
  });

  // -------- checkout and orders --------
  app.post('/checkout', rl(30), async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({
      idempotencyKey: z.string().min(8).max(100), paymentToken: z.string().max(200).optional(), expectedTotal: z.number().optional(), contact: z.object({ name: z.string().max(120).optional(), phone: z.string().max(30).optional() }).optional(), note: z.string().max(500).optional(),
    }), req.body);
    // A repeated request with the same key returns the original order even after the cart was converted.
    const prior = await one<any>('SELECT id, status, payment_status FROM orders WHERE user_id = $1 AND idempotency_key = $2', [a.user.id, b.idempotencyKey]);
    if (prior) return { orderId: prior.id, reused: true };
    const cart = await findCart(a.user.id, null);
    if (!cart) throw badRequest('EMPTY_CART', 'Your cart is empty.');
    const items = await query<any>('SELECT variant_id, quantity FROM cart_items WHERE cart_id = $1', [cart.id]);
    if (!items.length) throw badRequest('EMPTY_CART', 'Your cart is empty.');
    const out = await checkout(a.user.id, {
      items: items.map((i) => ({ variantId: i.variant_id, qty: i.quantity })), addressId: cart.address_id, couponCodes: cart.coupon_codes, tipCents: toCents(cart.tip), fulfillment: cart.fulfillment, useCredit: cart.use_credit,
      idempotencyKey: b.idempotencyKey, expectedTotal: b.expectedTotal, contact: b.contact, note: b.note, paymentToken: b.paymentToken ?? '', cartId: cart.id,
    }, req.actor);
    reply.status(201);
    return out;
  });
  app.post('/orders/:id/pay', rl(20), async (req) => {
    const a = requireUser(req.auth);
    const { id: orderId } = parse(z.object({ id }), req.params);
    const b = parse(z.object({ paymentToken: z.string().min(3).max(200) }), req.body);
    return payOrder(a.user.id, orderId, b.paymentToken, req.actor);
  });
  app.get('/orders', async (req) => {
    const a = requireUser(req.auth);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(15) }), req.query);
    const rows = await query<any>(
      `SELECT o.id, o.number, o.status, o.total, o.placed_at, o.payment_status,
              (SELECT json_agg(json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'vendor', v.trading_name, 'fulfillment', s.fulfillment_type) ORDER BY s.suffix) FROM suborders s JOIN vendors v ON v.id = s.vendor_id WHERE s.order_id = o.id) AS suborders,
              (SELECT coalesce(sum(quantity),0)::int FROM order_items WHERE order_id = o.id) AS item_count
         FROM orders o WHERE o.user_id = $1 AND o.status <> 'pending_payment' OR (o.user_id = $1 AND o.status = 'pending_payment' AND o.payment_deadline > now())
        ORDER BY o.placed_at DESC LIMIT $2 OFFSET $3`, [a.user.id, q.limit, (q.page - 1) * q.limit]);
    return { orders: rows.map((r) => ({ ...r, total: Number(r.total) })) };
  });
  app.get('/orders/:id', async (req) => {
    const a = requireUser(req.auth);
    return { order: await customerOrder(a.user.id, parse(z.object({ id }), req.params).id) };
  });
  app.post('/orders/:id/cancel', async (req) => {
    const a = requireUser(req.auth);
    const { id: orderId } = parse(z.object({ id }), req.params);
    const b = parse(z.object({ suborderId: id.optional() }), req.body);
    return customerCancel(a.user.id, orderId, b.suborderId ?? null, req.actor);
  });
  app.post('/orders/:id/reorder', async (req, reply) => {
    const a = requireUser(req.auth);
    const { id: orderId } = parse(z.object({ id }), req.params);
    const o = await one('SELECT 1 FROM orders WHERE id = $1 AND user_id = $2', [orderId, a.user.id]);
    if (!o) throw notFound('That order');
    const items = await query<any>(`SELECT oi.variant_id, oi.quantity FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id WHERE oi.order_id = $1 AND v.is_active AND p.status = 'active' AND p.deleted_at IS NULL`, [orderId]);
    const { cart } = await getOrCreateCart(a.user.id, null);
    let added = 0;
    for (const i of items) { try { await addItem(cart.id, i.variant_id, i.quantity); added++; } catch { /* unavailable items are skipped */ } }
    reply.status(201);
    return { added, skipped: items.length - added };
  });

  // -------- addresses --------
  app.get('/customers/me/addresses', async (req) => {
    const a = requireUser(req.auth);
    return { addresses: await query('SELECT * FROM addresses WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at', [a.user.id]) };
  });
  app.post('/customers/me/addresses', async (req, reply) => { const a = requireUser(req.auth); reply.status(201); return { address: await saveAddress(a.user.id, parse(address, req.body)) }; });
  app.put('/customers/me/addresses/:id', async (req) => { const a = requireUser(req.auth); return { address: await saveAddress(a.user.id, parse(address, req.body), parse(z.object({ id }), req.params).id) }; });
  app.delete('/customers/me/addresses/:id', async (req) => { const a = requireUser(req.auth); await deleteAddress(a.user.id, parse(z.object({ id }), req.params).id); return { ok: true }; });

  // -------- favourites, wishlists --------
  app.get('/customers/me/favorites', async (req) => {
    const a = requireUser(req.auth);
    const rows = await query<any>('SELECT subject_type, subject_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC', [a.user.id]);
    const products = await byIds(rows.filter((r) => r.subject_type === 'product').map((r) => r.subject_id));
    const vendors = await query<any>(`SELECT id, slug, trading_name, logo_url, seller_type, city, rating_avg FROM vendors WHERE id = ANY($1::uuid[])`, [rows.filter((r) => r.subject_type !== 'product').map((r) => r.subject_id)]);
    return { products, stores: vendors.filter((v) => v.seller_type !== 'chef'), chefs: vendors.filter((v) => v.seller_type === 'chef'), ids: rows };
  });
  app.put('/customers/me/favorites', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ type: z.enum(['product', 'vendor', 'chef']), id, on: z.boolean() }), req.body);
    if (b.on) await query('INSERT INTO favorites(user_id, subject_type, subject_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a.user.id, b.type, b.id]);
    else await query('DELETE FROM favorites WHERE user_id = $1 AND subject_type = $2 AND subject_id = $3', [a.user.id, b.type, b.id]);
    return { ok: true };
  });
  app.get('/customers/me/wishlists', async (req) => {
    const a = requireUser(req.auth);
    const lists = await query<any>('SELECT id, name FROM wishlists WHERE user_id = $1 ORDER BY created_at', [a.user.id]);
    const out: any[] = [];
    for (const l of lists) out.push({ ...l, items: await byIds((await query<any>('SELECT product_id FROM wishlist_items WHERE wishlist_id = $1 ORDER BY added_at DESC', [l.id])).map((r) => r.product_id)) });
    return { wishlists: out };
  });
  app.post('/customers/me/wishlists', async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
    reply.status(201);
    return { wishlist: await one('INSERT INTO wishlists(user_id, name) VALUES ($1,$2) RETURNING id, name', [a.user.id, b.name]) };
  });
  app.put('/customers/me/wishlists/:id/items', async (req) => {
    const a = requireUser(req.auth);
    const { id: wid } = parse(z.object({ id }), req.params);
    const b = parse(z.object({ productId: id, on: z.boolean() }), req.body);
    if (!(await one('SELECT 1 FROM wishlists WHERE id = $1 AND user_id = $2', [wid, a.user.id]))) throw notFound('That wishlist');
    if (b.on) await query('INSERT INTO wishlist_items(wishlist_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [wid, b.productId]);
    else await query('DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2', [wid, b.productId]);
    return { ok: true };
  });
  app.delete('/customers/me/wishlists/:id', async (req) => { const a = requireUser(req.auth); await query('DELETE FROM wishlists WHERE id = $1 AND user_id = $2', [parse(z.object({ id }), req.params).id, a.user.id]); return { ok: true }; });

  // -------- reviews --------
  app.post('/reviews', async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ suborderId: id, subjectType: z.enum(['product', 'vendor', 'driver', 'order']), subjectId: id.optional(), rating: z.number().int().min(1).max(5), title: z.string().max(120).optional(), body: z.string().max(2000).optional(), photos: z.array(z.string().max(300)).max(4).optional() }), req.body);
    reply.status(201);
    return { review: await createReview(a.user.id, b, req.actor) };
  });
  app.get('/customers/me/reviews', async (req) => {
    const a = requireUser(req.auth);
    return { reviews: await query('SELECT id, subject_type, subject_id, rating, title, body, status, vendor_response, created_at FROM reviews WHERE user_id = $1 ORDER BY created_at DESC', [a.user.id]) };
  });

  // -------- notifications --------
  app.get('/notifications', async (req) => {
    const a = requireUser(req.auth);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), unread: z.coerce.boolean().optional() }), req.query);
    const rows = await query('SELECT id, kind, title, body, data, read_at, created_at FROM notifications WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3', [a.user.id, q.unread ?? null, q.limit]);
    const unread = await one<any>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [a.user.id]);
    return { notifications: rows, unread: unread.n };
  });
  app.post('/notifications/read', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ ids: z.array(id).max(200).optional() }), req.body);
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))', [a.user.id, b.ids ?? null]);
    return { ok: true };
  });
  app.get('/notifications/preferences', async (req) => { const a = requireUser(req.auth); return { preferences: await query('SELECT kind, email, sms, push FROM notification_preferences WHERE user_id = $1', [a.user.id]) }; });
  app.put('/notifications/preferences', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ kind: z.string().max(40), email: z.boolean(), sms: z.boolean(), push: z.boolean() }), req.body);
    await query('INSERT INTO notification_preferences(user_id, kind, email, sms, push) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, kind) DO UPDATE SET email = $3, sms = $4, push = $5', [a.user.id, b.kind, b.email, b.sms, b.push]);
    return { ok: true };
  });
  app.post('/notifications/push-token', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ token: z.string().min(10).max(500), platform: z.string().max(20).optional() }), req.body);
    await query('INSERT INTO push_tokens(user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a.user.id, b.token, b.platform ?? null]);
    return { ok: true };
  });

  // -------- loyalty, credit, referral, account insights --------
  app.get('/customers/me/loyalty', async (req) => {
    const a = requireUser(req.auth);
    const [status, history, credit, code, referrals] = await Promise.all([
      loyaltyStatus(a.user.id),
      query('SELECT points, reason, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [a.user.id]),
      query('SELECT amount, reason, created_at, expires_at FROM customer_credit_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [a.user.id]),
      ensureReferralCode(a.user.id),
      query(`SELECT r.status, r.reward_amount, r.created_at, split_part(u.full_name, ' ', 1) AS first_name FROM referrals r JOIN users u ON u.id = r.referred_id WHERE r.referrer_id = $1 ORDER BY r.created_at DESC`, [a.user.id]),
    ]);
    const cfg = await (await import('../lib/settings.js')).getSetting('loyalty');
    return { status, history, credit, referral: { code, reward: cfg.referral_reward, friend_reward: cfg.referee_reward, min_order: cfg.referral_min_order, referrals } };
  });
  app.post('/customers/me/loyalty/redeem', async (req) => { const a = requireUser(req.auth); return redeemPoints(a.user.id, parse(z.object({ points: z.number().int().min(1) }), req.body).points); });
  app.get('/customers/me/coupons', async (req) => {
    const a = requireUser(req.auth);
    const rows = await query<any>(
      `SELECT id, name, description, code, type, value, min_order, ends_at FROM promotions WHERE status = 'active' AND code IS NOT NULL AND vendor_id IS NULL AND segment_id IS NULL AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
         AND (usage_limit IS NULL OR redemption_count < usage_limit) AND (per_customer_limit IS NULL OR (SELECT count(*) FROM promotion_redemptions r WHERE r.promotion_id = promotions.id AND r.user_id = $1 AND r.status = 'active') < per_customer_limit) ORDER BY ends_at NULLS LAST`, [a.user.id]);
    return { coupons: rows.map((r) => ({ ...r, value: Number(r.value), min_order: Number(r.min_order) })) };
  });
  app.get('/customers/me/insights', async (req) => { const a = requireUser(req.auth); return customerAnalytics(a.user.id); });
  app.get('/customers/me/recently-viewed', async (req) => {
    const a = requireUser(req.auth);
    return { items: await byIds((await query<any>('SELECT product_id FROM recently_viewed WHERE user_id = $1 ORDER BY viewed_at DESC LIMIT 12', [a.user.id])).map((r) => r.product_id)) };
  });
  void trackEvent;
}
