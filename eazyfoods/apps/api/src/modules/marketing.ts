// Marketing: promotions, campaigns, advertising, homepage sections, collections, content.
import { z } from 'zod';
import { query, one, tx, pool, type Db } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, diff, type Actor } from '../lib/audit.js';
import { patch, slugify, uniqueSlug } from '../lib/util.js';
import { trackEvent } from './analytics.js';
import { searchProducts } from './discovery.js';
import { recommend } from './recommendations.js';
import { userSegmentIds } from './segments.js';
import { visibilityCondition } from './vendors.js';
import { getSetting } from '../lib/settings.js';
import { notify } from '../lib/notifications.js';

// ---------------- promotions ----------------
export const promotionInput = z.object({
  name: z.string().min(2).max(120), description: z.string().max(500).optional().nullable(),
  code: z.string().regex(/^[A-Za-z0-9_-]{3,30}$/, 'Codes use 3 to 30 letters, numbers, dashes or underscores').optional().nullable(),
  type: z.enum(['percent', 'fixed', 'free_delivery', 'bogo', 'spend_get', 'first_order']),
  value: z.coerce.number().min(0).max(100000).default(0), max_discount: z.coerce.number().min(0).optional().nullable(), min_order: z.coerce.number().min(0).default(0),
  starts_at: z.coerce.date().optional().nullable(), ends_at: z.coerce.date().optional().nullable(),
  usage_limit: z.coerce.number().int().min(1).optional().nullable(), per_customer_limit: z.coerce.number().int().min(1).optional().nullable(),
  funded_by: z.enum(['platform', 'vendor']).default('platform'),
  scope: z.object({ vendor_ids: z.array(z.guid()).optional(), category_ids: z.array(z.guid()).optional(), product_ids: z.array(z.guid()).optional(), product_types: z.array(z.string()).optional() }).default({}),
  segment_id: z.guid().optional().nullable(), stackable: z.boolean().default(false), stack_group: z.string().max(40).optional().nullable(),
  priority: z.coerce.number().int().default(0), auto_apply: z.boolean().default(false), status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  config: z.record(z.string(), z.any()).default({}),
});
export type PromotionInput = z.infer<typeof promotionInput>;

export function validatePromotion(p: PromotionInput) {
  if (p.starts_at && p.ends_at && p.ends_at <= p.starts_at) throw badRequest('VALIDATION', 'The end date must be after the start date.');
  if (p.type === 'percent' || (p.type === 'first_order' && p.config.discount_type !== 'fixed')) {
    if (p.value <= 0 || p.value > 100) throw badRequest('VALIDATION', 'A percentage discount must be between 1 and 100.');
  }
  if (p.type === 'fixed' && p.value <= 0) throw badRequest('VALIDATION', 'Enter the discount amount.');
  if (p.type === 'first_order' && p.config.discount_type === 'fixed' && p.value <= 0) throw badRequest('VALIDATION', 'Enter the discount amount.');
  if (p.type === 'bogo') {
    const b = Number(p.config.buy_qty ?? 1), g = Number(p.config.get_qty ?? 1), pct = Number(p.config.get_percent ?? 100);
    if (!(b >= 1 && g >= 1 && pct > 0 && pct <= 100)) throw badRequest('VALIDATION', 'Check the buy, get and discount values for this offer.');
  }
  if (p.type === 'spend_get') {
    const r = p.config.reward;
    if (!(Number(p.config.spend) > 0) || !r || !['fixed', 'percent', 'free_delivery'].includes(r.type) || (r.type !== 'free_delivery' && !(Number(r.value) > 0))) throw badRequest('VALIDATION', 'Set a spend threshold and a reward.');
    if (r.type === 'percent' && Number(r.value) > 100) throw badRequest('VALIDATION', 'A percentage reward can not exceed 100.');
  }
  if (p.type === 'free_delivery' && p.funded_by === 'vendor' && !p.scope.vendor_ids?.length) { /* vendor owned promos get vendor_ids forced on save */ }
  if (p.stackable && !p.stack_group && false) throw badRequest('VALIDATION', 'Choose a stack group.');
  if (!p.auto_apply && !p.code && p.status === 'active') throw badRequest('VALIDATION', 'A promotion needs a code or must apply automatically.');
}

export async function savePromotion(input: PromotionInput, opts: { id?: string; vendorId?: string | null }, actor: Actor) {
  validatePromotion(input);
  const data: any = { ...input, code: input.code ? input.code.toUpperCase() : null };
  if (opts.vendorId) {
    // Vendors can only discount their own products, funded by themselves, never stack with platform promos.
    data.vendor_id = opts.vendorId; data.funded_by = 'vendor'; data.scope = { ...data.scope, vendor_ids: [opts.vendorId], category_ids: data.scope.category_ids };
    data.stackable = false; data.stack_group = null; data.segment_id = null;
  }
  try {
    return await tx(async (c) => {
      if (opts.id) {
        const before = await one<any>('SELECT * FROM promotions WHERE id = $1 FOR UPDATE', [opts.id], c);
        if (!before || (opts.vendorId && before.vendor_id !== opts.vendorId)) throw notFound('That promotion');
        const after = await patch('promotions', 'id', opts.id, data, ['name', 'description', 'code', 'type', 'value', 'max_discount', 'min_order', 'starts_at', 'ends_at', 'usage_limit', 'per_customer_limit', 'funded_by', 'scope', 'segment_id', 'stackable', 'stack_group', 'priority', 'auto_apply', 'status', 'config'], c, ['scope', 'config']);
        await audit(actor, 'promotion.updated', 'promotion', opts.id, diff(before, after ?? before), c);
        return after!;
      }
      const row = await one<any>(
        `INSERT INTO promotions(name, description, code, type, value, max_discount, min_order, starts_at, ends_at, usage_limit, per_customer_limit, vendor_id, funded_by, scope, segment_id, stackable, stack_group, priority, auto_apply, status, config, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [data.name, data.description ?? null, data.code, data.type, data.value, data.max_discount ?? null, data.min_order, data.starts_at ?? null, data.ends_at ?? null, data.usage_limit ?? null, data.per_customer_limit ?? null,
          data.vendor_id ?? null, data.funded_by, JSON.stringify(data.scope), data.segment_id ?? null, data.stackable, data.stack_group ?? null, data.priority, data.auto_apply, data.status, JSON.stringify(data.config), actor.userId], c);
      await audit(actor, 'promotion.created', 'promotion', row.id, { name: row.name, code: row.code }, c);
      return row;
    });
  } catch (e: any) {
    if (e.code === '23505') throw conflict('CODE_IN_USE', 'That promotion code is already in use.');
    throw e;
  }
}

export async function promotionStats(promotionId: string) {
  return one<any>(
    `SELECT p.*, count(r.id) FILTER (WHERE r.status = 'active')::int AS redemptions, coalesce(sum(r.amount) FILTER (WHERE r.status = 'active'),0) AS discount_cost,
            coalesce(sum(o.total) FILTER (WHERE r.status = 'active'),0) AS revenue
       FROM promotions p LEFT JOIN promotion_redemptions r ON r.promotion_id = p.id LEFT JOIN orders o ON o.id = r.order_id WHERE p.id = $1 GROUP BY p.id`, [promotionId]);
}

// ---------------- campaigns ----------------
export async function saveCampaign(data: any, id: string | undefined, actor: Actor) {
  if (data.starts_at && data.ends_at && new Date(data.ends_at) <= new Date(data.starts_at)) throw badRequest('VALIDATION', 'The end date must be after the start date.');
  if (id) {
    const before = await one<any>('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!before) throw notFound('That campaign');
    const after = await patch('campaigns', 'id', id, data, ['name', 'description', 'starts_at', 'ends_at', 'segment_id', 'promotion_id', 'landing_slug', 'tracking', 'product_ids', 'vendor_ids', 'budget', 'status'], pool, ['tracking']);
    await audit(actor, 'campaign.updated', 'campaign', id, diff(before, after ?? before));
    return after ?? before;
  }
  const row = await one<any>(
    `INSERT INTO campaigns(name, description, starts_at, ends_at, segment_id, promotion_id, landing_slug, tracking, product_ids, vendor_ids, budget, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.name, data.description ?? null, data.starts_at ?? null, data.ends_at ?? null, data.segment_id ?? null, data.promotion_id ?? null, data.landing_slug ?? null, JSON.stringify(data.tracking ?? {}), data.product_ids ?? [], data.vendor_ids ?? [], data.budget ?? null, data.status ?? 'draft', actor.userId]);
  await audit(actor, 'campaign.created', 'campaign', row.id, { name: row.name });
  return row;
}

export async function campaignMetrics(campaignId: string) {
  const c = await one<any>('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  if (!c) throw notFound('That campaign');
  const ev = await one<any>(`SELECT count(*) FILTER (WHERE name = 'ad_impression')::int AS impressions, count(*) FILTER (WHERE name = 'ad_click')::int AS clicks, count(*) FILTER (WHERE name = 'landing_view')::int AS landing_views
                               FROM analytics_events WHERE campaign_id = $1`, [campaignId]);
  const sales = c.promotion_id ? await one<any>(
    `SELECT count(DISTINCT r.order_id)::int AS orders, coalesce(sum(o.total),0) AS revenue, coalesce(sum(r.amount),0) AS discount_cost
       FROM promotion_redemptions r JOIN orders o ON o.id = r.order_id WHERE r.promotion_id = $1 AND r.status = 'active' AND o.placed_at >= coalesce($2::timestamptz, '-infinity'::timestamptz)`, [c.promotion_id, c.starts_at]) : { orders: 0, revenue: 0, discount_cost: 0 };
  const interactions = ev.clicks + ev.landing_views;
  return {
    campaign: c, impressions: ev.impressions, clicks: ev.clicks, landing_views: ev.landing_views, orders: sales.orders, revenue: Number(sales.revenue), discount_cost: Number(sales.discount_cost),
    ctr: ev.impressions ? Math.round((ev.clicks / ev.impressions) * 1000) / 10 : null,
    conversion_rate: interactions ? Math.round((sales.orders / interactions) * 1000) / 10 : null,
  };
}

// ---------------- advertising ----------------
// Same-site paths (never protocol relative) or https links. Blocks javascript: and //host open redirects.
const SAFE_URL = /^(\/(?!\/)[A-Za-z0-9/_\-.?=&%#]*|https:\/\/[A-Za-z0-9.-]+(\/[^\s]*)?)$/;
export async function saveAd(data: any, id: string | undefined, actor: Actor) {
  if ((!id || data.click_url !== undefined) && !SAFE_URL.test(data.click_url ?? '')) throw badRequest('VALIDATION', 'Use a path on this site (starting with /) or an https link.');
  if (data.starts_at && data.ends_at && new Date(data.ends_at) <= new Date(data.starts_at)) throw badRequest('VALIDATION', 'The end date must be after the start date.');
  const cols = ['placement_key', 'campaign_id', 'advertiser_type', 'advertiser_vendor_id', 'advertiser_name', 'title', 'subtitle', 'image_url', 'cta_label', 'click_url', 'product_id', 'segment_id', 'cost_model', 'rate', 'budget', 'starts_at', 'ends_at', 'position', 'status'];
  if (id) {
    const before = await one<any>('SELECT * FROM ads WHERE id = $1', [id]);
    if (!before) throw notFound('That ad');
    const after = await patch('ads', 'id', id, data, cols);
    await audit(actor, 'ad.updated', 'ad', id, diff(before, after ?? before));
    return after ?? before;
  }
  const present = cols.filter((c) => data[c] !== undefined);
  const row = await one<any>(`INSERT INTO ads(${present.join(',')}, created_by) VALUES (${present.map((_, i) => `$${i + 1}`).join(',')}, $${present.length + 1}) RETURNING *`, [...present.map((c) => data[c]), actor.userId]);
  await audit(actor, 'ad.created', 'ad', row.id, { title: row.title, placement: row.placement_key });
  return row;
}

export async function serveAds(placement: string, userId: string | null, limit = 3, db: Db = pool) {
  const pl = await one<any>('SELECT * FROM ad_placements WHERE key = $1', [placement], db);
  if (!pl) return [];
  const rows = await query<any>(
    `SELECT a.id, a.title, a.subtitle, a.image_url, a.cta_label, a.click_url, a.segment_id, a.campaign_id, a.advertiser_type, a.advertiser_name, a.product_id
       FROM ads a WHERE a.placement_key = $1 AND a.status = 'active' AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at > now()) AND (a.budget IS NULL OR a.spent < a.budget)
      ORDER BY a.position, a.created_at DESC LIMIT 20`, [placement], db);
  const segs = userId ? await userSegmentIds(userId, rows.map((r) => r.segment_id).filter(Boolean), db) : new Set<string>();
  return rows.filter((r) => !r.segment_id || segs.has(r.segment_id)).slice(0, Math.min(limit, pl.max_slots)).map(({ segment_id, ...r }) => ({ ...r, sponsored: r.advertiser_type !== 'platform' }));
}

export async function trackAd(adId: string, kind: 'impression' | 'click', userId: string | null, anonId: string | null) {
  const ad = await one<any>('SELECT * FROM ads WHERE id = $1', [adId]);
  if (!ad) throw notFound('That ad');
  const cost = ad.cost_model === 'cpc' && kind === 'click' ? Number(ad.rate) : ad.cost_model === 'cpm' && kind === 'impression' ? Number(ad.rate) / 1000 : 0;
  await query(`UPDATE ads SET ${kind === 'click' ? 'clicks = clicks + 1' : 'impressions = impressions + 1'}, spent = spent + $2,
               status = CASE WHEN budget IS NOT NULL AND spent + $2 >= budget THEN 'ended' ELSE status END WHERE id = $1`, [adId, cost]);
  await trackEvent(kind === 'click' ? 'ad_click' : 'ad_impression', { userId, anonId, adId, campaignId: ad.campaign_id, entityType: 'ad', entityId: adId });
  return ad.click_url as string;
}

// ---------------- homepage ----------------
export const HOME_SOURCES = ['trending', 'best_sellers', 'new_arrivals', 'deals', 'recommended', 'recently_viewed', 'frequently_purchased', 'prepared', 'groceries'] as const;

async function productRail(source: string, userId: string | null, limit: number, loc: { lat?: number; lng?: number }, db: Db) {
  const base = { limit, page: 1, ...loc } as any;
  switch (source) {
    case 'trending': case 'best_sellers': return (await searchProducts({ ...base, sort: 'popular' }, userId, db)).items;
    case 'new_arrivals': return (await searchProducts({ ...base, sort: 'newest' }, userId, db)).items;
    case 'deals': return (await searchProducts({ ...base, on_sale: true, sort: 'popular' }, userId, db)).items;
    case 'prepared': return (await searchProducts({ ...base, type: 'prepared,chef_meal', sort: 'popular' }, userId, db)).items;
    case 'groceries': return (await searchProducts({ ...base, type: 'dry,fresh,frozen', sort: 'popular' }, userId, db)).items;
    case 'recommended': return recommend({ userId, limit }, db);
    case 'recently_viewed': {
      if (!userId) return [];
      const ids = (await query<any>('SELECT product_id FROM recently_viewed WHERE user_id = $1 ORDER BY viewed_at DESC LIMIT $2', [userId, limit], db)).map((r) => r.product_id);
      return byIds(ids, db);
    }
    case 'frequently_purchased': {
      if (!userId) return [];
      const ids = (await query<any>(`SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = $1 AND o.status NOT IN ('cancelled','pending_payment') GROUP BY 1 HAVING count(DISTINCT o.id) >= 2 ORDER BY count(*) DESC LIMIT $2`, [userId, limit], db)).map((r) => r.product_id);
      return byIds(ids, db);
    }
    default: return [];
  }
}
export async function byIds(ids: string[], db: Db = pool) {
  if (!ids.length) return [];
  const cond = await visibilityCondition('v');
  const rows = await query<any>(
    `SELECT p.id, p.slug, p.name, p.product_type, p.rating_avg, p.rating_count, v.slug AS vendor_slug, v.trading_name AS vendor_name,
            (SELECT min(coalesce(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active) AS price,
            (SELECT min(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active AND pv.sale_price IS NOT NULL) AS compare_price,
            (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY position LIMIT 1) AS image_url,
            (SELECT id FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active ORDER BY is_default DESC, position LIMIT 1) AS default_variant_id,
            (SELECT count(*)::int FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active) AS variant_count, true AS in_stock
       FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = ANY($1::uuid[]) AND p.status = 'active' AND p.deleted_at IS NULL AND ${cond}`, [ids], db);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((r) => ({ ...r, price: Number(r.price), compare_price: r.compare_price != null ? Number(r.compare_price) : null, rating_avg: Number(r.rating_avg) }));
}

export async function buildHomepage(userId: string | null, loc: { lat?: number; lng?: number }, db: Db = pool) {
  const sections = await query<any>(
    `SELECT * FROM homepage_sections WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) ORDER BY position, updated_at`, [], db);
  const segs = userId ? await userSegmentIds(userId, sections.map((s) => s.segment_id).filter(Boolean), db) : new Set<string>();
  const out: any[] = [];
  for (const s of sections) {
    if (s.segment_id && !segs.has(s.segment_id)) continue;
    const limit = Math.min(Number(s.config.limit ?? 8), 24);
    let data: any = null;
    switch (s.kind) {
      case 'hero': data = { ads: await serveAds('homepage_hero', userId, 1, db) }; break;
      case 'banner': data = { ads: await serveAds('homepage_banner', userId, 2, db) }; break;
      case 'product_rail': data = { items: await productRail(s.config.source ?? 'trending', userId, limit, loc, db), source: s.config.source }; if (!data.items.length) continue; break;
      case 'vendor_rail': case 'chef_rail': {
        const { listVendors } = await import('./discovery.js');
        data = await listVendors({ kind: s.kind === 'chef_rail' ? 'chef' : 'store', lat: loc.lat, lng: loc.lng, sort: loc.lat != null ? 'distance' : 'rating', limit }, db);
        if (!data.items.length) continue; break;
      }
      case 'category_rail': { const { categoryTree } = await import('./discovery.js'); data = { categories: (await categoryTree(db)).filter((c) => c.product_count > 0).slice(0, limit) }; break; }
      case 'cuisine_grid': case 'country_grid': { const { cuisinesAndCountries } = await import('./discovery.js'); const r = await cuisinesAndCountries(db); data = { items: (s.kind === 'cuisine_grid' ? r.cuisines : r.countries).slice(0, limit), kind: s.kind === 'cuisine_grid' ? 'cuisine' : 'country' }; break; }
      case 'collection': {
        const col = await one<any>(`SELECT * FROM collections WHERE slug = $1 AND is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`, [s.config.slug], db);
        if (!col) continue;
        const ids = (await query<any>('SELECT product_id FROM collection_items WHERE collection_id = $1 ORDER BY position LIMIT $2', [col.id, limit], db)).map((r) => r.product_id);
        data = { collection: col, items: await byIds(ids, db) };
        if (!data.items.length) continue; break;
      }
      case 'editorial': data = { articles: await query('SELECT slug, kind, title, excerpt, hero_image FROM articles WHERE status = \'published\' AND kind IN (\'recipe\',\'blog\',\'guide\') ORDER BY published_at DESC LIMIT $1', [limit], db) }; break;
      case 'shop_modes': case 'search': data = {}; break;
    }
    out.push({ id: s.id, kind: s.kind, title: s.title, subtitle: s.subtitle, config: s.config, data });
  }
  return out;
}

export async function saveHomepageSection(data: any, id: string | undefined, actor: Actor) {
  if (data.config?.source && data.kind === 'product_rail' && !HOME_SOURCES.includes(data.config.source)) throw badRequest('VALIDATION', 'Unknown product source.');
  const cols = ['kind', 'title', 'subtitle', 'config', 'position', 'is_active', 'starts_at', 'ends_at', 'segment_id'];
  if (id) {
    const after = await patch('homepage_sections', 'id', id, { ...data, updated_by: actor.userId }, [...cols, 'updated_by'], pool, ['config']);
    if (!after) throw notFound('That section');
    await audit(actor, 'homepage.updated', 'homepage_section', id, data);
    return after;
  }
  const row = await one<any>(
    `INSERT INTO homepage_sections(kind, title, subtitle, config, position, is_active, starts_at, ends_at, segment_id, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [data.kind, data.title ?? null, data.subtitle ?? null, JSON.stringify(data.config ?? {}), data.position ?? 0, data.is_active ?? true, data.starts_at ?? null, data.ends_at ?? null, data.segment_id ?? null, actor.userId]);
  await audit(actor, 'homepage.created', 'homepage_section', row.id, { kind: row.kind });
  return row;
}

// ---------------- content ----------------
export const articleInput = z.object({
  kind: z.enum(['blog', 'recipe', 'guide', 'faq', 'landing']), title: z.string().min(2).max(160), excerpt: z.string().max(400).optional().nullable(), body: z.string().max(60000).default(''),
  hero_image: z.string().max(500).optional().nullable(), recipe: z.object({ servings: z.number().int().min(1), prep_minutes: z.number().int().min(0), cook_minutes: z.number().int().min(0), steps: z.array(z.string()).default([]), cuisine: z.string().optional() }).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'), seo_title: z.string().max(120).optional().nullable(), seo_description: z.string().max(300).optional().nullable(),
  products: z.array(z.object({ product_id: z.guid(), label: z.string().max(120).optional(), quantity: z.number().int().min(1).default(1) })).default([]),
});
export async function saveArticle(data: z.infer<typeof articleInput>, id: string | undefined, actor: Actor) {
  return tx(async (c) => {
    let row: any;
    if (id) {
      const before = await one<any>('SELECT * FROM articles WHERE id = $1', [id], c);
      if (!before) throw notFound('That article');
      row = await one<any>(
        `UPDATE articles SET kind=$2, title=$3, excerpt=$4, body=$5, hero_image=$6, recipe=$7, status=$8, seo_title=$9, seo_description=$10, updated_at=now(),
                published_at = CASE WHEN $8 = 'published' THEN coalesce(published_at, now()) ELSE published_at END WHERE id=$1 RETURNING *`,
        [id, data.kind, data.title, data.excerpt ?? null, data.body, data.hero_image ?? null, data.recipe ? JSON.stringify(data.recipe) : null, data.status, data.seo_title ?? null, data.seo_description ?? null], c);
      await query('DELETE FROM article_products WHERE article_id = $1', [id], c);
    } else {
      row = await one<any>(
        `INSERT INTO articles(slug, kind, title, excerpt, body, hero_image, recipe, status, seo_title, seo_description, author_id, published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $8 = 'published' THEN now() END) RETURNING *`,
        [await uniqueSlug('articles', data.title, c), data.kind, data.title, data.excerpt ?? null, data.body, data.hero_image ?? null, data.recipe ? JSON.stringify(data.recipe) : null, data.status, data.seo_title ?? null, data.seo_description ?? null, actor.userId], c);
    }
    for (const [i, p] of data.products.entries()) await query('INSERT INTO article_products(article_id, product_id, label, quantity, position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [row.id, p.product_id, p.label ?? null, p.quantity, i], c);
    await audit(actor, id ? 'article.updated' : 'article.created', 'article', row.id, { title: row.title, status: row.status }, c);
    return row;
  });
}

export async function getArticle(slug: string, preview = false, db: Db = pool) {
  const a = await one<any>(`SELECT * FROM articles WHERE slug = $1 ${preview ? '' : "AND status = 'published'"}`, [slug], db);
  if (!a) throw notFound('That page');
  const prods = await query<any>('SELECT product_id, label, quantity FROM article_products WHERE article_id = $1 ORDER BY position', [a.id], db);
  const items = await byIds(prods.map((p) => p.product_id), db);
  return { ...a, ingredients: prods.map((p) => ({ ...p, product: items.find((i) => i.id === p.product_id) ?? null })) };
}
export { slugify, forbidden, AppError, getSetting, notify };
