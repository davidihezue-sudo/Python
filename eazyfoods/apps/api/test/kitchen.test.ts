import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeCustomer, makeVendor, makeProduct, makeStaff, makeDriver, loginToken, bearer, query, one } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });
const call = (method: string, url: string, token: string | null, payload?: any) => app.inject({ method: method as any, url, payload, headers: token ? bearer(token) : {} });

describe('chef kitchen: ingredients, recipes, costing and stock deduction', () => {
  it('calculates batch cost, serving cost, food cost percentage and margin', async () => {
    const chef = await makeVendor({ type: 'chef' });
    const t = await loginToken(chef.ownerEmail);
    const ing = async (name: string, unit: string, cost: number, stock: number) => (await call('POST', `/api/vendors/${chef.id}/ingredients`, t, { name, unit, cost_per_unit: cost, stock_qty: stock, reorder_threshold: 1 })).json().ingredient.id;
    const rice = await ing('Rice', 'kg', 4, 20), tomato = await ing('Tomato', 'kg', 3, 10), oil = await ing('Oil', 'l', 5, 3);
    expect((await call('POST', `/api/vendors/${chef.id}/ingredients`, t, { name: 'Rice', unit: 'kg', cost_per_unit: 1 })).statusCode).toBe(409);
    const dish = await makeProduct(chef.id, chef.ownerId, { name: 'Jollof', type: 'chef_meal', price: 18, tax: 'prepared' });
    const rec = await call('POST', `/api/vendors/${chef.id}/recipes`, t, { name: 'Jollof batch', product_id: dish.id, yield_servings: 10, prep_minutes: 20, cook_minutes: 60, selling_price: 18, steps: ['Fry', 'Cook'], ingredients: [{ ingredient_id: rice, quantity: 3 }, { ingredient_id: tomato, quantity: 2 }, { ingredient_id: oil, quantity: 0.5 }] });
    expect(rec.statusCode).toBe(201);
    const c = (await call('GET', `/api/vendors/${chef.id}/recipes/${rec.json().id}`, t)).json();
    expect(c.batch_cost).toBe(20.5);                    // 12 + 6 + 2.5
    expect(c.cost_per_serving).toBe(2.05);
    expect(c.food_cost_pct).toBe(11.4);
    expect(c.gross_margin).toBe(15.95);
    expect(c.gross_margin_pct).toBe(88.6);
    expect(c.total_minutes).toBe(80);
    expect(c.servings_possible).toBe(50);               // limited by tomatoes: 10 kg / 2 kg per batch = 5 batches x 10 servings
    const plan = (await call('POST', `/api/vendors/${chef.id}/recipes/${rec.json().id}/plan`, t, { batches: 8 })).json();
    expect(plan.servings).toBe(80);
    expect(plan.needs.find((n: any) => n.ingredient === 'Oil')).toMatchObject({ needed: 4, in_stock: 3, short: 1 });
    expect((await call('POST', `/api/vendors/${chef.id}/recipes`, t, { name: 'Bad', yield_servings: 0, ingredients: [{ ingredient_id: rice, quantity: 1 }] })).statusCode).toBe(400);
    const other = await makeVendor({ type: 'chef' });
    expect((await call('POST', `/api/vendors/${other.id}/recipes`, await loginToken(other.ownerEmail), { name: 'Steal', yield_servings: 1, ingredients: [{ ingredient_id: rice, quantity: 1 }] })).statusCode).toBe(400);   // another kitchen's ingredient
    expect((await call('GET', `/api/vendors/${other.id}/recipes/${rec.json().id}`, await loginToken(other.ownerEmail))).statusCode).toBe(404);
    expect((await call('GET', `/api/vendors/${chef.id}/recipes`, t)).json().recipes[0].food_cost_pct).toBe(11.4);
  });
  it('deducts ingredients when portions are sold if the chef opted in, and warns when stock runs low', async () => {
    const chef = await makeVendor({ type: 'chef', capacity: 50 });
    const t = await loginToken(chef.ownerEmail);
    const rice = (await call('POST', `/api/vendors/${chef.id}/ingredients`, t, { name: 'Rice', unit: 'kg', cost_per_unit: 4, stock_qty: 5, reorder_threshold: 3 })).json().ingredient.id;
    const dish = await makeProduct(chef.id, chef.ownerId, { name: 'Rice dish', type: 'chef_meal', price: 20, tax: 'prepared' });
    await call('POST', `/api/vendors/${chef.id}/recipes`, t, { name: 'Rice dish', product_id: dish.id, yield_servings: 4, selling_price: 20, deduct_ingredients: true, ingredients: [{ ingredient_id: rice, quantity: 2 }] });
    const c = await makeCustomer();
    const ct = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
    await call('POST', '/api/carts/items', ct, { variantId: dish.variantId, qty: 4 });
    await call('PATCH', '/api/carts/options', ct, { addressId: c.addressId });
    expect((await call('POST', '/api/checkout', ct, { idempotencyKey: 'kitchen-order-1', paymentToken: 'tok_visa' })).statusCode).toBe(201);
    expect(Number((await one<any>('SELECT stock_qty FROM ingredients WHERE id = $1', [rice]))!.stock_qty)).toBe(3);     // 4 portions = 1 batch = 2 kg
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'ingredient_shortage'", [chef.ownerId])).toBeTruthy();
    // a recipe that is not opted in leaves stock alone
    const dish2 = await makeProduct(chef.id, chef.ownerId, { name: 'Other dish', type: 'chef_meal', price: 12, tax: 'prepared' });
    await call('POST', `/api/vendors/${chef.id}/recipes`, t, { name: 'Other', product_id: dish2.id, yield_servings: 1, ingredients: [{ ingredient_id: rice, quantity: 1 }] });
    await call('POST', '/api/carts/items', ct, { variantId: dish2.variantId, qty: 1 });
    await call('POST', '/api/checkout', ct, { idempotencyKey: 'kitchen-order-2', paymentToken: 'tok_visa' });
    expect(Number((await one<any>('SELECT stock_qty FROM ingredients WHERE id = $1', [rice]))!.stock_qty)).toBe(3);
  });
  it('supports dish level capacity, portions per variant and hourly limits', async () => {
    const chef = await makeVendor({ type: 'chef', capacity: 100 });
    const dish = await makeProduct(chef.id, chef.ownerId, { name: 'Limited dish', type: 'chef_meal', price: 20, tax: 'prepared', cap: 2 });
    await query('UPDATE chefs SET hourly_capacity = 3 WHERE vendor_id = $1', [chef.id]);
    const place = async (qty: number) => {
      const c = await makeCustomer();
      const ct = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
      await call('POST', '/api/carts/items', ct, { variantId: dish.variantId, qty });
      await call('PATCH', '/api/carts/options', ct, { addressId: c.addressId });
      return call('POST', '/api/checkout', ct, { idempotencyKey: 'dish-cap-' + Math.random().toString(36).slice(2), paymentToken: 'tok_visa' });
    };
    expect((await place(2)).statusCode).toBe(201);
    const full = await place(1);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toMatch(/sold out for that day/);
  });
  it('enforces driver onboarding rules end to end: documents, review, then go online', async () => {
    const d = await makeDriver({ approved: false });
    const dt = await loginToken(d.email);
    const ops = await loginToken((await makeStaff('driver_operations')).email);
    expect((await call('GET', '/api/drivers/me', dt)).json().requirements.map((r: any) => r.doc_type)).toContain('drivers_licence');
    expect((await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'approve' })).statusCode).toBe(409);       // must be reviewed first
    expect((await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'request_documents' })).statusCode).toBe(400);
    await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'start_review' });
    const rq = await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'request_documents', note: 'Please upload a clearer licence photo' });
    expect(rq.statusCode).toBe(200);
    expect(await one("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'driver_status'", [d.id])).toBeTruthy();
    expect((await call('POST', '/api/drivers/me/submit', dt)).statusCode).toBe(200);
    await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'start_review' });
    expect((await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'approve' })).statusCode).toBe(200);
    expect((await call('POST', '/api/drivers/me/availability', dt, { online: true })).statusCode).toBe(200);
    expect((await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'suspend', note: 'Safety concern' })).statusCode).toBe(200);
    expect((await one<any>('SELECT availability FROM driver_profiles WHERE user_id = $1', [d.id]))!.availability).toBe('offline');   // suspension takes the driver offline
    expect((await call('POST', '/api/drivers/me/availability', dt, { online: true })).statusCode).toBe(403);
    expect((await call('POST', `/api/admin/drivers/${d.id}/review`, ops, { action: 'reactivate' })).statusCode).toBe(200);
    expect((await call('POST', '/api/drivers/me/availability', dt, { online: true })).statusCode).toBe(200);
  });
});
