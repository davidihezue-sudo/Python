import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { app as makeApp, closeAll, loginToken, bearer, query, one, PASSWORD } from './helpers.js';
import { reconcile } from '../src/modules/ledger.js';
import { clearSettingsCache } from '../src/lib/settings.js';

let app: FastifyInstance;
beforeAll(async () => { await migrate({ reset: true }); clearSettingsCache(); await seed({ force: true }); app = await makeApp(); }, 180000);
afterAll(async () => { await closeAll(app); });
const call = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? bearer(token) : {} });

describe('demo data', () => {
  it('creates a marketplace that looks alive and is internally consistent', async () => {
    const n = await one<any>(`SELECT (SELECT count(*)::int FROM users) users, (SELECT count(*)::int FROM vendors WHERE verification_status = 'approved') vendors, (SELECT count(*)::int FROM vendors WHERE seller_type = 'chef' AND verification_status = 'approved') chefs,
      (SELECT count(*)::int FROM products WHERE status = 'active') products, (SELECT count(DISTINCT product_type)::int FROM products) types, (SELECT count(*)::int FROM orders) orders, (SELECT count(*)::int FROM reviews) reviews,
      (SELECT count(*)::int FROM delivery_jobs) jobs, (SELECT count(*)::int FROM driver_profiles WHERE verification_status = 'approved') drivers, (SELECT count(*)::int FROM promotions) promos, (SELECT count(*)::int FROM promotions WHERE ends_at < now()) expired_promos`);
    expect(n.vendors).toBeGreaterThanOrEqual(4); expect(n.chefs).toBeGreaterThanOrEqual(3); expect(n.products).toBeGreaterThanOrEqual(60); expect(n.types).toBe(5);
    expect(n.orders).toBeGreaterThanOrEqual(40); expect(n.reviews).toBeGreaterThan(20); expect(n.jobs).toBeGreaterThan(30); expect(n.drivers).toBeGreaterThanOrEqual(5);
    expect(n.promos).toBeGreaterThanOrEqual(6); expect(n.expired_promos).toBeGreaterThanOrEqual(1);
    const rec = await reconcile();
    expect(rec.ok).toBe(true);
    const states = (await query<any>('SELECT DISTINCT status FROM suborders')).map((r: any) => r.status);
    for (const s of ['completed', 'confirmed', 'preparing', 'ready_for_pickup', 'in_transit', 'cancelled', 'partially_refunded', 'disputed']) expect(states).toContain(s);
    expect((await query<any>('SELECT DISTINCT status FROM payouts')).map((r: any) => r.status)).toEqual(expect.arrayContaining(['paid', 'pending', 'held']));
    expect((await one<any>("SELECT count(*)::int AS n FROM orders WHERE placed_at < now() - interval '30 days'"))!.n).toBeGreaterThan(3);
    // every order total equals the sum of its suborders and every item sums to the suborder
    const bad = await one<any>(`SELECT count(*)::int AS n FROM orders o WHERE abs(o.total - (SELECT coalesce(sum(customer_total),0) FROM suborders s WHERE s.order_id = o.id)) > 0.011`);
    expect(bad!.n).toBe(0);
    // seeded text never contains the banned em dash
    for (const [t, c] of [['products', 'description'], ['vendors', 'description'], ['articles', 'body'], ['notifications', 'body']] as const) {
      expect((await one<any>(`SELECT count(*)::int AS n FROM ${t} WHERE ${c} LIKE '%' || chr(8212) || '%'`))!.n).toBe(0);
    }
  });
  it('lets every demo persona sign in and see the right workspace', async () => {
    const who: [string, string, string][] = [
      ['amara@demo.eazyfoods.test', '/api/orders', 'orders'], ['admin@demo.eazyfoods.test', '/api/admin/command-centre', 'kpis'], ['finance@demo.eazyfoods.test', '/api/admin/finance/summary', 'reconciliation'],
      ['marketing@demo.eazyfoods.test', '/api/marketing/overview', 'promotions'], ['samuel@driver.demo.eazyfoods.test', '/api/drivers/me/earnings', 'earnings'], ['owner+nkechi@demo.eazyfoods.test', '/api/auth/me', 'memberships'],
    ];
    for (const [email, url, key] of who) {
      const t = await loginToken(email, PASSWORD);
      const r = await call(url, t);
      expect(r.statusCode, `${email} ${url}`).toBe(200);
      expect(r.json()).toHaveProperty(key);
    }
    const me = (await call('/api/auth/me', await loginToken('owner+nkechi@demo.eazyfoods.test', PASSWORD))).json();
    const v = me.memberships[0];
    const t = await loginToken('owner+nkechi@demo.eazyfoods.test', PASSWORD);
    const dash = (await call(`/api/vendors/${v.vendor_id}/analytics`, t)).json();
    expect(dash.orders).toBeGreaterThan(3); expect(dash.best_products.length).toBeGreaterThan(0); expect(dash.inventory.low_stock + dash.inventory.out_of_stock).toBeGreaterThan(0);
    const chefMe = (await call('/api/auth/me', await loginToken('owner+ada@demo.eazyfoods.test', PASSWORD))).json();
    expect((await call(`/api/vendors/${chefMe.memberships[0].vendor_id}/chef/capacity`, await loginToken('owner+ada@demo.eazyfoods.test', PASSWORD))).json().today.daily_capacity).toBe(30);
  });
  it('powers the public marketplace with dynamic sections and searchable catalog', async () => {
    const home = (await call('/api/home')).json().sections;
    expect(home.map((s: any) => s.kind)).toEqual(expect.arrayContaining(['hero', 'category_rail', 'product_rail', 'chef_rail', 'vendor_rail', 'collection', 'cuisine_grid', 'country_grid', 'banner']));
    expect(home.find((s: any) => s.kind === 'product_rail' && s.config.source === 'trending').data.items.length).toBeGreaterThan(3);
    expect((await call('/api/products?q=jolof')).json().items.some((i: any) => /jollof/i.test(i.name))).toBe(true);
    expect((await call('/api/products?q=ayamase')).json().items.length).toBeGreaterThan(0);                // synonym of designer stew, found through the chef dish
    expect((await call('/api/chefs')).json().items.length).toBeGreaterThanOrEqual(3);
    expect((await call('/api/stores')).json().items.length).toBeGreaterThanOrEqual(3);
    const recipe = (await call('/api/articles?kind=recipe')).json().articles[0];
    expect((await call(`/api/articles/${recipe.slug}`)).json().article.ingredients.length).toBeGreaterThan(2);
    expect((await call('/api/seo/sitemap')).json().products.length).toBeGreaterThan(50);
    const t = await loginToken('amara@demo.eazyfoods.test', PASSWORD);
    expect((await call('/api/customers/me/loyalty', t)).json().status.balance).toBeGreaterThan(0);
  });
});
