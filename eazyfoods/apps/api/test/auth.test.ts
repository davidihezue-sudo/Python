import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetDb, app as makeApp, closeAll, makeUser, makeStaff, makeCustomer, loginToken, bearer, query, one, PASSWORD, makeVendor, makeDriver } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { await resetDb(); app = await makeApp(); });
afterAll(async () => { await closeAll(app); });

const post = (url: string, payload: any, headers: any = {}) => app.inject({ method: 'POST', url, payload, headers });

describe('customer registration and login', () => {
  it('registers a customer, hashes the password and starts a session', async () => {
    const r = await post('/api/auth/register', { email: 'new@test.eazyfoods.test', password: 'Passw0rd!long', full_name: 'New Person', phone: '416-555-1212' });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.email).toBe('new@test.eazyfoods.test');
    expect(r.headers['set-cookie']).toContain('ez_session=');
    expect(String(r.headers['set-cookie'])).toContain('HttpOnly');
    const u = await one<any>("SELECT password_hash FROM users WHERE email = 'new@test.eazyfoods.test'");
    expect(u!.password_hash.startsWith('scrypt$')).toBe(true);
    expect(u!.password_hash).not.toContain('Passw0rd');
    const roles = await query("SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE u.email = 'new@test.eazyfoods.test'");
    expect(roles.map((r: any) => r.key)).toEqual(['customer']);
  });
  it('rejects weak passwords, duplicate emails and invalid input without leaking internals', async () => {
    expect((await post('/api/auth/register', { email: 'weak@test.eazyfoods.test', password: 'short1', full_name: 'Weak' })).statusCode).toBe(400);
    const dupe = await post('/api/auth/register', { email: 'NEW@test.eazyfoods.test', password: 'Passw0rd!long', full_name: 'Dup' });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error.code).toBe('EMAIL_TAKEN');
    const bad = await post('/api/auth/register', { email: 'not-an-email', password: 'x', full_name: '' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
    expect(JSON.stringify(bad.json())).not.toMatch(/sql|stack|constraint/i);
  });
  it('logs in, returns the profile and logs out', async () => {
    const login = await post('/api/auth/login', { email: 'new@test.eazyfoods.test', password: 'Passw0rd!long' });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(me.json().user.email).toBe('new@test.eazyfoods.test');
    expect(me.json().permissions).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) })).json().user).toBeNull();
  });
  it('uses one generic message for wrong passwords and unknown emails, and locks out after repeated failures', async () => {
    const a = await post('/api/auth/login', { email: 'new@test.eazyfoods.test', password: 'wrong-password' });
    const b = await post('/api/auth/login', { email: 'ghost@test.eazyfoods.test', password: 'wrong-password' });
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
    const u = await makeUser('customer', { email: 'lock@test.eazyfoods.test' });
    for (let i = 0; i < 5; i++) await post('/api/auth/login', { email: 'lock@test.eazyfoods.test', password: 'nope-nope-1' });
    const locked = await post('/api/auth/login', { email: 'lock@test.eazyfoods.test', password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(u.id).toBeTruthy();
  });
  it('blocks suspended accounts and revokes their sessions', async () => {
    const u = await makeUser('customer', { email: 'susp@test.eazyfoods.test' });
    const t = await loginToken('susp@test.eazyfoods.test');
    await query("UPDATE users SET status = 'suspended' WHERE id = $1", [u.id]);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(t) })).json().user).toBeNull();
    expect((await post('/api/auth/login', { email: 'susp@test.eazyfoods.test', password: PASSWORD })).statusCode).toBe(403);
  });
  it('supports password reset with a single use, expiring token that revokes old sessions', async () => {
    await makeUser('customer', { email: 'reset@test.eazyfoods.test' });
    const old = await loginToken('reset@test.eazyfoods.test');
    const unknown = await post('/api/auth/password/forgot', { email: 'nobody@test.eazyfoods.test' });
    expect(unknown.statusCode).toBe(200);                       // never reveals whether the account exists
    await post('/api/auth/password/forgot', { email: 'reset@test.eazyfoods.test' });
    const { runDueJobs } = await import('../src/lib/jobs.js');
    await runDueJobs();
    const mail = await one<any>("SELECT body FROM message_outbox WHERE recipient = 'reset@test.eazyfoods.test' AND channel = 'email' ORDER BY id DESC");
    const token = /token=([\w-]+)/.exec(mail!.body)![1];
    expect((await post('/api/auth/password/reset', { token, password: 'short' })).statusCode).toBe(400);
    expect((await post('/api/auth/password/reset', { token, password: 'BrandNew-pass9' })).statusCode).toBe(200);
    expect((await post('/api/auth/password/reset', { token, password: 'Another-pass9x' })).statusCode).toBe(400);   // used
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(old) })).json().user).toBeNull();
    expect((await post('/api/auth/login', { email: 'reset@test.eazyfoods.test', password: 'BrandNew-pass9' })).statusCode).toBe(200);
  });
  it('rejects cross origin writes and unknown origins', async () => {
    const r = await post('/api/auth/login', { email: 'x@test.eazyfoods.test', password: 'whatever-1' }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
  });
});

describe('vendor, chef and driver registration', () => {
  const account = (n: string) => ({ email: `${n}@test.eazyfoods.test`, password: 'Passw0rd!long', full_name: `${n} Person`, phone: '416-555-0100' });
  const biz = { seller_type: 'grocery', legal_name: 'Fresh Foods Ltd.', trading_name: 'Fresh Foods', line1: '1 King Street', city: 'Toronto', region: 'ON', postal_code: 'M5H 1J9', phone: '416-555-0100', email: 'biz@test.eazyfoods.test' };
  it('registers a vendor in draft state with an owner membership', async () => {
    const r = await post('/api/auth/register/vendor', { account: account('vend1'), business: biz });
    expect(r.statusCode).toBe(201);
    expect(r.json().vendor.status).toBe('draft');
    const m = await one<any>("SELECT member_role FROM vendor_users WHERE vendor_id = $1", [r.json().vendor.id]);
    expect(m!.member_role).toBe('owner');
  });
  it('registers a chef with a chef profile and capacity', async () => {
    const r = await post('/api/auth/register/chef', { account: account('chef1'), business: { ...biz, seller_type: undefined, trading_name: 'Chef One', legal_name: 'Chef One', chef: { display_name: 'Chef One', daily_capacity: 12 } } });
    expect(r.statusCode).toBe(201);
    const c = await one<any>('SELECT daily_capacity FROM chefs WHERE vendor_id = $1', [r.json().vendor.id]);
    expect(c!.daily_capacity).toBe(12);
  });
  it('registers a driver in draft state who cannot go online', async () => {
    const r = await post('/api/auth/register/driver', { account: account('drv1'), driver: { legal_name: 'Dee Driver', phone: '647-555-0101', vehicle: { vehicle_type: 'car' } } });
    expect(r.statusCode).toBe(201);
    const token = r.json().token;
    const on = await app.inject({ method: 'POST', url: '/api/drivers/me/availability', headers: bearer(token), payload: { online: true } });
    expect(on.statusCode).toBe(403);
    const sub = await app.inject({ method: 'POST', url: '/api/drivers/me/submit', headers: bearer(token) });
    expect(sub.statusCode).toBe(400);                             // documents are required before submission
    expect(sub.json().error.code).toBe('MISSING_DOCUMENTS');
  });
  it('rolls back everything when registration fails midway', async () => {
    const before = await one<any>('SELECT count(*)::int AS n FROM users');
    const r = await post('/api/auth/register/vendor', { account: account('vend2'), business: { ...biz, seller_type: 'bogus' } });
    expect(r.statusCode).toBe(400);
    expect((await one<any>('SELECT count(*)::int AS n FROM users'))!.n).toBe(before!.n);
  });
});

describe('authorization', () => {
  it('requires authentication on protected endpoints', async () => {
    for (const url of ['/api/orders', '/api/customers/me/addresses', '/api/admin/command-centre', '/api/drivers/me', '/api/tickets', '/api/notifications']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });
  it('never trusts client supplied role information', async () => {
    const c = await makeCustomer();
    const t = await loginToken((await one<any>('SELECT email FROM users WHERE id = $1', [c.id]))!.email);
    const spoof = await app.inject({ method: 'GET', url: '/api/admin/command-centre', headers: { ...bearer(t), 'x-role': 'super_admin', 'x-user-roles': 'super_admin' } });
    expect(spoof.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/audit', headers: bearer(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/marketing/promotions', headers: bearer(t), payload: {} })).statusCode).toBe(403);
  });
  it('gives each staff role only its permissions', async () => {
    const roles: Record<string, { allow: string[]; deny: string[] }> = {
      finance_admin: { allow: ['/api/admin/finance/summary', '/api/admin/finance/payouts'], deny: ['/api/admin/staff', '/api/marketing/promotions', '/api/admin/documents'] },
      marketing_manager: { allow: ['/api/marketing/promotions', '/api/marketing/homepage'], deny: ['/api/admin/finance/summary', '/api/admin/audit', '/api/admin/staff'] },
      customer_support: { allow: ['/api/admin/orders', '/api/tickets?scope=all'], deny: ['/api/admin/finance/payouts', '/api/admin/settings', '/api/marketing/homepage'] },
      driver_operations: { allow: ['/api/admin/drivers', '/api/admin/deliveries'], deny: ['/api/admin/vendors', '/api/admin/finance/summary'] },
      compliance_officer: { allow: ['/api/admin/documents', '/api/admin/compliance/rules'], deny: ['/api/admin/finance/summary', '/api/marketing/promotions'] },
      super_admin: { allow: ['/api/admin/staff', '/api/admin/roles', '/api/admin/audit', '/api/admin/settings'], deny: [] },
    };
    for (const [role, rules] of Object.entries(roles)) {
      const u = await makeStaff(role);
      const t = await loginToken(u.email);
      for (const url of rules.allow) expect((await app.inject({ method: 'GET', url, headers: bearer(t) })).statusCode, `${role} should access ${url}`).toBe(200);
      for (const url of rules.deny) expect((await app.inject({ method: 'GET', url, headers: bearer(t) })).statusCode, `${role} should not access ${url}`).toBe(403);
    }
  });
  it('isolates vendor data between stores', async () => {
    const a = await makeVendor({ name: 'Store A' }), b = await makeVendor({ name: 'Store B' });
    const ta = await loginToken(a.ownerEmail);
    expect((await app.inject({ method: 'GET', url: `/api/vendors/${a.id}/manage`, headers: bearer(ta) })).statusCode).toBe(200);
    for (const url of [`/api/vendors/${b.id}/manage`, `/api/vendors/${b.id}/orders`, `/api/vendors/${b.id}/inventory`, `/api/vendors/${b.id}/payouts`, `/api/vendors/${b.id}/analytics`]) {
      expect((await app.inject({ method: 'GET', url, headers: bearer(ta) })).statusCode, url).toBe(403);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/vendors/${b.id}/manage`, headers: bearer(ta), payload: { description: 'hijack' } })).statusCode).toBe(403);
  });
  it('limits vendor staff by team role', async () => {
    const v = await makeVendor();
    const staff = await makeUser('customer', { email: 'staffer@test.eazyfoods.test' });
    await query("INSERT INTO vendor_users(vendor_id, user_id, member_role) VALUES ($1,$2,'staff')", [v.id, staff.id]);
    const t = await loginToken('staffer@test.eazyfoods.test');
    expect((await app.inject({ method: 'GET', url: `/api/vendors/${v.id}/orders`, headers: bearer(t) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/vendors/${v.id}/payouts`, headers: bearer(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/vendors/${v.id}/products`, headers: bearer(t), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/vendors/${v.id}/team`, headers: bearer(t), payload: { email: 'x@y.co', role: 'staff' } })).statusCode).toBe(403);
  });
  it('does not let a driver without approval see jobs', async () => {
    const d = await makeDriver({ approved: false });
    const t = await loginToken(d.email);
    expect((await app.inject({ method: 'GET', url: '/api/drivers/me/offers', headers: bearer(t) })).statusCode).toBe(403);
  });
});
