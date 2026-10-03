import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, id } from '../lib/util.js';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import { badRequest, notFound } from '../errors.js';
import { savePromotion, promotionInput, promotionStats, saveCampaign, campaignMetrics, saveAd, saveHomepageSection, buildHomepage, saveArticle, articleInput, getArticle } from '../modules/marketing.js';
import { segmentRule, validateRule, segmentSize } from '../modules/segments.js';
import { audit } from '../lib/audit.js';
import { slugify, uniqueSlug } from '../lib/util.js';
import { getSetting, setSetting, SETTING_DEFS, type SettingKey } from '../lib/settings.js';

export async function marketingRoutes(app: FastifyInstance) {
  // ---- overview ----
  app.get('/overview', async (req) => {
    requirePerm(req.auth, 'marketing.manage', 'promotions.manage', 'analytics.read');
    const [promos, camps, ads, top, sections] = await Promise.all([
      one<any>(`SELECT count(*) FILTER (WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now()) AND (starts_at IS NULL OR starts_at <= now()))::int AS active, count(*) FILTER (WHERE status = 'draft')::int AS drafts, count(*) FILTER (WHERE ends_at < now())::int AS expired FROM promotions`),
      one<any>(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled FROM campaigns`),
      one<any>(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, coalesce(sum(impressions),0)::int AS impressions, coalesce(sum(clicks),0)::int AS clicks, coalesce(sum(spent),0) AS spent FROM ads`),
      query(`SELECT p.id, p.name, p.code, count(r.id)::int AS redemptions, coalesce(sum(r.amount),0) AS cost FROM promotions p LEFT JOIN promotion_redemptions r ON r.promotion_id = p.id AND r.status = 'active' GROUP BY 1,2,3 ORDER BY redemptions DESC LIMIT 5`),
      one<any>('SELECT count(*) FILTER (WHERE is_active)::int AS live FROM homepage_sections'),
    ]);
    return { promotions: promos, campaigns: camps, ads: { ...ads, spent: Number(ads.spent) }, top_promotions: top, homepage_sections: sections.live };
  });

  // ---- promotions ----
  app.get('/promotions', async (req) => {
    requirePerm(req.auth, 'promotions.manage', 'marketing.manage');
    const q = parse(z.object({ status: z.string().optional(), vendor: z.coerce.boolean().optional() }), req.query);
    return { promotions: await query(`SELECT p.*, v.trading_name AS vendor_name,
        CASE WHEN p.status = 'active' AND p.ends_at IS NOT NULL AND p.ends_at <= now() THEN 'expired' WHEN p.status = 'active' AND p.starts_at > now() THEN 'scheduled' ELSE p.status END AS state,
        (SELECT count(*)::int FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'active') AS redemptions
        FROM promotions p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE ($1::text IS NULL OR p.status = $1) AND ($2::boolean IS NULL OR (p.vendor_id IS NOT NULL) = $2) ORDER BY p.created_at DESC LIMIT 200`, [q.status ?? null, q.vendor ?? null]) };
  });
  app.post('/promotions', async (req, reply) => { requirePerm(req.auth, 'promotions.manage'); reply.status(201); return { promotion: await savePromotion(parse(promotionInput, req.body), {}, req.actor) }; });
  app.put('/promotions/:id', async (req) => { requirePerm(req.auth, 'promotions.manage'); return { promotion: await savePromotion(parse(promotionInput, req.body), { id: parse(z.object({ id }), req.params).id }, req.actor) }; });
  app.get('/promotions/:id/stats', async (req) => {
    requirePerm(req.auth, 'promotions.manage', 'marketing.manage');
    const s = await promotionStats(parse(z.object({ id }), req.params).id);
    if (!s) throw notFound('That promotion');
    return { stats: s };
  });

  // ---- segments ----
  app.get('/segments', async (req) => {
    requirePerm(req.auth, 'segments.manage', 'promotions.manage', 'marketing.manage');
    const rows = await query<any>('SELECT * FROM segments ORDER BY name');
    const out: any[] = [];
    for (const s of rows) { const p = segmentRule.safeParse(s.rule); out.push({ ...s, size: p.success ? await segmentSize(p.data) : null }); }
    return { segments: out };
  });
  app.post('/segments', async (req, reply) => {
    requirePerm(req.auth, 'segments.manage');
    const b = parse(z.object({ name: z.string().min(2).max(80), description: z.string().max(300).optional(), rule: z.any() }), req.body);
    const rule = validateRule(b.rule);
    const row = await one<any>('INSERT INTO segments(name, description, rule, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [b.name, b.description ?? null, JSON.stringify(rule), req.auth!.user.id]);
    await audit(req.actor, 'segment.created', 'segment', row.id, { name: b.name, rule });
    reply.status(201); return { segment: { ...row, size: await segmentSize(rule) } };
  });
  app.post('/segments/preview', async (req) => { requirePerm(req.auth, 'segments.manage'); return { size: await segmentSize(validateRule(parse(z.object({ rule: z.any() }), req.body).rule)) }; });
  app.delete('/segments/:id', async (req) => {
    requirePerm(req.auth, 'segments.manage');
    const sid = parse(z.object({ id }), req.params).id;
    const used = await one('SELECT 1 FROM promotions WHERE segment_id = $1 UNION SELECT 1 FROM campaigns WHERE segment_id = $1 UNION SELECT 1 FROM homepage_sections WHERE segment_id = $1 LIMIT 1', [sid]);
    if (used) throw badRequest('IN_USE', 'This segment is used by a promotion, campaign or homepage section.');
    await query('DELETE FROM segments WHERE id = $1', [sid]); await audit(req.actor, 'segment.deleted', 'segment', sid);
    return { ok: true };
  });

  // ---- campaigns ----
  const campaignBody = z.object({ name: z.string().min(2).max(120), description: z.string().max(1000).optional().nullable(), starts_at: z.coerce.date().optional().nullable(), ends_at: z.coerce.date().optional().nullable(), segment_id: id.optional().nullable(), promotion_id: id.optional().nullable(), landing_slug: z.string().max(80).optional().nullable(), tracking: z.record(z.string(), z.string()).optional(), product_ids: z.array(id).optional(), vendor_ids: z.array(id).optional(), budget: z.number().min(0).optional().nullable(), status: z.enum(['draft', 'scheduled', 'active', 'paused', 'ended']).optional() });
  app.get('/campaigns', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { campaigns: await query('SELECT c.*, p.name AS promotion_name, s.name AS segment_name FROM campaigns c LEFT JOIN promotions p ON p.id = c.promotion_id LEFT JOIN segments s ON s.id = c.segment_id ORDER BY c.created_at DESC') }; });
  app.post('/campaigns', async (req, reply) => { requirePerm(req.auth, 'marketing.manage'); reply.status(201); return { campaign: await saveCampaign(parse(campaignBody, req.body), undefined, req.actor) }; });
  app.put('/campaigns/:id', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { campaign: await saveCampaign(parse(campaignBody, req.body), parse(z.object({ id }), req.params).id, req.actor) }; });
  app.get('/campaigns/:id/metrics', async (req) => { requirePerm(req.auth, 'marketing.manage', 'analytics.read'); return campaignMetrics(parse(z.object({ id }), req.params).id); });

  // ---- ads ----
  const adBody = z.object({
    placement_key: z.string(), campaign_id: id.optional().nullable(), advertiser_type: z.enum(['platform', 'vendor', 'external']).default('platform'), advertiser_vendor_id: id.optional().nullable(), advertiser_name: z.string().max(120).optional().nullable(),
    title: z.string().min(2).max(120), subtitle: z.string().max(200).optional().nullable(), image_url: z.string().max(500).optional().nullable(), cta_label: z.string().max(40).optional().nullable(), click_url: z.string().max(500),
    product_id: id.optional().nullable(), segment_id: id.optional().nullable(), cost_model: z.enum(['flat', 'cpc', 'cpm']).default('flat'), rate: z.number().min(0).default(0), budget: z.number().min(0).optional().nullable(),
    starts_at: z.coerce.date().optional().nullable(), ends_at: z.coerce.date().optional().nullable(), position: z.number().int().default(0), status: z.enum(['draft', 'active', 'paused', 'ended']).default('draft'),
  });
  app.get('/ads', async (req) => { requirePerm(req.auth, 'ads.manage', 'marketing.manage'); return { ads: await query('SELECT a.*, c.name AS campaign_name FROM ads a LEFT JOIN campaigns c ON c.id = a.campaign_id ORDER BY a.created_at DESC'), placements: await query('SELECT * FROM ad_placements ORDER BY key') }; });
  app.post('/ads', async (req, reply) => { requirePerm(req.auth, 'ads.manage'); reply.status(201); return { ad: await saveAd(parse(adBody, req.body), undefined, req.actor) }; });
  app.put('/ads/:id', async (req) => { requirePerm(req.auth, 'ads.manage'); return { ad: await saveAd(parse(adBody.partial(), req.body), parse(z.object({ id }), req.params).id, req.actor) }; });

  // ---- homepage sections ----
  app.get('/homepage', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { sections: await query('SELECT h.*, s.name AS segment_name FROM homepage_sections h LEFT JOIN segments s ON s.id = h.segment_id ORDER BY position, updated_at') }; });
  app.get('/homepage/preview', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { sections: await buildHomepage(null, {}) }; });
  const sectionBody = z.object({ kind: z.enum(['hero', 'search', 'category_rail', 'product_rail', 'vendor_rail', 'chef_rail', 'cuisine_grid', 'country_grid', 'collection', 'banner', 'editorial', 'shop_modes']), title: z.string().max(120).optional().nullable(), subtitle: z.string().max(240).optional().nullable(), config: z.record(z.string(), z.any()).default({}), position: z.number().int().default(0), is_active: z.boolean().default(true), starts_at: z.coerce.date().optional().nullable(), ends_at: z.coerce.date().optional().nullable(), segment_id: id.optional().nullable() });
  app.post('/homepage', async (req, reply) => { requirePerm(req.auth, 'marketing.manage'); reply.status(201); return { section: await saveHomepageSection(parse(sectionBody, req.body), undefined, req.actor) }; });
  app.put('/homepage/:id', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { section: await saveHomepageSection(parse(sectionBody.partial(), req.body), parse(z.object({ id }), req.params).id, req.actor) }; });
  app.delete('/homepage/:id', async (req) => { requirePerm(req.auth, 'marketing.manage'); const hid = parse(z.object({ id }), req.params).id; await query('DELETE FROM homepage_sections WHERE id = $1', [hid]); await audit(req.actor, 'homepage.deleted', 'homepage_section', hid); return { ok: true }; });
  app.post('/homepage/reorder', async (req) => {
    requirePerm(req.auth, 'marketing.manage');
    const b = parse(z.object({ order: z.array(id).max(100) }), req.body);
    await tx(async (c) => { for (const [i, sid] of b.order.entries()) await query('UPDATE homepage_sections SET position = $2, updated_by = $3, updated_at = now() WHERE id = $1', [sid, i * 10, req.auth!.user.id], c); });
    await audit(req.actor, 'homepage.reordered', 'homepage_section', null, { order: b.order });
    return { ok: true };
  });

  // ---- collections ----
  app.get('/collections', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { collections: await query('SELECT c.*, (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS items FROM collections c ORDER BY title') }; });
  app.post('/collections', async (req, reply) => {
    requirePerm(req.auth, 'marketing.manage');
    const b = parse(z.object({ title: z.string().min(2).max(120), description: z.string().max(500).optional(), image_url: z.string().max(500).optional(), product_ids: z.array(id).max(100).default([]), is_active: z.boolean().default(true), starts_at: z.coerce.date().optional().nullable(), ends_at: z.coerce.date().optional().nullable() }), req.body);
    const col = await tx(async (c) => {
      const row = await one<any>('INSERT INTO collections(slug, title, description, image_url, is_active, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [await uniqueSlug('collections', b.title, c), b.title, b.description ?? null, b.image_url ?? null, b.is_active, b.starts_at ?? null, b.ends_at ?? null], c);
      for (const [i, pid] of b.product_ids.entries()) await query('INSERT INTO collection_items(collection_id, product_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [row.id, pid, i], c);
      return row;
    });
    await audit(req.actor, 'collection.created', 'collection', col.id, { title: b.title });
    reply.status(201); return { collection: col };
  });
  app.put('/collections/:id/items', async (req) => {
    requirePerm(req.auth, 'marketing.manage');
    const cid = parse(z.object({ id }), req.params).id;
    const b = parse(z.object({ product_ids: z.array(id).max(100) }), req.body);
    await tx(async (c) => { await query('DELETE FROM collection_items WHERE collection_id = $1', [cid], c); for (const [i, pid] of b.product_ids.entries()) await query('INSERT INTO collection_items(collection_id, product_id, position) VALUES ($1,$2,$3)', [cid, pid, i], c); });
    await audit(req.actor, 'collection.updated', 'collection', cid, { items: b.product_ids.length });
    return { ok: true };
  });
  app.get('/products/lookup', async (req) => {
    requirePerm(req.auth, 'marketing.manage', 'content.manage', 'promotions.manage');
    const q = parse(z.object({ q: z.string().min(2).max(60) }), req.query);
    return { products: await query(`SELECT p.id, p.name, v.trading_name AS vendor FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.deleted_at IS NULL AND p.status = 'active' AND lower(p.name) LIKE $1 ORDER BY p.popularity DESC LIMIT 15`, [`%${q.q.toLowerCase()}%`]) };
  });

  // ---- content ----
  app.get('/articles', async (req) => { requirePerm(req.auth, 'content.manage'); return { articles: await query('SELECT id, slug, kind, title, status, published_at, updated_at FROM articles ORDER BY updated_at DESC') }; });
  app.get('/articles/:slug', async (req) => { requirePerm(req.auth, 'content.manage'); return { article: await getArticle(parse(z.object({ slug: z.string() }), req.params).slug, true) }; });
  app.post('/articles', async (req, reply) => { requirePerm(req.auth, 'content.manage'); reply.status(201); return { article: await saveArticle(parse(articleInput, req.body), undefined, req.actor) }; });
  app.put('/articles/:id', async (req) => { requirePerm(req.auth, 'content.manage'); return { article: await saveArticle(parse(articleInput, req.body), parse(z.object({ id }), req.params).id, req.actor) }; });

  // ---- search synonyms ----
  app.get('/synonyms', async (req) => { requirePerm(req.auth, 'marketing.manage', 'catalog.manage'); return { synonyms: await query('SELECT * FROM search_synonyms ORDER BY term'), top_queries: await query(`SELECT query, count(*)::int AS n, round(avg(result_count))::int AS avg_results FROM search_queries WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC LIMIT 15`), no_results: await query(`SELECT query, count(*)::int AS n FROM search_queries WHERE result_count = 0 AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC LIMIT 15`) }; });
  app.put('/synonyms', async (req) => {
    requirePerm(req.auth, 'marketing.manage', 'catalog.manage');
    const b = parse(z.object({ term: z.string().min(2).max(40), synonyms: z.array(z.string().min(2).max(40)).min(1).max(20) }), req.body);
    await query('INSERT INTO search_synonyms(term, synonyms) VALUES ($1,$2) ON CONFLICT (term) DO UPDATE SET synonyms = EXCLUDED.synonyms', [b.term.toLowerCase(), b.synonyms.map((s) => s.toLowerCase())]);
    await audit(req.actor, 'synonym.saved', 'synonym', b.term, b);
    return { ok: true };
  });

  // ---- marketing owned configuration (abandoned carts, loyalty, promotion guard rails) ----
  const MARKETING_KEYS: SettingKey[] = ['abandoned_cart', 'loyalty', 'promotions'];
  app.get('/settings', async (req) => { requirePerm(req.auth, 'marketing.manage'); return { settings: await Promise.all(MARKETING_KEYS.map(async (k) => ({ key: k, label: SETTING_DEFS[k].label, description: SETTING_DEFS[k].description, value: await getSetting(k) }))) }; });
  app.put('/settings/:key', async (req) => {
    requirePerm(req.auth, 'marketing.manage');
    const key = parse(z.object({ key: z.string() }), req.params).key as SettingKey;
    if (!MARKETING_KEYS.includes(key)) throw badRequest('FORBIDDEN_KEY', 'That setting is managed by administrators.');
    const r = await setSetting(key, parse(z.object({ value: z.any() }), req.body).value, req.auth!.user.id);
    await audit(req.actor, 'setting.updated', 'setting', key, r);
    return { ok: true };
  });
  void slugify;
}
