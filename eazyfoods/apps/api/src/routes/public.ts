import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { parse } from '../lib/util.js';
import { query, one } from '../db.js';
import { searchProducts, searchParams, facets, autocomplete, logSearch, categoryTree, getProduct, listVendors, getStorefront, cuisinesAndCountries, vendorsDeliveringTo } from '../modules/discovery.js';
import { recommend, similarProducts } from '../modules/recommendations.js';
import { buildHomepage, getArticle, trackAd, serveAds, byIds } from '../modules/marketing.js';
import { trackEvent } from '../modules/analytics.js';
import { geocode } from '../lib/geo.js';
import { badRequest, notFound } from '../errors.js';
import { visibilityCondition } from '../modules/vendors.js';
import { getSetting } from '../lib/settings.js';
import { config } from '../config.js';
import { loadAuth } from '../lib/auth.js';

const ANON = 'ez_anon';
const anonId = (req: any, reply: any) => {
  let a = req.cookies?.[ANON];
  if (!a) { a = randomBytes(12).toString('hex'); reply.setCookie(ANON, a, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: 31536000 }); }
  return a as string;
};
const loc = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() });

export async function publicRoutes(app: FastifyInstance) {
  app.get('/products', async (req, reply) => {
    const p = parse(searchParams, req.query);
    const r = await searchProducts(p, req.auth?.user.id ?? null);
    if (p.q && p.page === 1) logSearch(p.q, req.auth?.user.id ?? null, anonId(req, reply), r.total).catch(() => {});
    if (p.q && p.page === 1) trackEvent('search', { userId: req.auth?.user.id, props: { q: p.q, results: r.total } }).catch(() => {});
    reply.header('Cache-Control', 'public, max-age=15');
    return r;
  });
  app.get('/products/facets', async (req) => facets(parse(searchParams, req.query)));
  app.get('/products/autocomplete', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return { suggestions: await autocomplete(parse(z.object({ q: z.string().max(60) }), req.query).q) };
  });
  app.get('/products/:slug', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().max(200) }), req.params);
    const p = await getProduct(slug);
    const uid = req.auth?.user.id ?? null;
    trackEvent('product_view', { userId: uid, anonId: uid ? null : anonId(req, reply), entityType: 'product', entityId: p.id }).catch(() => {});
    if (uid) query('INSERT INTO recently_viewed(user_id, product_id) VALUES ($1,$2) ON CONFLICT (user_id, product_id) DO UPDATE SET viewed_at = now()', [uid, p.id]).catch(() => {});
    return { product: p };
  });
  app.get('/products/:slug/recommendations', async (req) => {
    const { slug } = parse(z.object({ slug: z.string() }), req.params);
    const p = await one<any>("SELECT id FROM products WHERE slug = $1 AND status = 'active'", [slug]);
    if (!p) throw notFound('That product');
    const [together, similar] = await Promise.all([recommend({ userId: req.auth?.user.id, seedProductIds: [p.id], limit: 6 }), similarProducts(p.id, 6)]);
    return { bought_together: together.filter((r) => r.reason.startsWith('Often bought')), similar };
  });
  app.get('/recommendations', async (req) => ({ items: await recommend({ userId: req.auth?.user.id ?? null, limit: 12 }) }));
  app.get('/categories', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return { categories: await categoryTree() }; });
  app.get('/cuisines', async () => cuisinesAndCountries());

  const vendorList = z.object({ q: z.string().max(80).optional(), cuisine: z.string().optional(), sort: z.string().optional(), deliverable: z.coerce.boolean().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(60).default(24) }).merge(loc);
  app.get('/stores', async (req) => listVendors({ ...parse(vendorList, req.query), kind: 'store' }));
  app.get('/chefs', async (req) => listVendors({ ...parse(vendorList, req.query), kind: 'chef' }));
  app.get('/stores/:slug', async (req) => ({ store: await getStorefront(parse(z.object({ slug: z.string() }), req.params).slug) }));
  app.get('/chefs/:slug', async (req) => {
    const s = await getStorefront(parse(z.object({ slug: z.string() }), req.params).slug);
    if (s.seller_type !== 'chef') throw notFound('That chef');
    return { chef: s };
  });

  app.get('/home', async (req, reply) => {
    const q = parse(loc, req.query);
    reply.header('Cache-Control', req.auth ? 'private, no-store' : 'public, max-age=20');
    return { sections: await buildHomepage(req.auth?.user.id ?? null, q) };
  });

  app.get('/articles', async (req) => {
    const q = parse(z.object({ kind: z.enum(['blog', 'recipe', 'guide', 'faq', 'landing']).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    return { articles: await query(`SELECT slug, kind, title, excerpt, hero_image, published_at FROM articles WHERE status = 'published' AND ($1::text IS NULL OR kind = $1) ORDER BY published_at DESC LIMIT $2`, [q.kind ?? null, q.limit]) };
  });
  app.get('/articles/:slug', async (req) => ({ article: await getArticle(parse(z.object({ slug: z.string() }), req.params).slug) }));
  app.get('/collections/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string() }), req.params);
    const c = await one<any>(`SELECT * FROM collections WHERE slug = $1 AND is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`, [slug]);
    if (!c) throw notFound('That collection');
    const ids = (await query<any>('SELECT product_id FROM collection_items WHERE collection_id = $1 ORDER BY position', [c.id])).map((r) => r.product_id);
    return { collection: c, items: await byIds(ids) };
  });

  app.get('/ads', async (req) => ({ ads: await serveAds(parse(z.object({ placement: z.string() }), req.query).placement, req.auth?.user.id ?? null, 3) }));
  app.post('/ads/:id/impression', async (req, reply) => {
    await trackAd(parse(z.object({ id: z.guid() }), req.params).id, 'impression', req.auth?.user.id ?? null, anonId(req, reply));
    return { ok: true };
  });
  app.get('/ads/:id/click', async (req, reply) => {
    const url = await trackAd(parse(z.object({ id: z.guid() }), req.params).id, 'click', req.auth?.user.id ?? null, anonId(req, reply));
    return reply.redirect(url);
  });

  app.post('/events', async (req, reply) => {
    const b = parse(z.object({ name: z.enum(['page_view', 'landing_view', 'search_click', 'share']), entityType: z.string().max(40).optional(), entityId: z.string().max(80).optional(), campaignId: z.guid().optional(), props: z.record(z.string(), z.any()).optional() }), req.body);
    await trackEvent(b.name, { userId: req.auth?.user.id, anonId: req.auth ? null : anonId(req, reply), entityType: b.entityType, entityId: b.entityId, campaignId: b.campaignId, props: b.props });
    return { ok: true };
  });

  app.post('/locate', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ postal_code: z.string().max(12).optional(), city: z.string().max(80).optional(), line1: z.string().max(200).optional(), region: z.string().max(10).optional() }), req.body);
    if (!b.postal_code && !b.city) throw badRequest('VALIDATION', 'Enter a postal code or city.');
    const g = await geocode({ ...b, country: 'CA' });
    if (!g) throw badRequest('ADDRESS_NOT_LOCATED', 'We could not find that location. Try a full postal code or choose your city.');
    return g;
  });

  // Which stores deliver here, with a delivery fee preview. Powers "available near you".
  app.get('/delivery/check', async (req) => {
    const q = parse(z.object({ lat: z.coerce.number(), lng: z.coerce.number() }), req.query);
    const map = await vendorsDeliveringTo(q.lat, q.lng);
    if (!map.size) return { stores: [] };
    const rows = await query<any>(`SELECT id, slug, trading_name, seller_type, default_prep_minutes, min_order FROM vendors WHERE id = ANY($1::uuid[])`, [[...map.keys()]]);
    const del = await getSetting('delivery');
    return { stores: rows.map((r) => ({ ...r, min_order: Number(r.min_order), distance_km: map.get(r.id), eta_minutes: r.default_prep_minutes + 8 + Math.round(((map.get(r.id) ?? 0) / del.avg_speed_kmh.car) * 60) })).sort((a, b) => a.distance_km - b.distance_km) };
  });

  app.get('/seo/sitemap', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    const cond = await visibilityCondition('v');
    const [products, stores, chefs, categories, articles, cuisines] = await Promise.all([
      query(`SELECT p.slug, p.updated_at FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'active' AND p.deleted_at IS NULL AND ${cond} ORDER BY p.updated_at DESC LIMIT 45000`),
      query(`SELECT v.slug, v.updated_at FROM vendors v WHERE ${cond} AND v.seller_type <> 'chef'`),
      query(`SELECT v.slug, v.updated_at FROM vendors v WHERE ${cond} AND v.seller_type = 'chef'`),
      query('SELECT slug FROM categories WHERE is_active'),
      query("SELECT slug, kind, updated_at FROM articles WHERE status = 'published'"),
      query(`SELECT DISTINCT cuisine AS name FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.cuisine IS NOT NULL AND p.status = 'active' AND ${cond}`),
    ]);
    return { products, stores, chefs, categories, articles, cuisines };
  });
  void loadAuth;
}
