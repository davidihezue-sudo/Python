import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeStaff, loginToken, bearer, query, one, setSetting, clearSettingsCache, SYSTEM, makeUser, makeDriver } from './helpers.js';
import { runDueJobs } from '../src/lib/jobs.js';
import { abandonedCartReminders } from '../src/jobs-registry.js';
import { redeemPoints, loyaltyStatus } from '../src/modules/loyalty.js';
import { recommend } from '../src/modules/recommendations.js';
import { segmentSize, userInSegment } from '../src/modules/segments.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });
const call = (method: string, url: string, token: string | null, payload?: any) => app.inject({ method: method as any, url, payload, headers: token ? bearer(token) : {} });
async function cust(over: { marketing?: boolean } = {}) {
  const c = await makeCustomer();
  const email = (await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email;
  if (over.marketing) await query('UPDATE users SET marketing_opt_in = true WHERE id = $1', [c.id]);
  return { ...c, email, token: await loginToken(email) };
}
async function buy(c: any, v: any, p: any, o: { qty?: number; coupon?: string; complete?: boolean } = {}) {
  await call('POST', '/api/carts/items', c.token, { variantId: p.variantId, qty: o.qty ?? 2 });
  await call('PATCH', '/api/carts/options', c.token, { fulfillment: { [v.id]: { mode: 'pickup' } }, couponCodes: o.coupon ? [o.coupon] : [] });
  const r = await call('POST', '/api/checkout', c.token, { idempotencyKey: 'mk-' + Math.random().toString(36).slice(2) + '-key', paymentToken: 'tok_visa' });
  expect(r.statusCode).toBe(201);
  const sub = (await one<any>('SELECT * FROM suborders WHERE order_id = $1', [r.json().orderId]))!;
  if (o.complete !== false) {
    const vt = await loginToken(v.ownerEmail);
    for (const a of ['accept', 'prepare', 'ready']) await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/${a}`, vt, {});
    await call('POST', `/api/vendors/${v.id}/orders/${sub.id}/collect`, vt, { code: sub.pickup_code });
  }
  return { orderId: r.json().orderId as string, sub };
}

describe('promotions management', () => {
  it('validates promotion definitions and prevents invalid ones', async () => {
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const make = (b: any) => call('POST', '/api/marketing/promotions', m, { name: 'Promo P', status: 'active', auto_apply: true, ...b });
    expect((await make({ type: 'percent', value: 150 })).statusCode).toBe(400);
    expect((await make({ type: 'percent', value: 0 })).statusCode).toBe(400);
    expect((await make({ type: 'fixed', value: 0 })).statusCode).toBe(400);
    expect((await make({ type: 'percent', value: 10, starts_at: '2026-05-01', ends_at: '2026-04-01' })).statusCode).toBe(400);
    expect((await make({ type: 'bogo', config: { buy_qty: 0 } })).statusCode).toBe(400);
    expect((await make({ type: 'spend_get', config: { spend: 20 } })).statusCode).toBe(400);
    expect((await make({ type: 'percent', value: 10, auto_apply: false, code: 'bad code!' })).statusCode).toBe(400);
    expect((await make({ type: 'percent', value: 10, auto_apply: false, code: null })).statusCode).toBe(400);              // no code and not automatic
    expect((await make({ type: 'percent', value: 10, auto_apply: false, code: 'dup1' })).statusCode).toBe(201);
    expect((await make({ type: 'percent', value: 12, auto_apply: false, code: 'DUP1' })).json().error.code).toBe('CODE_IN_USE');
    expect(await one("SELECT code FROM promotions WHERE name = 'Promo P' LIMIT 1")).toMatchObject({ code: 'DUP1' });
    expect((await one<any>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'promotion.created'"))!.n).toBeGreaterThan(0);
  });
  it('lets vendors run promotions only on their own products and funds them themselves', async () => {
    const v = await makeVendor();
    const vt = await loginToken(v.ownerEmail);
    const other = await makeVendor();
    const r = await call('POST', `/api/vendors/${v.id}/promotions`, vt, { name: 'Mine', code: 'MINE5', type: 'percent', value: 5, status: 'active', auto_apply: false, funded_by: 'platform', stackable: true, scope: { vendor_ids: [other.id] } });
    expect(r.statusCode).toBe(201);
    const row = await one<any>("SELECT vendor_id, funded_by, stackable, scope FROM promotions WHERE code = 'MINE5'");
    expect(row).toMatchObject({ vendor_id: v.id, funded_by: 'vendor', stackable: false });
    expect(row!.scope.vendor_ids).toEqual([v.id]);                                                 // cannot be pointed at a competitor
    expect((await call('PUT', `/api/vendors/${other.id}/promotions/${r.json().promotion.id}`, await loginToken(other.ownerEmail), { name: 'Hijack', type: 'percent', value: 5 })).statusCode).toBe(404);
    const p = await makeProduct(other.id, other.ownerId, { price: 40, stock: 10, tax: 'zero_rated' });
    const c = await cust();
    await call('POST', '/api/carts/items', c.token, { variantId: p.variantId, qty: 1 });
    await call('PATCH', '/api/carts/options', c.token, { addressId: c.addressId, couponCodes: ['MINE5'] });
    expect((await call('GET', '/api/carts/current', c.token)).json().cart.quote.totals.discount).toBe(0);   // does not apply to another store's items
  });
  it('shows promotion performance and the marketing overview from real redemptions', async () => {
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 40, stock: 50, tax: 'zero_rated' });
    const pr = await call('POST', '/api/marketing/promotions', m, { name: 'Stats', code: 'STATS10', type: 'percent', value: 10, status: 'active', auto_apply: false });
    const c = await cust();
    await buy(c, v, p, { coupon: 'STATS10' });
    const stats = (await call('GET', `/api/marketing/promotions/${pr.json().promotion.id}/stats`, m)).json().stats;
    expect(stats.redemptions).toBe(1);
    expect(Number(stats.discount_cost)).toBeCloseTo(8, 2);
    const ov = (await call('GET', '/api/marketing/overview', m)).json();
    expect(ov.top_promotions[0].redemptions).toBeGreaterThanOrEqual(1);
  });
});

describe('homepage and content without code changes', () => {
  it('builds the homepage from configurable sections that marketing can reorder, hide and schedule', async () => {
    const v = await makeVendor(); await makeProduct(v.id, v.ownerId, { name: 'Trending Item', price: 9, stock: 10 });
    await query("UPDATE products SET popularity = 9999 WHERE name = 'Trending Item'");
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const s1 = (await call('POST', '/api/marketing/homepage', m, { kind: 'product_rail', title: 'Trending', config: { source: 'trending', limit: 4 }, position: 20 })).json().section;
    const s2 = (await call('POST', '/api/marketing/homepage', m, { kind: 'vendor_rail', title: 'Stores', position: 10 })).json().section;
    const home = async () => (await call('GET', '/api/home', null)).json().sections;
    expect((await home()).map((s: any) => s.title)).toEqual(['Stores', 'Trending']);
    expect((await home())[1].data.items[0].name).toBe('Trending Item');
    await call('POST', '/api/marketing/homepage/reorder', m, { order: [s1.id, s2.id] });
    expect((await home()).map((s: any) => s.title)).toEqual(['Trending', 'Stores']);
    await call('PUT', `/api/marketing/homepage/${s1.id}`, m, { is_active: false });
    expect((await home()).map((s: any) => s.title)).toEqual(['Stores']);
    await call('PUT', `/api/marketing/homepage/${s1.id}`, m, { is_active: true, starts_at: new Date(Date.now() + 86400000).toISOString() });
    expect((await home()).map((s: any) => s.title)).toEqual(['Stores']);                           // scheduled for tomorrow
    expect((await call('POST', '/api/marketing/homepage', m, { kind: 'product_rail', config: { source: 'nonsense' } })).statusCode).toBe(400);
    const support = await loginToken((await makeStaff('customer_support')).email);
    expect((await call('POST', '/api/marketing/homepage', support, { kind: 'hero' })).statusCode).toBe(403);
    expect(await one("SELECT 1 FROM audit_logs WHERE action = 'homepage.reordered'")).toBeTruthy();
  });
  it('serves ads only inside their window and budget and counts impressions, clicks and spend', async () => {
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const ad = (await call('POST', '/api/marketing/ads', m, { placement_key: 'homepage_banner', title: 'Sponsored', click_url: '/stores', advertiser_type: 'external', advertiser_name: 'Acme Spices', status: 'active', cost_model: 'cpc', rate: 0.5, budget: 1 })).json().ad;
    expect((await call('GET', '/api/ads?placement=homepage_banner', null)).json().ads[0]).toMatchObject({ title: 'Sponsored', sponsored: true });
    expect((await call('POST', '/api/marketing/ads', m, { placement_key: 'homepage_banner', title: 'Bad', click_url: 'javascript:alert(1)', status: 'active' })).statusCode).toBe(400);
    expect((await call('POST', '/api/marketing/ads', m, { placement_key: 'homepage_banner', title: 'Bad', click_url: '//evil.example', status: 'active' })).statusCode).toBe(400);
    await call('POST', `/api/ads/${ad.id}/impression`, null);
    const click = await app.inject({ method: 'GET', url: `/api/ads/${ad.id}/click` });
    expect(click.statusCode).toBe(302); expect(click.headers.location).toBe('/stores');
    await app.inject({ method: 'GET', url: `/api/ads/${ad.id}/click` });
    const row = await one<any>('SELECT impressions, clicks, spent, status FROM ads WHERE id = $1', [ad.id]);
    expect(row).toMatchObject({ impressions: 1, clicks: 2, status: 'ended' });                      // 2 clicks x $0.50 exhausts the $1 budget
    expect(Number(row!.spent)).toBe(1);
    expect((await call('GET', '/api/ads?placement=homepage_banner', null)).json().ads).toHaveLength(0);
    await call('PUT', `/api/marketing/ads/${(await one<any>("SELECT id FROM ads WHERE title = 'Sponsored'"))!.id}`, m, { status: 'active', budget: 100 });
    expect((await call('GET', '/api/ads?placement=homepage_banner', null)).json().ads).toHaveLength(1);
  });
  it('measures campaigns from real events and orders', async () => {
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 40, stock: 50, tax: 'zero_rated' });
    const promo = (await call('POST', '/api/marketing/promotions', m, { name: 'Camp', code: 'CAMP10', type: 'percent', value: 10, status: 'active', auto_apply: false })).json().promotion;
    const camp = (await call('POST', '/api/marketing/campaigns', m, { name: 'Spring', promotion_id: promo.id, status: 'active', starts_at: new Date(Date.now() - 3600000).toISOString() })).json().campaign;
    const ad = (await call('POST', '/api/marketing/ads', m, { placement_key: 'homepage_hero', campaign_id: camp.id, title: 'Spring', click_url: '/c/spring', status: 'active' })).json().ad;
    for (let i = 0; i < 10; i++) await call('POST', `/api/ads/${ad.id}/impression`, null);
    for (let i = 0; i < 2; i++) await app.inject({ method: 'GET', url: `/api/ads/${ad.id}/click` });
    await buy(await cust(), v, p, { coupon: 'CAMP10' });
    const metrics = (await call('GET', `/api/marketing/campaigns/${camp.id}/metrics`, m)).json();
    expect(metrics).toMatchObject({ impressions: 10, clicks: 2, orders: 1, ctr: 20 });
    expect(metrics.revenue).toBeGreaterThan(0); expect(metrics.discount_cost).toBeCloseTo(8, 2); expect(metrics.conversion_rate).toBe(50);
    expect((await call('POST', '/api/marketing/campaigns', m, { name: 'Bad', starts_at: '2026-05-01', ends_at: '2026-04-01' })).statusCode).toBe(400);
  });
  it('publishes recipes and articles whose ingredients link to real products', async () => {
    const c = await loginToken((await makeStaff('content_manager')).email);
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { name: 'Palm Oil', price: 8, stock: 5 });
    const a = await call('POST', '/api/marketing/articles', c, { kind: 'recipe', title: 'Jollof Rice', body: 'Cook it.', status: 'published', recipe: { servings: 4, prep_minutes: 10, cook_minutes: 40, steps: ['Fry', 'Simmer'] }, products: [{ product_id: p.id, label: 'Palm oil', quantity: 1 }] });
    expect(a.statusCode).toBe(201);
    const pub = (await call('GET', `/api/articles/${a.json().article.slug}`, null)).json().article;
    expect(pub.ingredients[0].product.name).toBe('Palm Oil');
    expect(pub.ingredients[0].product.default_variant_id).toBe(p.variantId);
    expect((await call('GET', `/api/products/${p.slug}`, null)).json().product.recipes[0].title).toBe('Jollof Rice');
    const draft = (await call('POST', '/api/marketing/articles', c, { kind: 'blog', title: 'Draft only', status: 'draft' })).json().article;
    expect((await call('GET', `/api/articles/${draft.slug}`, null)).statusCode).toBe(404);
    expect((await call('GET', '/api/articles?kind=recipe', null)).json().articles.map((x: any) => x.title)).toContain('Jollof Rice');
  });
});

describe('segments and abandoned carts', () => {
  it('builds segments from real order data and only exposes counts to marketing', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 30, stock: 100, tax: 'zero_rated' });
    const fresh = await cust(), repeat = await cust(), lapsed = await cust();
    await buy(repeat, v, p); await buy(repeat, v, p);
    await buy(lapsed, v, p);
    await query("UPDATE orders SET placed_at = now() - interval '90 days' WHERE user_id = $1", [lapsed.id]);
    expect(await userInSegment(fresh.id, { type: 'new_customers' })).toBe(true);
    expect(await userInSegment(repeat.id, { type: 'new_customers' })).toBe(false);
    expect(await userInSegment(repeat.id, { type: 'returning', min_orders: 2 })).toBe(true);
    expect(await userInSegment(lapsed.id, { type: 'lapsed', days: 45 })).toBe(true);
    expect(await userInSegment(repeat.id, { type: 'lapsed', days: 45 })).toBe(false);
    expect(await userInSegment(repeat.id, { type: 'high_value', days: 30, min_spend: 100 })).toBe(true);
    expect(await userInSegment(repeat.id, { type: 'vendor_loyal', vendor_id: v.id, min_orders: 2 })).toBe(true);
    expect(await userInSegment(repeat.id, { type: 'interest_groceries', min_orders: 2 })).toBe(true);
    expect(await segmentSize({ type: 'lapsed', days: 45 })).toBeGreaterThanOrEqual(1);
    const m = await loginToken((await makeStaff('marketing_manager')).email);
    const seg = await call('POST', '/api/marketing/segments', m, { name: 'Lapsed', rule: { type: 'lapsed', days: 45 } });
    expect(seg.statusCode).toBe(201);
    const list = (await call('GET', '/api/marketing/segments', m)).json().segments;
    expect(list[0]).toHaveProperty('size');
    expect(JSON.stringify(list)).not.toMatch(/@test|user_id|email/);                               // counts only, no personal data
    expect((await call('POST', '/api/marketing/segments', m, { name: 'Bad', rule: { type: 'drop_tables' } })).statusCode).toBe(400);
    // a segment targeted promotion only works for its members
    await call('POST', '/api/marketing/promotions', m, { name: 'Back', code: 'BACK15', type: 'percent', value: 15, status: 'active', auto_apply: false, segment_id: seg.json().segment.id });
    for (const [who, expected] of [[lapsed, 4.5], [repeat, 0]] as const) {
      await call('POST', '/api/carts/items', who.token, { variantId: p.variantId, qty: 1 });
      await call('PATCH', '/api/carts/options', who.token, { couponCodes: ['BACK15'], fulfillment: { [v.id]: { mode: 'pickup' } } });
      expect((await call('GET', '/api/carts/current', who.token)).json().cart.quote.totals.discount).toBeCloseTo(expected, 2);
    }
    expect((await call('DELETE', `/api/marketing/segments/${seg.json().segment.id}`, m)).statusCode).toBe(400);      // in use
  });
  it('sends a limited number of abandoned cart reminders, only to opted in customers', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 10, stock: 100 });
    const optIn = await cust({ marketing: true }), optOut = await cust(), buyer = await cust({ marketing: true });
    for (const c of [optIn, optOut, buyer]) await call('POST', '/api/carts/items', c.token, { variantId: p.variantId, qty: 1 });
    await query("UPDATE carts SET last_activity_at = now() - interval '3 hours'");
    expect(await abandonedCartReminders()).toBe(2);                                                  // opted out customer is skipped
    expect(await abandonedCartReminders()).toBe(0);                                                  // gap hours prevent spamming
    await query("UPDATE carts SET last_reminder_at = now() - interval '2 days'");
    expect(await abandonedCartReminders()).toBe(2);
    await query("UPDATE carts SET last_reminder_at = now() - interval '4 days'");
    expect(await abandonedCartReminders()).toBe(0);                                                  // maximum of 2 reminders
    const msgs = await query<any>("SELECT user_id FROM notifications WHERE title = 'You left something in your cart'");
    expect(msgs.filter((m: any) => m.user_id === optOut.id)).toHaveLength(0);
    await setSetting('abandoned_cart', { enabled: false }, null);
    try { await query('UPDATE carts SET reminders_sent = 0'); expect(await abandonedCartReminders()).toBe(0); } finally { await setSetting('abandoned_cart', { enabled: true }, null); clearSettingsCache(); }
    // a customer who bought after leaving the cart is not reminded
    await query("UPDATE carts SET reminders_sent = 0, last_reminder_at = NULL, last_activity_at = now() - interval '5 hours' WHERE user_id = $1", [buyer.id]);
    await query("INSERT INTO orders(number, user_id, subtotal, total, amount_charged) VALUES ('X-1', $1, 1, 1, 1)", [buyer.id]);
    const before = (await query("SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'You left something in your cart'", [buyer.id])).length;
    await abandonedCartReminders();
    expect((await query("SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'You left something in your cart'", [buyer.id])).length).toBe(before);
  });
});

describe('loyalty, credit and referrals', () => {
  it('earns points on completed orders, redeems them for credit and keeps rules configurable', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 50, stock: 100, tax: 'zero_rated' });
    const c = await cust();
    await buy(c, v, p, { qty: 2 });
    let st = await loyaltyStatus(c.id);
    expect(st).toMatchObject({ balance: 100, lifetime: 100, tier: 'bronze' });
    await buy(c, v, p, { qty: 2 }); await buy(c, v, p, { qty: 2 }); await buy(c, v, p, { qty: 2 }); await buy(c, v, p, { qty: 2 });
    st = await loyaltyStatus(c.id);
    expect(st.balance).toBe(500); expect(st.tier).toBe('silver'); expect(st.nextTier?.key).toBe('gold');
    await expect(redeemPoints(c.id, 150)).rejects.toMatchObject({ code: 'VALIDATION' });         // must be multiples of the redeem unit
    await expect(redeemPoints(c.id, 600)).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    const r = await redeemPoints(c.id, 300);
    expect(r.credit).toBe(3);
    expect((await loyaltyStatus(c.id)).balance).toBe(200);
    expect(Number((await one<any>('SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1', [c.id]))!.b)).toBe(3);
    expect(await one("SELECT 1 FROM ledger_entries WHERE entry_type = 'credit_grant' AND account = 'liability_customer_credit' AND party_id = $1", [c.id])).toBeTruthy();
    await setSetting('loyalty', { points_per_dollar: 2 }, null);
    try { await buy(c, v, p, { qty: 1 }); expect((await loyaltyStatus(c.id)).balance).toBe(300); } finally { await setSetting('loyalty', { points_per_dollar: 1 }, null); clearSettingsCache(); }
  });
  it('rewards both sides of a legitimate referral once and rejects self dealing', async () => {
    const v = await makeVendor(); const p = await makeProduct(v.id, v.ownerId, { price: 40, stock: 100, tax: 'zero_rated' });
    const referrer = await cust();
    const code = (await call('GET', '/api/customers/me/loyalty', referrer.token)).json().referral.code;
    expect(code).toMatch(/^EAZ/);
    const reg = await call('POST', '/api/auth/register', null, { email: 'friend@test.eazyfoods.test', password: 'Passw0rd!long', full_name: 'Friend Person', referral_code: code });
    expect(reg.statusCode, reg.body).toBe(201);
    const friendToken = reg.json().token;
    const friend = { id: reg.json().user.id, token: friendToken };
    const fa = await call('POST', '/api/customers/me/addresses', friendToken, { line1: '5 Elm Street', city: 'Toronto', region: 'ON', postal_code: 'M4W 1A1' });
    expect(fa.statusCode).toBe(201);
    expect((await one<any>('SELECT status FROM referrals WHERE referred_id = $1', [friend.id]))!.status).toBe('pending');
    await buy(friend, v, p, { qty: 1 });                                                           // $40 meets the $25 minimum
    expect((await one<any>('SELECT status, reward_amount FROM referrals WHERE referred_id = $1', [friend.id]))).toMatchObject({ status: 'rewarded', reward_amount: 10 });
    for (const uid of [referrer.id, friend.id]) expect(Number((await one<any>("SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1 AND reason LIKE '%reward%'", [uid]))!.b)).toBe(10);
    await buy(friend, v, p, { qty: 1 });
    expect(Number((await one<any>("SELECT coalesce(sum(amount),0) AS b FROM customer_credit_entries WHERE user_id = $1 AND reason LIKE '%reward%'", [referrer.id]))!.b)).toBe(10);   // rewarded only once
    // same phone number as the referrer: rejected and raised for review
    const cheat = await call('POST', '/api/auth/register', null, { email: 'cheat@test.eazyfoods.test', password: 'Passw0rd!long', full_name: 'Cheat Person', phone: (await one<any>('SELECT phone FROM users WHERE id = $1', [referrer.id]))!.phone, referral_code: code });
    await call('POST', '/api/customers/me/addresses', cheat.json().token, { line1: '9 Oak Street', city: 'Toronto', region: 'ON', postal_code: 'M4W 1A1' });
    await buy({ id: cheat.json().user.id, token: cheat.json().token }, v, p, { qty: 1 });
    expect(await one<any>('SELECT status FROM referrals WHERE referred_id = $1', [cheat.json().user.id])).toMatchObject({ status: 'rejected' });
    expect(await one("SELECT 1 FROM risk_signals WHERE kind = 'referral_self_dealing'")).toBeTruthy();
  });
  it('recommends from real purchase history with a reason, and never an out of stock item', async () => {
    const v = await makeVendor();
    const rice = await makeProduct(v.id, v.ownerId, { name: 'Rice X', price: 20, stock: 50, tax: 'zero_rated' });
    const oil = await makeProduct(v.id, v.ownerId, { name: 'Oil X', price: 10, stock: 50, tax: 'zero_rated' });
    const gone = await makeProduct(v.id, v.ownerId, { name: 'Gone X', price: 10, stock: 0, tax: 'zero_rated' });
    for (let i = 0; i < 3; i++) {
      const c = await cust();
      await call('POST', '/api/carts/items', c.token, { variantId: rice.variantId, qty: 1 }); await call('POST', '/api/carts/items', c.token, { variantId: oil.variantId, qty: 1 });
      await call('PATCH', '/api/carts/options', c.token, { fulfillment: { [v.id]: { mode: 'pickup' } } });
      await call('POST', '/api/checkout', c.token, { idempotencyKey: 'rec-' + i + '-' + Math.random().toString(36).slice(2), paymentToken: 'tok_visa' });
    }
    const recs = await recommend({ seedProductIds: [rice.id], limit: 5 });
    expect(recs[0]).toMatchObject({ name: 'Oil X' });
    expect(recs[0].reason).toContain('Often bought with');
    expect(recs.map((r) => r.name)).not.toContain('Gone X');
    expect(recs.map((r) => r.name)).not.toContain('Rice X');
    const api = (await call('GET', `/api/products/${rice.slug}/recommendations`, null)).json();
    expect(api.bought_together[0].name).toBe('Oil X');
    void gone;
  });
});
