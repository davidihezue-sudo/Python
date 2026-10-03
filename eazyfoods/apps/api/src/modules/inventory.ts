// Inventory: reservation, commit, release and audited manual adjustments. The database CHECK
// constraints (reserved <= on_hand, no negatives) make overselling impossible even under races.
import type pg from 'pg';
import { query, one, advisoryLock, pool, type Db } from '../db.js';
import { AppError, badRequest, conflict } from '../errors.js';
import { publish } from '../lib/events.js';
import { notifyVendor } from '../lib/notifications.js';

type C = pg.PoolClient;
export interface StockItem { variantId: string; qty: number }

async function move(c: Db, p: { variantId: string; vendorId: string; kind: string; dOnHand: number; dReserved: number; onHand: number; reserved: number; reason?: string; refType?: string; refId?: string; actor?: string | null }) {
  await query(
    `INSERT INTO inventory_movements(variant_id, vendor_id, kind, delta_on_hand, delta_reserved, on_hand_after, reserved_after, reason, ref_type, ref_id, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [p.variantId, p.vendorId, p.kind, p.dOnHand, p.dReserved, p.onHand, p.reserved, p.reason ?? null, p.refType ?? null, p.refId ?? null, p.actor ?? null], c);
}

/** Reserve stock for an order. Throws INSUFFICIENT_STOCK for the first variant that can not be covered. */
export async function reserve(c: C, items: StockItem[], orderId: string, actor: string | null = null) {
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId)); // consistent lock order avoids deadlocks
  for (const it of sorted) {
    const meta = await one<any>(
      `SELECT p.name, p.tracks_inventory, p.vendor_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [it.variantId], c);
    if (!meta) throw badRequest('PRODUCT_UNAVAILABLE', 'One of the items is no longer available.');
    if (!meta.tracks_inventory) continue;
    const row = await one<any>(
      `UPDATE inventory SET reserved = reserved + $2, updated_at = now() WHERE variant_id = $1 AND on_hand - reserved >= $2 RETURNING on_hand, reserved, vendor_id`, [it.variantId, it.qty], c);
    if (!row) throw conflict('INSUFFICIENT_STOCK', `${meta.name} just sold out or does not have enough stock. Please update your cart.`, { variantId: it.variantId });
    await move(c, { variantId: it.variantId, vendorId: row.vendor_id, kind: 'reserve', dOnHand: 0, dReserved: it.qty, onHand: row.on_hand, reserved: row.reserved, refType: 'order', refId: orderId, actor });
  }
}

/** Net quantity still reserved for an order per variant, derived from the movement log. */
async function openReservations(c: Db, orderId: string, onlyVariants?: string[]) {
  return query<{ variant_id: string; vendor_id: string; qty: number }>(
    `SELECT variant_id, vendor_id, sum(delta_reserved)::int AS qty FROM inventory_movements
      WHERE ref_type = 'order' AND ref_id = $1 ${onlyVariants ? 'AND variant_id = ANY($2::uuid[])' : ''}
      GROUP BY variant_id, vendor_id HAVING sum(delta_reserved) > 0`, onlyVariants ? [orderId, onlyVariants] : [orderId], c);
}

/** Release whatever is still reserved for an order (cancellation, payment failure, expiry). */
export async function releaseOrder(c: C, orderId: string, actor: string | null = null, onlyVariants?: string[]) {
  for (const r of await openReservations(c, orderId, onlyVariants)) {
    const row = await one<any>(`UPDATE inventory SET reserved = reserved - $2, updated_at = now() WHERE variant_id = $1 RETURNING on_hand, reserved`, [r.variant_id, r.qty], c);
    if (row) await move(c, { variantId: r.variant_id, vendorId: r.vendor_id, kind: 'release', dOnHand: 0, dReserved: -r.qty, onHand: row.on_hand, reserved: row.reserved, refType: 'order', refId: orderId, actor });
  }
}

/** Convert reservations into real stock deductions. Returns affected variant ids for low stock alerts. */
export async function commitOrder(c: C, orderId: string, onlyVariants?: string[], actor: string | null = null) {
  const touched: { variantId: string; vendorId: string }[] = [];
  for (const r of await openReservations(c, orderId, onlyVariants)) {
    const row = await one<any>(
      `UPDATE inventory SET on_hand = on_hand - $2, reserved = reserved - $2, updated_at = now() WHERE variant_id = $1 RETURNING on_hand, reserved`, [r.variant_id, r.qty], c);
    if (row) {
      await move(c, { variantId: r.variant_id, vendorId: r.vendor_id, kind: 'commit', dOnHand: -r.qty, dReserved: -r.qty, onHand: row.on_hand, reserved: row.reserved, refType: 'order', refId: orderId, actor });
      touched.push({ variantId: r.variant_id, vendorId: r.vendor_id });
    }
  }
  return touched;
}

/** Return stock after a refund where goods are resellable. */
export async function returnStock(c: C, variantId: string, qty: number, orderId: string, actor: string | null) {
  const row = await one<any>(`UPDATE inventory SET on_hand = on_hand + $2, updated_at = now() WHERE variant_id = $1 RETURNING on_hand, reserved, vendor_id`, [variantId, qty], c);
  if (row) await move(c, { variantId, vendorId: row.vendor_id, kind: 'return', dOnHand: qty, dReserved: 0, onHand: row.on_hand, reserved: row.reserved, refType: 'order', refId: orderId, actor, reason: 'Returned to stock' });
}

export type AdjustKind = 'receive' | 'adjust_add' | 'adjust_remove' | 'damaged' | 'expired' | 'correction';
export async function adjust(c: C, p: { variantId: string; vendorId: string; kind: AdjustKind; qty: number; reason?: string; actor: string | null; batchCode?: string; expiryDate?: string | null; supplier?: string; newOnHand?: number }) {
  const cur = await one<any>('SELECT * FROM inventory WHERE variant_id = $1 AND vendor_id = $2 FOR UPDATE', [p.variantId, p.vendorId], c);
  if (!cur) throw new AppError('NOT_FOUND', 404, 'That product could not be found in your inventory.');
  let delta: number;
  if (p.kind === 'correction') {
    if (p.newOnHand == null || p.newOnHand < 0) throw badRequest('VALIDATION', 'Enter the counted quantity.');
    delta = p.newOnHand - cur.on_hand;
  } else {
    if (!Number.isInteger(p.qty) || p.qty <= 0) throw badRequest('VALIDATION', 'Enter a quantity greater than zero.');
    delta = ['receive', 'adjust_add'].includes(p.kind) ? p.qty : -p.qty;
  }
  if (cur.on_hand + delta < cur.reserved) {
    throw conflict('RESERVED_STOCK', `${cur.reserved} units are reserved for open orders, so on hand can not drop below that.`);
  }
  const damaged = p.kind === 'damaged' ? cur.damaged + p.qty : cur.damaged;
  const expired = p.kind === 'expired' ? cur.expired + p.qty : cur.expired;
  const row = await one<any>(
    `UPDATE inventory SET on_hand = on_hand + $2, damaged = $3, expired = $4, supplier = coalesce($5, supplier), updated_at = now() WHERE variant_id = $1 RETURNING on_hand, reserved, reorder_threshold`,
    [p.variantId, delta, damaged, expired, p.supplier ?? null], c);
  await move(c, { variantId: p.variantId, vendorId: p.vendorId, kind: p.kind, dOnHand: delta, dReserved: 0, onHand: row.on_hand, reserved: row.reserved, reason: p.reason, refType: 'manual', actor: p.actor });
  if (p.kind === 'receive' && p.batchCode) {
    await query(`INSERT INTO inventory_batches(variant_id, batch_code, quantity, expiry_date) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (variant_id, batch_code) DO UPDATE SET quantity = inventory_batches.quantity + EXCLUDED.quantity`, [p.variantId, p.batchCode, p.qty, p.expiryDate ?? null], c);
  }
  await lowStockCheck(c, p.vendorId, p.variantId);
  return { onHand: row.on_hand, reserved: row.reserved, available: row.on_hand - row.reserved };
}

export async function lowStockCheck(c: Db, vendorId: string, variantId: string) {
  const r = await one<any>(
    `SELECT i.on_hand, i.reserved, i.reorder_threshold, p.name, v.name AS vname FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
      WHERE i.variant_id = $1`, [variantId], c);
  if (r && r.on_hand - r.reserved <= r.reorder_threshold) {
    publish(`vendor:${vendorId}`, 'low_inventory', { variantId });
    await notifyVendor(vendorId, { kind: 'low_inventory', title: 'Low inventory', body: `${r.name} (${r.vname}) has ${Math.max(0, r.on_hand - r.reserved)} available, at or below your reorder level of ${r.reorder_threshold}.`, data: { variantId } }, c);
  }
}

/** Barcode or SKU lookup scoped to a vendor, with current stock and price. */
export async function lookupCode(vendorId: string, code: string, db: Db = pool) {
  return query<any>(
    `SELECT v.id AS variant_id, v.sku, v.barcode, v.name AS variant_name, v.price, v.sale_price, p.id AS product_id, p.name AS product_name,
            coalesce(i.on_hand,0) AS on_hand, coalesce(i.reserved,0) AS reserved, coalesce(i.on_hand,0) - coalesce(i.reserved,0) AS available,
            coalesce(i.reorder_threshold,0) AS reorder_threshold, coalesce(i.damaged,0) AS damaged, coalesce(i.expired,0) AS expired, i.supplier
       FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN inventory i ON i.variant_id = v.id
      WHERE p.vendor_id = $1 AND p.deleted_at IS NULL AND (v.barcode = $2 OR upper(v.sku) = upper($2))`, [vendorId, code.trim()], db);
}

/** Deduct recipe ingredients for prepared items when the vendor opted in per recipe. */
export async function deductRecipeIngredients(c: C, orderId: string) {
  const items = await query<any>(
    `SELECT oi.product_id, oi.quantity, oi.portions, oi.vendor_id FROM order_items oi WHERE oi.order_id = $1 AND oi.product_type IN ('prepared','chef_meal')`, [orderId], c);
  for (const it of items) {
    const recipe = await one<any>('SELECT * FROM recipes WHERE product_id = $1 AND deduct_ingredients', [it.product_id], c);
    if (!recipe) continue;
    const servings = it.portions || it.quantity;
    const factor = servings / Number(recipe.yield_servings);
    for (const ri of await query<any>('SELECT ingredient_id, quantity FROM recipe_ingredients WHERE recipe_id = $1', [recipe.id], c)) {
      const used = Number(ri.quantity) * factor;
      const ing = await one<any>('UPDATE ingredients SET stock_qty = GREATEST(stock_qty - $2, 0) WHERE id = $1 RETURNING name, stock_qty, reorder_threshold, vendor_id', [ri.ingredient_id, used], c);
      if (ing && Number(ing.stock_qty) <= Number(ing.reorder_threshold)) {
        await notifyVendor(ing.vendor_id, { kind: 'ingredient_shortage', title: 'Ingredient running low', body: `${ing.name} is at ${Number(ing.stock_qty).toFixed(1)}, at or below your reorder level.`, data: { ingredientId: ri.ingredient_id } }, c);
      }
    }
  }
}

// ---------- Chef capacity ----------
export interface CapacityRequest { vendorId: string; portions: number; byProduct: Map<string, number>; when: Date }

/** Returns a customer friendly problem string, or null when the order fits. With a tx client it also serialises concurrent checkouts. */
export async function capacityProblem(db: Db, req: CapacityRequest, lock = false): Promise<string | null> {
  const chef = await one<any>(
    `SELECT c.*, v.timezone, v.trading_name FROM chefs c JOIN vendors v ON v.id = c.vendor_id WHERE c.vendor_id = $1`, [req.vendorId], db);
  const productCaps = await query<any>(`SELECT id, name, daily_capacity FROM products WHERE id = ANY($1::uuid[]) AND daily_capacity IS NOT NULL`, [[...req.byProduct.keys()]], db);
  if (!chef && !productCaps.length) return null;
  const tz = chef?.timezone ?? 'America/Toronto';
  const day = (await one<{ d: string }>(`SELECT to_char(($1::timestamptz AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d`, [req.when, tz], db))!.d;
  if (lock) await advisoryLock(db as C, `capacity:${req.vendorId}:${day}`);
  if (chef) {
    if (!chef.portions_accepting) return `${chef.display_name} is not taking new orders right now.`;
    const wd = (await one<{ w: number }>(`SELECT extract(dow FROM ($1::timestamptz AT TIME ZONE $2))::int AS w`, [req.when, tz], db))!.w;
    if (!chef.operating_days.includes(wd)) return `${chef.display_name} does not cook on that day. Please choose another day.`;
    const black = await one(`SELECT reason FROM capacity_blackouts WHERE vendor_id = $1 AND starts_at <= $2 AND ends_at > $2`, [req.vendorId, req.when], db);
    if (black) return `${chef.display_name} is unavailable at that time.`;
    const used = await one<{ day_used: number; hour_used: number }>(
      `SELECT coalesce(sum(s.portions) FILTER (WHERE ((coalesce(s.requested_for, s.created_at)) AT TIME ZONE $2)::date = $3::date), 0)::int AS day_used,
              coalesce(sum(s.portions) FILTER (WHERE date_trunc('hour', coalesce(s.requested_for, s.created_at)) = date_trunc('hour', $4::timestamptz)), 0)::int AS hour_used
         FROM suborders s WHERE s.vendor_id = $1 AND s.status NOT IN ('cancelled')`, [req.vendorId, tz, day, req.when], db);
    if (chef.daily_capacity != null && used!.day_used + req.portions > chef.daily_capacity) {
      const left = Math.max(0, chef.daily_capacity - used!.day_used);
      return left > 0 ? `${chef.display_name} can only take ${left} more portion${left === 1 ? '' : 's'} for that day.` : `${chef.display_name} is fully booked for that day.`;
    }
    if (chef.hourly_capacity != null && used!.hour_used + req.portions > chef.hourly_capacity) return `${chef.display_name} is fully booked for that hour. Try a different time.`;
  }
  for (const pc of productCaps) {
    const qty = req.byProduct.get(pc.id)!;
    const sold = await one<{ n: number }>(
      `SELECT coalesce(sum(oi.quantity),0)::int AS n FROM order_items oi JOIN suborders s ON s.id = oi.suborder_id
        WHERE oi.product_id = $1 AND s.status <> 'cancelled' AND ((coalesce(s.requested_for, s.created_at)) AT TIME ZONE $2)::date = $3::date`, [pc.id, tz, day], db);
    if (sold!.n + qty > pc.daily_capacity) {
      const left = Math.max(0, pc.daily_capacity - sold!.n);
      return left > 0 ? `Only ${left} ${pc.name} left for that day.` : `${pc.name} is sold out for that day.`;
    }
  }
  return null;
}

export async function capacityRemaining(vendorId: string, date: Date, db: Db = pool) {
  const chef = await one<any>('SELECT c.*, v.timezone FROM chefs c JOIN vendors v ON v.id = c.vendor_id WHERE c.vendor_id = $1', [vendorId], db);
  if (!chef) return null;
  const used = await one<{ n: number }>(
    `SELECT coalesce(sum(portions),0)::int AS n FROM suborders WHERE vendor_id = $1 AND status <> 'cancelled' AND ((coalesce(requested_for, created_at)) AT TIME ZONE $2)::date = ($3::timestamptz AT TIME ZONE $2)::date`, [vendorId, chef.timezone, date], db);
  return { daily_capacity: chef.daily_capacity, used: used!.n, remaining: chef.daily_capacity == null ? null : Math.max(0, chef.daily_capacity - used!.n) };
}
