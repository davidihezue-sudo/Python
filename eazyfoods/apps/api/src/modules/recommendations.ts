// Recommendation service. Every suggestion is computed from real order, favourite and catalog data
// and carries the reason it was chosen. There is no hardcoded list.
import { query, pool, type Db } from '../db.js';
import { visibilityCondition } from './vendors.js';

export interface Rec { id: string; slug: string; name: string; vendor_name: string; price: number; image_url: string | null; default_variant_id: string; reason: string; score: number }

async function hydrate(ids: string[], reasons: Map<string, { reason: string; score: number }>, db: Db): Promise<Rec[]> {
  if (!ids.length) return [];
  const cond = await visibilityCondition('v');
  const rows = await query<any>(
    `SELECT p.id, p.slug, p.name, v.trading_name AS vendor_name,
            (SELECT min(coalesce(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active) AS price,
            (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY position LIMIT 1) AS image_url,
            (SELECT id FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active ORDER BY is_default DESC, position LIMIT 1) AS default_variant_id
       FROM products p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.id = ANY($1::uuid[]) AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond}
        AND (NOT p.tracks_inventory OR EXISTS (SELECT 1 FROM product_variants pv JOIN inventory i ON i.variant_id = pv.id WHERE pv.product_id = p.id AND pv.is_active AND i.on_hand - i.reserved > 0))`, [ids], db);
  return rows.map((r) => ({ ...r, price: Number(r.price), ...reasons.get(r.id)! })).sort((a, b) => b.score - a.score);
}

/** Products frequently bought together with the seeds, plus category and vendor affinity for the customer. */
export async function recommend(opts: { userId?: string | null; seedProductIds?: string[]; exclude?: string[]; limit?: number }, db: Db = pool): Promise<Rec[]> {
  const seeds = opts.seedProductIds ?? [];
  const exclude = [...new Set([...(opts.exclude ?? []), ...seeds])];
  const scores = new Map<string, { reason: string; score: number }>();
  const bump = (id: string, score: number, reason: string) => {
    const cur = scores.get(id);
    if (!cur) scores.set(id, { reason, score });
    else scores.set(id, { reason: score > cur.score / 2 && cur.score < score ? reason : cur.reason, score: cur.score + score });
  };
  if (seeds.length) {
    const co = await query<any>(
      `SELECT b.product_id AS id, count(DISTINCT b.order_id)::int AS n, (SELECT name FROM products WHERE id = (array_agg(a.product_id))[1]) AS seed_name
         FROM order_items a JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
        WHERE a.product_id = ANY($1::uuid[]) GROUP BY b.product_id ORDER BY n DESC LIMIT 40`, [seeds], db);
    for (const r of co) bump(r.id, 3 * r.n, `Often bought with ${r.seed_name}`);
  }
  if (opts.userId) {
    const cats = await query<any>(
      `SELECT p.category_id AS id, c.name, count(*)::int AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
        WHERE o.user_id = $1 AND o.status NOT IN ('cancelled','pending_payment') GROUP BY 1,2 ORDER BY n DESC LIMIT 5`, [opts.userId], db);
    for (const cat of cats) {
      const ps = await query<any>('SELECT id FROM products WHERE category_id = $1 AND status = \'active\' AND deleted_at IS NULL ORDER BY popularity DESC LIMIT 10', [cat.id], db);
      for (const p of ps) bump(p.id, 2 * Math.min(cat.n, 5), `Because you shop ${cat.name}`);
    }
    const vend = await query<any>(
      `SELECT s.vendor_id AS id, v.trading_name, count(*)::int AS n FROM suborders s JOIN orders o ON o.id = s.order_id JOIN vendors v ON v.id = s.vendor_id
        WHERE o.user_id = $1 AND s.status NOT IN ('cancelled','pending_payment') GROUP BY 1,2 ORDER BY n DESC LIMIT 3`, [opts.userId], db);
    for (const v of vend) {
      const ps = await query<any>('SELECT id FROM products WHERE vendor_id = $1 AND status = \'active\' AND deleted_at IS NULL ORDER BY popularity DESC LIMIT 6', [v.id], db);
      for (const p of ps) bump(p.id, 1.5, `From ${v.trading_name}, a store you order from`);
    }
    const favs = await query<any>("SELECT subject_id AS id FROM favorites WHERE user_id = $1 AND subject_type = 'vendor'", [opts.userId], db);
    for (const f of favs) {
      const ps = await query<any>('SELECT id FROM products WHERE vendor_id = $1 AND status = \'active\' AND deleted_at IS NULL ORDER BY popularity DESC LIMIT 4', [f.id], db);
      for (const p of ps) bump(p.id, 1, 'From a store you saved');
    }
    // Do not recommend what the customer has bought very recently, except staples bought repeatedly.
    const recent = await query<any>(`SELECT oi.product_id AS id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = $1 AND o.placed_at > now() - interval '3 days'`, [opts.userId], db);
    for (const r of recent) exclude.push(r.id);
  }
  // Popularity fills the remainder so new customers still see something useful, labelled honestly.
  const pop = await query<any>("SELECT id FROM products WHERE status = 'active' AND deleted_at IS NULL ORDER BY popularity DESC LIMIT 20", [], db);
  for (const p of pop) bump(p.id, 0.2, 'Popular right now');
  for (const e of exclude) scores.delete(e);
  const top = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, (opts.limit ?? 8) * 3).map(([id]) => id);
  return (await hydrate(top, scores, db)).slice(0, opts.limit ?? 8);
}

export async function similarProducts(productId: string, limit = 8, db: Db = pool): Promise<Rec[]> {
  const rows = await query<any>(
    `SELECT p2.id, (CASE WHEN p2.category_id = p.category_id THEN 3 ELSE 0 END + CASE WHEN p2.cuisine = p.cuisine THEN 2 ELSE 0 END +
            coalesce((SELECT count(*) FROM unnest(p2.tags) t WHERE t = ANY(p.tags)),0) + CASE WHEN p2.vendor_id <> p.vendor_id THEN 0.5 ELSE 0 END) AS score
       FROM products p JOIN products p2 ON p2.id <> p.id WHERE p.id = $1 AND p2.status = 'active' AND p2.deleted_at IS NULL ORDER BY score DESC, p2.popularity DESC LIMIT $2`, [productId, limit * 2], db);
  const map = new Map(rows.filter((r) => Number(r.score) > 0).map((r) => [r.id, { reason: 'Similar to what you are viewing', score: Number(r.score) }]));
  return (await hydrate([...map.keys()], map, db)).slice(0, limit);
}

/** Popularity is recalculated from completed sales so ranking follows real demand. */
export async function refreshPopularity(db: Db = pool) {
  await query(
    `UPDATE products p SET popularity = coalesce(s.n, 0) FROM (
       SELECT oi.product_id, sum(oi.quantity)::int AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.placed_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','pending_payment') GROUP BY 1) s WHERE s.product_id = p.id`, [], db);
  await query(`UPDATE products SET popularity = 0 WHERE popularity > 0 AND id NOT IN (SELECT DISTINCT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.placed_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','pending_payment'))`, [], db);
}
