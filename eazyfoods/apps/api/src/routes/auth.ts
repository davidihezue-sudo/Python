import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rl } from '../lib/limits.js';
import { parse, id } from '../lib/util.js';
import { query, one, tx } from '../db.js';
import { requireUser } from '../lib/rbac.js';
import { createUser, registerCustomer, login, requestPasswordReset, confirmPasswordReset, changePassword, closeAccount } from '../modules/accounts.js';
import { createVendor } from '../modules/vendors.js';
import { applyDriver } from '../modules/drivers.js';
import { revokeSession, createSession } from '../lib/auth.js';
import { mergeAnonCart } from '../modules/carts.js';
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE, CART_COOKIE } from '../app.js';
import { ensureReferralCode } from '../modules/loyalty.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { loyaltyStatus } from '../modules/loyalty.js';

const account = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), full_name: z.string().min(2).max(120), phone: z.string().min(7).max(30).optional(), marketing_opt_in: z.boolean().optional(), referral_code: z.string().max(20).optional(), device_fingerprint: z.string().max(100).optional() });
const business = z.object({
  seller_type: z.enum(['grocery', 'specialty', 'prepared', 'chef']), legal_name: z.string().min(2).max(160), trading_name: z.string().min(2).max(120), description: z.string().max(2000).optional(),
  email: z.string().email().optional(), phone: z.string().max(30).optional(), business_type: z.string().max(60).optional(), owner_name: z.string().max(120).optional(), tax_number: z.string().max(40).optional(),
  line1: z.string().max(200).optional(), line2: z.string().max(200).optional(), city: z.string().max(100).optional(), region: z.string().max(10).optional(), postal_code: z.string().max(12).optional(), country: z.string().max(2).optional(),
  cuisines: z.array(z.string().max(60)).max(10).optional(), accepts_delivery: z.boolean().optional(), accepts_pickup: z.boolean().optional(), uses_own_drivers: z.boolean().optional(),
  chef: z.object({ display_name: z.string().max(120).optional(), bio: z.string().max(2000).optional(), specialties: z.array(z.string()).max(10).optional(), daily_capacity: z.number().int().min(1).optional(), hourly_capacity: z.number().int().min(1).optional() }).optional(),
});
const driver = z.object({
  legal_name: z.string().min(2).max(120), phone: z.string().min(7).max(30), address_line1: z.string().max(200).optional(), city: z.string().max(100).optional(), region: z.string().max(10).optional(), postal_code: z.string().max(12).optional(),
  licence_number: z.string().max(40).optional(), licence_expiry: z.string().optional(),
  vehicle: z.object({ vehicle_type: z.enum(['car', 'bike', 'ebike', 'scooter', 'van']), make: z.string().optional(), model: z.string().optional(), year: z.number().int().optional(), colour: z.string().optional(), plate: z.string().optional(), insurance_expiry: z.string().optional(), has_cold_storage: z.boolean().optional() }).optional(),
});


const tight = rl(10);

export async function authRoutes(app: FastifyInstance) {
  const finish = async (req: any, reply: any, userId: string) => {
    const token = await createSession(userId, { ip: req.ip, ua: req.headers['user-agent'] });
    setSessionCookie(reply, token);
    const cart = req.cookies?.[CART_COOKIE];
    if (cart) { await mergeAnonCart(userId, cart).catch(() => {}); reply.clearCookie(CART_COOKIE, { path: '/' }); }
    return token;
  };

  app.post('/register', tight, async (req, reply) => {
    const b = parse(account, req.body);
    const u = await registerCustomer(b, req.actor);
    const token = await finish(req, reply, u.id);
    return reply.status(201).send({ user: { id: u.id, email: u.email, full_name: u.full_name }, token });
  });

  app.post('/register/vendor', tight, async (req, reply) => {
    const b = parse(z.object({ account, business }), req.body);
    const out = await tx(async (c) => {
      const u = await createUser(b.account, 'customer', req.actor, c);
      const v = await createVendor(u.id, b.business, { ...req.actor, userId: u.id }, c);
      return { u, v };
    });
    await ensureReferralCode(out.u.id);
    const token = await finish(req, reply, out.u.id);
    return reply.status(201).send({ user: { id: out.u.id }, vendor: { id: out.v.id, slug: out.v.slug, status: out.v.verification_status }, token });
  });
  app.post('/register/chef', tight, async (req, reply) => {
    const b = parse(z.object({ account, business: business.omit({ seller_type: true }) }), req.body);
    const out = await tx(async (c) => {
      const u = await createUser(b.account, 'customer', req.actor, c);
      const v = await createVendor(u.id, { ...b.business, seller_type: 'chef' }, { ...req.actor, userId: u.id }, c);
      return { u, v };
    });
    const token = await finish(req, reply, out.u.id);
    return reply.status(201).send({ user: { id: out.u.id }, vendor: { id: out.v.id, slug: out.v.slug, status: out.v.verification_status }, token });
  });
  app.post('/register/driver', tight, async (req, reply) => {
    const b = parse(z.object({ account, driver }), req.body);
    const u = await tx(async (c) => {
      const user = await createUser(b.account, 'customer', req.actor, c);
      await applyDriver(user.id, b.driver, { ...req.actor, userId: user.id }, c);
      return user;
    });
    const token = await finish(req, reply, u.id);
    return reply.status(201).send({ user: { id: u.id }, token });
  });

  // Existing customers can add a vendor, chef or driver profile to the same login.
  app.post('/apply/vendor', async (req, reply) => {
    const a = requireUser(req.auth);
    const b = parse(business, req.body);
    const v = await createVendor(a.user.id, b, req.actor);
    return reply.status(201).send({ vendor: { id: v.id, slug: v.slug, status: v.verification_status } });
  });
  app.post('/apply/driver', async (req, reply) => {
    const a = requireUser(req.auth);
    await applyDriver(a.user.id, parse(driver, req.body), req.actor);
    return reply.status(201).send({ ok: true });
  });

  app.post('/login', tight, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const r = await login(b.email, b.password, { ip: req.ip, ua: req.headers['user-agent'] });
    setSessionCookie(reply, r.token);
    const cart = req.cookies?.[CART_COOKIE];
    if (cart) { await mergeAnonCart(r.userId, cart).catch(() => {}); reply.clearCookie(CART_COOKIE, { path: '/' }); }
    return { token: r.token, userId: r.userId };
  });

  app.post('/logout', async (req, reply) => {
    const t = req.cookies?.[SESSION_COOKIE] ?? req.headers.authorization?.slice(7);
    if (t) await revokeSession(t);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const a = req.auth;
    if (!a) return { user: null };
    const [memberships, driver, cartCount, unread, profile] = await Promise.all([
      query<any>(`SELECT vu.vendor_id, vu.member_role, v.trading_name, v.slug, v.seller_type, v.verification_status FROM vendor_users vu JOIN vendors v ON v.id = vu.vendor_id WHERE vu.user_id = $1 AND v.deleted_at IS NULL`, [a.user.id]),
      one<any>('SELECT verification_status, availability, legal_name FROM driver_profiles WHERE user_id = $1', [a.user.id]),
      one<any>("SELECT coalesce(sum(i.quantity),0)::int AS n FROM carts c JOIN cart_items i ON i.cart_id = c.id WHERE c.user_id = $1 AND c.status = 'active'", [a.user.id]),
      one<any>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [a.user.id]),
      one<any>('SELECT phone, locale, marketing_opt_in, referral_code, email_verified_at FROM users WHERE id = $1', [a.user.id]),
    ]);
    return { user: { ...a.user, ...profile }, roles: a.roles, permissions: [...a.perms], memberships, driver, cartCount: cartCount.n, unreadNotifications: unread.n };
  });

  app.patch('/me', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ full_name: z.string().min(2).max(120).optional(), phone: z.string().min(7).max(30).nullable().optional(), marketing_opt_in: z.boolean().optional(), locale: z.enum(['en', 'fr']).optional() }), req.body);
    const r = await one<any>('UPDATE users SET full_name = coalesce($2, full_name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END, marketing_opt_in = coalesce($5, marketing_opt_in), locale = coalesce($6, locale) WHERE id = $1 RETURNING id, email, full_name, phone, marketing_opt_in, locale',
      [a.user.id, b.full_name ?? null, 'phone' in b, b.phone ?? null, b.marketing_opt_in ?? null, b.locale ?? null]);
    await audit(req.actor, 'user.updated', 'user', a.user.id, b);
    return { user: r };
  });

  app.post('/password/forgot', tight, async (req) => {
    await requestPasswordReset(parse(z.object({ email: z.string().email() }), req.body).email);
    return { ok: true, message: 'If an account exists for that email, we sent a reset link.' };
  });
  app.post('/password/reset', tight, async (req) => {
    const b = parse(z.object({ token: z.string().min(10), password: z.string().min(1) }), req.body);
    await confirmPasswordReset(b.token, b.password);
    return { ok: true };
  });
  app.post('/password/change', async (req) => {
    const a = requireUser(req.auth);
    const b = parse(z.object({ current_password: z.string(), new_password: z.string() }), req.body);
    await changePassword(a.user.id, b.current_password, b.new_password, a.sessionId);
    return { ok: true };
  });
  app.delete('/me', async (req, reply) => {
    const a = requireUser(req.auth);
    await closeAccount(a.user.id, req.actor);
    clearSessionCookie(reply);
    return { ok: true };
  });
  app.get('/sessions', async (req) => {
    const a = requireUser(req.auth);
    return { sessions: await query('SELECT id, ip, user_agent, created_at, last_seen_at, (id = $2) AS current FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC', [a.user.id, a.sessionId]) };
  });
  app.delete('/sessions/:id', async (req) => {
    const a = requireUser(req.auth);
    await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2', [parse(z.object({ id }), req.params).id, a.user.id]);
    return { ok: true };
  });
  void config; void loyaltyStatus;
}
