// Public marketplace reads: search, autocomplete, listings, product and storefront detail.
import { z } from 'zod';
import { query, one, pool, type Db } from '../db.js';
import { notFound } from '../errors.js';
import { visibilityCondition } from './vendors.js';
import { haversineKm, roadKm } from '../lib/geo.js';
import { zoneCovers } from '../pricing/delivery.js';
import { getSetting } from '../lib/settings.js';
import { makeIsOpenAt } from '../pricing/service.js';

export const searchParams = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().optional(),            // slug
  vendor: z.string().optional(),              // slug
  cuisine: z.string().optional(),
  country: z.string().optional(),
  brand: z.string().optional(),
  type: z.string().optional(),                // comma list of product types
  dietary: z.string().optional(),             // comma list
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  in_stock: z.coerce.boolean().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  on_sale: z.coerce.boolean().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  max_km: z.coerce.number().min(0).max(200).optional(),
  deliverable: z.coerce.boolean().optional(),   // only vendors that deliver to lat/lng
  max_eta: z.coerce.number().min(0).optional(), // minutes
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating', 'newest', 'popular', 'distance']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type SearchParams = z.infer<typeof searchParams>;

const tokenize = (q: string) => q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 8);

async function synonymGroups(tokens: string[], db: Db) {
  if (!tokens.length) return [];
  const rows = await query<any>('SELECT term, synonyms FROM search_synonyms WHERE term = ANY($1) OR synonyms && $1', [tokens], db);
  return tokens.map((t) => {
    const group = new Set([t]);
    for (const r of rows) if (r.term === t || r.synonyms.includes(t)) { group.add(r.term); r.synonyms.forEach((s: string) => group.add(s)); }
    return [...group].flatMap((g) => g.split(/[^a-z0-9]+/).filter(Boolean));
  });
}

const DIST = (latP: string, lngP: string) => `(2 * 6371 * asin(sqrt(power(sin(radians(v.lat - ${latP}) / 2), 2) + cos(radians(${latP})) * cos(radians(v.lat)) * power(sin(radians(v.lng - ${lngP}) / 2), 2))))`;

/** Vendors that can deliver to a point, using the same zone logic as the quote. */
export async function vendorsDeliveringTo(lat: number, lng: number, db: Db = pool): Promise<Map<string, number>> {
  const del = await getSetting('delivery', db);
  const cond = await visibilityCondition('v');
  const near = await query<any>(
    `SELECT v.id, v.lat, v.lng, v.accepts_delivery FROM vendors v WHERE ${cond} AND v.accepts_delivery AND v.lat IS NOT NULL AND ${DIST('$1', '$2')} <= $3`, [lat, lng, del.max_distance_km * 1.2], db);
  if (!near.length) return new Map();
  const ids = near.map((v) => v.id);
  const [vz, pz] = await Promise.all([
    query<any>("SELECT * FROM delivery_zones WHERE scope = 'vendor' AND vendor_id = ANY($1::uuid[]) AND is_active", [ids], db),
    query<any>("SELECT * FROM delivery_zones WHERE scope = 'platform' AND is_active", [], db),
  ]);
  const out = new Map<string, number>();
  const addr = { lat, lng, region: '', postal_code: '', country: 'CA' };
  // postal prefix zones need the postal code, which the caller may not have; radius and polygon zones work from coordinates.
  for (const v of near) {
    const zones = vz.filter((z) => z.vendor_id === v.id);
    const pool_ = zones.length ? zones : pz;
    const km = roadKm({ lat: v.lat, lng: v.lng }, { lat, lng });
    const ok = pool_.some((z) => zoneCovers(normalize(z), { lat: v.lat, lng: v.lng } as any, addr) && km <= (z.max_distance_km != null ? Number(z.max_distance_km) : del.max_distance_km));
    if (ok) out.set(v.id, km);
  }
  return out;
}
const normalize = (z: any) => ({ ...z, radius_km: z.radius_km != null ? Number(z.radius_km) : null });

export async function searchProducts(p: SearchParams, userId: string | null = null, db: Db = pool) {
  const cond = await visibilityCondition('v');
  const params: any[] = [];
  const add = (v: any) => (params.push(v), `$${params.length}`);
  const where: string[] = [`p.status = 'active'`, 'p.deleted_at IS NULL', cond];
  let rank = '0';
  const tokens = p.q ? tokenize(p.q) : [];
  if (tokens.length) {
    const groups = await synonymGroups(tokens, db);
    const tsq = groups.map((g) => '(' + g.map((w) => `${w}:*`).join(' | ') + ')').join(' & ');
    const qParam = add(tsq);
    const textParam = add(tokens.join(' '));
    const fuzzy = `(word_similarity(${textParam}, f_unaccent(lower(p.name))) > 0.45 OR similarity(f_unaccent(lower(p.name)), ${textParam}) > 0.3 OR f_unaccent(lower(v.trading_name)) % ${textParam})`;
    where.push(`(p.search_tsv @@ to_tsquery('simple', ${qParam}) OR ${fuzzy})`);
    rank = `(ts_rank_cd(p.search_tsv, to_tsquery('simple', ${qParam})) * 2 + greatest(word_similarity(${textParam}, f_unaccent(lower(p.name))), similarity(f_unaccent(lower(p.name)), ${textParam})))`;
  }
  if (p.category) {
    where.push(`p.category_id IN (WITH RECURSIVE t AS (SELECT id FROM categories WHERE slug = ${add(p.category)} UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t)`);
  }
  if (p.vendor) where.push(`v.slug = ${add(p.vendor)}`);
  if (p.cuisine) where.push(`lower(p.cuisine) = lower(${add(p.cuisine)})`);
  if (p.country) where.push(`lower(p.country_of_origin) = lower(${add(p.country)})`);
  if (p.brand) where.push(`p.brand_id IN (SELECT id FROM brands WHERE slug = ${add(p.brand)})`);
  if (p.type) where.push(`p.product_type = ANY(${add(p.type.split(','))})`);
  if (p.dietary) where.push(`p.dietary @> ${add(p.dietary.split(','))}::text[]`);
  if (p.rating) where.push(`p.rating_avg >= ${add(p.rating)}`);
  where.push('EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active)');
  const priceExpr = `(SELECT min(coalesce(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active)`;
  if (p.min_price != null) where.push(`${priceExpr} >= ${add(p.min_price)}`);
  if (p.max_price != null) where.push(`${priceExpr} <= ${add(p.max_price)}`);
  if (p.on_sale) where.push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active AND pv.sale_price IS NOT NULL)`);
  if (p.in_stock) where.push(`(NOT p.tracks_inventory OR EXISTS (SELECT 1 FROM product_variants pv JOIN inventory i ON i.variant_id = pv.id WHERE pv.product_id = p.id AND pv.is_active AND i.on_hand - i.reserved > 0))`);

  let distSelect = 'NULL::float';
  const hasLoc = p.lat != null && p.lng != null;
  let deliverable: Map<string, number> | null = null;
  if (hasLoc) {
    const la = add(p.lat), ln = add(p.lng);
    distSelect = `CASE WHEN v.lat IS NULL THEN NULL ELSE ${DIST(la, ln)} END`;
    if (p.max_km != null) where.push(`v.lat IS NOT NULL AND ${DIST(la, ln)} <= ${add(p.max_km)}`);
    if (p.deliverable) {
      deliverable = await vendorsDeliveringTo(p.lat!, p.lng!, db);
      where.push(`v.id = ANY(${add([...deliverable.keys()])}::uuid[])`);
    }
  }
  const order = {
    relevance: tokens.length ? `${rank} DESC, p.popularity DESC` : 'p.popularity DESC, p.created_at DESC',
    price_asc: `${priceExpr} ASC`, price_desc: `${priceExpr} DESC`, rating: 'p.rating_avg DESC, p.rating_count DESC', newest: 'p.created_at DESC', popular: 'p.popularity DESC',
    distance: hasLoc ? `${distSelect} ASC NULLS LAST` : 'p.popularity DESC',
  }[p.sort];
  const offset = (p.page - 1) * p.limit;
  const base = `FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE ${where.join(' AND ')}`;
  const [rows, total] = await Promise.all([
    query<any>(
      `SELECT p.id, p.slug, p.name, p.short_description, p.product_type, p.cuisine, p.country_of_origin, p.rating_avg, p.rating_count, p.dietary, p.allergens, p.tracks_inventory,
              v.id AS vendor_id, v.slug AS vendor_slug, v.trading_name AS vendor_name, v.seller_type, v.rating_avg AS vendor_rating, ${distSelect} AS distance_km,
              ${priceExpr} AS price,
              (SELECT min(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active AND pv.sale_price IS NOT NULL) AS compare_price,
              (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY position LIMIT 1) AS image_url,
              (SELECT count(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active) AS variant_count,
              (SELECT id FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active ORDER BY is_default DESC, position LIMIT 1) AS default_variant_id,
              (NOT p.tracks_inventory OR EXISTS (SELECT 1 FROM product_variants pv JOIN inventory i ON i.variant_id = pv.id WHERE pv.product_id = p.id AND pv.is_active AND i.on_hand - i.reserved > 0)) AS in_stock
       ${base} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${offset}`, params, db),
    one<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params, db),
  ]);
  // Facets for the filter UI, computed on the same filtered set without pagination.
  return { items: rows.map((r) => ({ ...r, price: Number(r.price), compare_price: r.compare_price != null ? Number(r.compare_price) : null, distance_km: r.distance_km != null ? Math.round(r.distance_km * 10) / 10 : null, rating_avg: Number(r.rating_avg) })), total: total!.n, page: p.page, limit: p.limit, pages: Math.ceil(total!.n / p.limit) };
}

export async function facets(p: SearchParams, db: Db = pool) {
  const cond = await visibilityCondition('v');
  const base = `FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${cond}`;
  const [cuisines, countries, types, vendors, categories] = await Promise.all([
    query<any>(`SELECT p.cuisine AS value, count(*)::int AS n ${base} AND p.cuisine IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 20`, [], db),
    query<any>(`SELECT p.country_of_origin AS value, count(*)::int AS n ${base} AND p.country_of_origin IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 20`, [], db),
    query<any>(`SELECT p.product_type AS value, count(*)::int AS n ${base} GROUP BY 1 ORDER BY n DESC`, [], db),
    query<any>(`SELECT v.slug AS value, v.trading_name AS label, count(*)::int AS n ${base} GROUP BY 1,2 ORDER BY n DESC LIMIT 20`, [], db),
    query<any>(`SELECT c.slug AS value, c.name AS label, count(*)::int AS n FROM categories c JOIN products p ON p.category_id = c.id JOIN vendors v ON v.id = p.vendor_id WHERE p.status='active' AND p.deleted_at IS NULL AND ${cond} AND c.is_active GROUP BY 1,2 ORDER BY n DESC LIMIT 30`, [], db),
  ]);
  return { cuisines, countries, types, vendors, categories };
}

export async function autocomplete(q: string, db: Db = pool) {
  const t = tokenize(q).join(' ');
  if (t.length < 2) return [];
  const cond = await visibilityCondition('v');
  const like = `${t}%`, contains = `%${t}%`;
  const [products, vendors, cats, cuisines, brands] = await Promise.all([
    query<any>(`SELECT p.name AS label, p.slug AS value, 'product' AS type, v.trading_name AS hint FROM products p JOIN vendors v ON v.id = p.vendor_id
                 WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${cond} AND (f_unaccent(lower(p.name)) LIKE $1 OR f_unaccent(lower(p.name)) LIKE $2 OR word_similarity($3, f_unaccent(lower(p.name))) > 0.5)
                 ORDER BY (f_unaccent(lower(p.name)) LIKE $1) DESC, p.popularity DESC LIMIT 6`, [like, contains, t], db),
    query<any>(`SELECT v.trading_name AS label, v.slug AS value, CASE WHEN v.seller_type = 'chef' THEN 'chef' ELSE 'vendor' END AS type, v.city AS hint FROM vendors v
                 WHERE ${cond} AND (f_unaccent(lower(v.trading_name)) LIKE $1 OR f_unaccent(lower(v.trading_name)) LIKE $2 OR similarity(f_unaccent(lower(v.trading_name)), $3) > 0.35) LIMIT 4`, [like, contains, t], db),
    query<any>(`SELECT name AS label, slug AS value, 'category' AS type FROM categories WHERE is_active AND f_unaccent(lower(name)) LIKE $1 LIMIT 3`, [contains], db),
    query<any>(`SELECT DISTINCT cuisine AS label, cuisine AS value, 'cuisine' AS type FROM products WHERE status='active' AND deleted_at IS NULL AND cuisine IS NOT NULL AND f_unaccent(lower(cuisine)) LIKE $1 LIMIT 3`, [like], db),
    query<any>(`SELECT name AS label, slug AS value, 'brand' AS type FROM brands WHERE f_unaccent(lower(name)) LIKE $1 LIMIT 3`, [like], db),
  ]);
  return [...products, ...vendors, ...cats, ...cuisines, ...brands].slice(0, 12);
}

export async function logSearch(q: string, userId: string | null, anonId: string | null, count: number) {
  if (q) await query('INSERT INTO search_queries(query, user_id, anon_id, result_count) VALUES ($1,$2,$3,$4)', [q.slice(0, 100), userId, anonId, count]);
}

export async function categoryTree(db: Db = pool) {
  const cond = await visibilityCondition('v');
  const rows = await query<any>(
    `SELECT c.id, c.parent_id, c.slug, c.name, c.description, c.image_url, c.position,
            (SELECT count(*)::int FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.category_id = c.id AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond}) AS product_count
       FROM categories c WHERE c.is_active ORDER BY c.position, c.name`, [], db);
  const byParent = new Map<string | null, any[]>();
  for (const r of rows) { const k = r.parent_id ?? null; byParent.set(k, [...(byParent.get(k) ?? []), r]); }
  const build = (pid: string | null): any[] => (byParent.get(pid) ?? []).map((r) => { const children = build(r.id); return { ...r, children, product_count: r.product_count + children.reduce((s, c) => s + c.product_count, 0) }; });
  return build(null);
}

export async function getProduct(slug: string, db: Db = pool) {
  const cond = await visibilityCondition('v');
  const p = await one<any>(
    `SELECT p.*, v.slug AS vendor_slug, v.trading_name AS vendor_name, v.seller_type, v.logo_url AS vendor_logo, v.rating_avg AS vendor_rating, v.rating_count AS vendor_rating_count, v.city AS vendor_city,
            c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug
       FROM products p JOIN vendors v ON v.id = p.vendor_id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.slug = $1 AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond}`, [slug], db);
  if (!p) throw notFound('That product');
  const [variants, images, related, recipes, reviews] = await Promise.all([
    query<any>(
      `SELECT v.id, v.name, v.sku, v.price, v.sale_price, v.weight_grams, v.is_default, v.portions,
              CASE WHEN $2 THEN greatest(coalesce(i.on_hand,0) - coalesce(i.reserved,0), 0) ELSE NULL END AS available
         FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = $1 AND v.is_active ORDER BY v.position`, [p.id, p.tracks_inventory], db),
    query<any>('SELECT url, alt FROM product_images WHERE product_id = $1 ORDER BY position', [p.id], db),
    query<any>(
      `SELECT p2.id, p2.slug, p2.name, v2.trading_name AS vendor_name, (SELECT min(coalesce(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p2.id AND pv.is_active) AS price,
              (SELECT url FROM product_images pi WHERE pi.product_id = p2.id ORDER BY position LIMIT 1) AS image_url
         FROM products p2 JOIN vendors v2 ON v2.id = p2.vendor_id WHERE p2.category_id = $1 AND p2.id <> $2 AND p2.status = 'active' AND p2.deleted_at IS NULL AND ${await visibilityCondition('v2')}
         ORDER BY p2.popularity DESC LIMIT 8`, [p.category_id, p.id], db),
    query<any>(`SELECT a.slug, a.title FROM articles a JOIN article_products ap ON ap.article_id = a.id WHERE ap.product_id = $1 AND a.status = 'published' AND a.kind = 'recipe' LIMIT 4`, [p.id], db),
    query<any>(`SELECT r.id, r.rating, r.title, r.body, r.created_at, r.vendor_response, u.full_name FROM reviews r JOIN users u ON u.id = r.user_id
                 WHERE r.subject_type = 'product' AND r.subject_id = $1 AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 10`, [p.id], db),
  ]);
  delete p.search_tsv;
  return {
    ...p, price: undefined,
    variants: variants.map((v) => ({ ...v, price: Number(v.price), sale_price: v.sale_price != null ? Number(v.sale_price) : null })), images,
    related: related.map((r) => ({ ...r, price: Number(r.price) })), recipes,
    reviews: reviews.map((r) => ({ ...r, full_name: r.full_name.split(' ')[0] + ' ' + (r.full_name.split(' ')[1]?.[0] ?? '') + '.' })),
  };
}

export async function listVendors(p: { kind?: 'chef' | 'store'; q?: string; cuisine?: string; lat?: number; lng?: number; deliverable?: boolean; page?: number; limit?: number; sort?: string }, db: Db = pool) {
  const cond = await visibilityCondition('v');
  const params: any[] = [];
  const add = (v: any) => (params.push(v), `$${params.length}`);
  const where = [cond];
  if (p.kind === 'chef') where.push(`v.seller_type = 'chef'`);
  if (p.kind === 'store') where.push(`v.seller_type <> 'chef'`);
  if (p.q) where.push(`(f_unaccent(lower(v.trading_name)) LIKE ${add('%' + p.q.toLowerCase() + '%')} OR similarity(f_unaccent(lower(v.trading_name)), ${add(p.q.toLowerCase())}) > 0.3)`);
  if (p.cuisine) where.push(`${add(p.cuisine.toLowerCase())} = ANY(SELECT lower(x) FROM unnest(v.cuisines) x)`);
  let dist = 'NULL::float';
  if (p.lat != null && p.lng != null) {
    const la = add(p.lat), ln = add(p.lng);
    dist = `CASE WHEN v.lat IS NULL THEN NULL ELSE ${DIST(la, ln)} END`;
    if (p.deliverable) {
      const ids = [...(await vendorsDeliveringTo(p.lat, p.lng, db)).keys()];
      where.push(`v.id = ANY(${add(ids)}::uuid[])`);
    }
  }
  const limit = Math.min(p.limit ?? 24, 60), offset = ((p.page ?? 1) - 1) * limit;
  const order = p.sort === 'rating' ? 'v.rating_avg DESC' : p.sort === 'distance' && p.lat != null ? `${dist} ASC NULLS LAST` : 'v.is_featured DESC, v.rating_avg DESC, v.created_at DESC';
  const rows = await query<any>(
    `SELECT v.id, v.slug, v.trading_name, v.description, v.logo_url, v.cover_url, v.seller_type, v.cuisines, v.city, v.rating_avg, v.rating_count, v.accepts_delivery, v.accepts_pickup,
            v.default_prep_minutes, v.min_order, ${dist} AS distance_km,
            (SELECT count(*)::int FROM products p WHERE p.vendor_id = v.id AND p.status = 'active' AND p.deleted_at IS NULL) AS product_count,
            c.display_name AS chef_name, c.photo_url AS chef_photo, c.specialties
       FROM vendors v LEFT JOIN chefs c ON c.vendor_id = v.id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params, db);
  const total = await one<any>(`SELECT count(*)::int AS n FROM vendors v WHERE ${where.join(' AND ')}`, params, db);
  return { items: rows.map((r) => ({ ...r, rating_avg: Number(r.rating_avg), min_order: Number(r.min_order), distance_km: r.distance_km != null ? Math.round(r.distance_km * 10) / 10 : null })), total: total.n };
}

export async function getStorefront(slug: string, db: Db = pool) {
  const cond = await visibilityCondition('v');
  const v = await one<any>(`SELECT v.id, v.slug, v.seller_type, v.trading_name, v.description, v.logo_url, v.cover_url, v.city, v.region, v.line1, v.postal_code, v.lat, v.lng, v.cuisines, v.accepts_delivery, v.accepts_pickup,
                                   v.uses_own_drivers, v.accepting_orders, v.default_prep_minutes, v.min_order, v.rating_avg, v.rating_count, v.timezone, v.phone
                              FROM vendors v WHERE v.slug = $1 AND ${cond}`, [slug], db);
  if (!v) throw notFound('That store');
  const [hours, holidays, categories, promos, reviews, chef, zones] = await Promise.all([
    query<any>('SELECT weekday, to_char(opens, \'HH24:MI\') AS opens, to_char(closes, \'HH24:MI\') AS closes, is_closed FROM vendor_hours WHERE vendor_id = $1 ORDER BY weekday', [v.id], db),
    query<any>('SELECT to_char(day, \'YYYY-MM-DD\') AS day FROM vendor_holidays WHERE vendor_id = $1 AND day >= current_date', [v.id], db),
    query<any>(`SELECT c.slug, c.name, count(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE p.vendor_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL GROUP BY 1,2 ORDER BY n DESC`, [v.id], db),
    query<any>(`SELECT id, name, description, code, type, value, min_order, ends_at FROM promotions WHERE status = 'active' AND (vendor_id = $1 OR scope->'vendor_ids' ? $1::text) AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) AND (usage_limit IS NULL OR redemption_count < usage_limit) AND segment_id IS NULL`, [v.id], db),
    query<any>(`SELECT r.id, r.rating, r.title, r.body, r.created_at, r.vendor_response, u.full_name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.subject_type = 'vendor' AND r.subject_id = $1 AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 10`, [v.id], db),
    v.seller_type === 'chef' ? one<any>('SELECT display_name, bio, photo_url, specialties, operating_days, daily_capacity, portions_accepting FROM chefs WHERE vendor_id = $1', [v.id], db) : null,
    query<any>("SELECT name, zone_type, radius_km, fee_model, base_fee, per_km_fee, free_over, min_order FROM delivery_zones WHERE scope = 'vendor' AND vendor_id = $1 AND is_active", [v.id], db),
  ]);
  const open = makeIsOpenAt(v.timezone, hours.map((h) => ({ ...h, opens: h.opens, closes: h.closes })), holidays.map((h) => h.day))(new Date());
  return {
    ...v, rating_avg: Number(v.rating_avg), min_order: Number(v.min_order), hours, categories, promotions: promos.map((p) => ({ ...p, value: Number(p.value), min_order: Number(p.min_order) })), chef, zones,
    open_now: open.open && v.accepting_orders, open_reason: open.reason ?? (v.accepting_orders ? null : 'paused'),
    reviews: reviews.map((r) => ({ ...r, full_name: r.full_name.split(' ')[0] + ' ' + (r.full_name.split(' ')[1]?.[0] ?? '') + '.' })),
  };
}

export async function cuisinesAndCountries(db: Db = pool) {
  const cond = await visibilityCondition('v');
  const base = `FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${cond}`;
  const [cuisines, countries] = await Promise.all([
    query<any>(`SELECT p.cuisine AS name, count(*)::int AS n ${base} AND p.cuisine IS NOT NULL GROUP BY 1 ORDER BY n DESC`, [], db),
    query<any>(`SELECT p.country_of_origin AS name, count(*)::int AS n ${base} AND p.country_of_origin IS NOT NULL GROUP BY 1 ORDER BY n DESC`, [], db),
  ]);
  return { cuisines, countries };
}
export { haversineKm };
