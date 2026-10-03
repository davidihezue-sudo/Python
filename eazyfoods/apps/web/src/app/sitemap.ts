import type { MetadataRoute } from 'next';
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const base: MetadataRoute.Sitemap = ['', '/search', '/stores', '/chefs', '/recipes', '/faq', '/sell'].map((p) => ({ url: `${SITE}${p}`, lastModified: now, changeFrequency: 'daily', priority: p === '' ? 1 : 0.7 }));
  try {
    const r = await fetch(`${API}/api/seo/sitemap`, { cache: 'no-store' });
    const d = await r.json();
    const m = (rows: any[], f: (x: any) => string, pr: number): MetadataRoute.Sitemap => rows.map((x) => ({ url: `${SITE}${f(x)}`, lastModified: x.updated_at ? new Date(x.updated_at) : now, priority: pr }));
    return [...base, ...m(d.products, (x) => `/p/${x.slug}`, 0.8), ...m(d.stores, (x) => `/stores/${x.slug}`, 0.7), ...m(d.chefs, (x) => `/chefs/${x.slug}`, 0.7), ...m(d.categories, (x) => `/c/${x.slug}`, 0.7), ...m(d.articles, (x) => `/articles/${x.slug}`, 0.6), ...m(d.cuisines, (x) => `/cuisine/${encodeURIComponent(x.name)}`, 0.6)];
  } catch { return base; }
}
