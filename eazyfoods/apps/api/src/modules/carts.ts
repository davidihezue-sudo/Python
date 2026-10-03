// Server side carts for guests and signed in customers. One unified cart, split into vendor suborders at checkout.
import { query, one, tx, type Db, pool } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { randomToken } from '../lib/auth.js';
import { getSetting } from '../lib/settings.js';
import { visibilityCondition } from './vendors.js';
import { quoteForUser } from './orders/checkout.js';
import { trackEvent } from './analytics.js';

export async function findCart(userId: string | null, anonToken: string | null, db: Db = pool) {
  if (userId) return one<any>("SELECT * FROM carts WHERE user_id = $1 AND status = 'active'", [userId], db);
  if (anonToken) return one<any>("SELECT * FROM carts WHERE anon_token = $1 AND status = 'active'", [anonToken], db);
  return null;
}
export async function getOrCreateCart(userId: string | null, anonToken: string | null) {
  const existing = await findCart(userId, anonToken);
  if (existing) return { cart: existing, anonToken: existing.anon_token as string | null };
  if (userId) {
    const c = await one<any>("INSERT INTO carts(user_id) VALUES ($1) ON CONFLICT (user_id) WHERE status = 'active' AND user_id IS NOT NULL DO UPDATE SET last_activity_at = now() RETURNING *", [userId]);
    return { cart: c, anonToken: null };
  }
  const token = randomToken(18);
  const c = await one<any>('INSERT INTO carts(anon_token) VALUES ($1) RETURNING *', [token]);
  return { cart: c, anonToken: token };
}

export async function addItem(cartId: string, variantId: string, qty: number, note?: string) {
  if (!Number.isInteger(qty) || qty < 1) throw badRequest('VALIDATION', 'Choose a quantity of at least 1.');
  const cond = await visibilityCondition('v');
  const v = await one<any>(
    `SELECT pv.id, p.min_qty, p.max_qty FROM product_variants pv JOIN products p ON p.id = pv.product_id JOIN vendors v ON v.id = p.vendor_id
      WHERE pv.id = $1 AND pv.is_active AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond}`, [variantId]);
  if (!v) throw notFound('That product');
  const max = (await getSetting('orders')).max_line_quantity;
  const row = await one<any>(
    `INSERT INTO cart_items(cart_id, variant_id, quantity, note) VALUES ($1,$2,$3,$4)
     ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, $5), note = coalesce(EXCLUDED.note, cart_items.note) RETURNING *`,
    [cartId, variantId, Math.max(qty, v.min_qty), note ?? null, Math.min(max, v.max_qty ?? max)]);
  await query('UPDATE carts SET last_activity_at = now(), reminders_sent = 0 WHERE id = $1', [cartId]);
  trackEvent('add_to_cart', { entityType: 'variant', entityId: variantId }).catch(() => {});
  return row;
}
export async function setQuantity(cartId: string, variantId: string, qty: number) {
  if (qty <= 0) await query('DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cartId, variantId]);
  else {
    const max = (await getSetting('orders')).max_line_quantity;
    if (qty > max) throw badRequest('ABOVE_MAX_QTY', `You can order up to ${max} of an item.`);
    const r = await query('UPDATE cart_items SET quantity = $3 WHERE cart_id = $1 AND variant_id = $2 RETURNING id', [cartId, variantId, qty]);
    if (!r.length) throw notFound('That cart item');
  }
  await query('UPDATE carts SET last_activity_at = now() WHERE id = $1', [cartId]);
}
export async function clearCart(cartId: string) {
  await query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
  await query('UPDATE carts SET coupon_codes = \'{}\', tip = 0, last_activity_at = now() WHERE id = $1', [cartId]);
}

export async function updateCartOptions(cartId: string, o: { addressId?: string | null; couponCodes?: string[]; tip?: number; fulfillment?: Record<string, any>; useCredit?: boolean }) {
  const sets: string[] = ['last_activity_at = now()']; const vals: any[] = [cartId];
  const push = (col: string, v: any) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (o.addressId !== undefined) push('address_id', o.addressId);
  if (o.couponCodes) push('coupon_codes', o.couponCodes.map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 5));
  if (o.tip !== undefined) push('tip', Math.max(0, o.tip));
  if (o.fulfillment) push('fulfillment', JSON.stringify(o.fulfillment));
  if (o.useCredit !== undefined) push('use_credit', o.useCredit);
  return one<any>(`UPDATE carts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
}

/** Merge a guest cart into the customer's cart after sign in. */
export async function mergeAnonCart(userId: string, anonToken: string) {
  await tx(async (c) => {
    const anon = await one<any>("SELECT * FROM carts WHERE anon_token = $1 AND status = 'active' FOR UPDATE", [anonToken], c);
    if (!anon) return;
    let mine = await one<any>("SELECT * FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE", [userId], c);
    if (!mine) {
      await query("UPDATE carts SET user_id = $2, anon_token = NULL WHERE id = $1", [anon.id, userId], c);
      return;
    }
    for (const it of await query<any>('SELECT * FROM cart_items WHERE cart_id = $1', [anon.id], c)) {
      await query(`INSERT INTO cart_items(cart_id, variant_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`, [mine.id, it.variant_id, it.quantity], c);
    }
    await query("UPDATE carts SET status = 'merged', anon_token = NULL WHERE id = $1", [anon.id], c);
  });
}

/** The full cart view: items plus a fresh server side quote with warnings. */
export async function cartView(userId: string | null, cart: any) {
  const items = await query<any>('SELECT variant_id, quantity, note FROM cart_items WHERE cart_id = $1 ORDER BY added_at', [cart.id]);
  if (!items.length) return { id: cart.id, empty: true, itemCount: 0, items: [], quote: null, options: opts(cart) };
  const { json } = await quoteForUser(userId, {
    items: items.map((i) => ({ variantId: i.variant_id, qty: i.quantity })),
    addressId: cart.address_id, couponCodes: cart.coupon_codes, tipCents: Math.round(Number(cart.tip) * 100), useCredit: cart.use_credit,
    fulfillment: cart.fulfillment,
  }).catch(async (e) => {
    // A product disappeared: drop unavailable lines so the cart stays usable and tell the customer.
    if (e.code === 'PRODUCT_UNAVAILABLE') {
      const cond = await visibilityCondition('v');
      const bad = await query<any>(`SELECT ci.variant_id FROM cart_items ci LEFT JOIN product_variants pv ON pv.id = ci.variant_id LEFT JOIN products p ON p.id = pv.product_id LEFT JOIN vendors v ON v.id = p.vendor_id
                                     WHERE ci.cart_id = $1 AND NOT (pv.is_active AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond})`, [cart.id]);
      for (const b of bad) await query('DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cart.id, b.variant_id]);
      return cartView(userId, cart).then((r: any) => ({ json: { ...r.quote, removedUnavailable: bad.length } }));
    }
    throw e;
  }) as any;
  return { id: cart.id, empty: false, itemCount: items.reduce((s, i) => s + i.quantity, 0), items, quote: json, options: opts(cart) };
}
const opts = (c: any) => ({ addressId: c.address_id, couponCodes: c.coupon_codes, tip: Number(c.tip), fulfillment: c.fulfillment, useCredit: c.use_credit });
