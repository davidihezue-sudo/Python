// Accounts: registration, login, recovery, profile and saved addresses.
import { query, one, tx, type Db, pool } from '../db.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../errors.js';
import { hashPassword, verifyPassword, passwordProblem, createSession, revokeAllSessions, randomToken, sha256 } from '../lib/auth.js';
import { assignRole } from '../lib/rbac.js';
import { audit, type Actor } from '../lib/audit.js';
import { geocode } from '../lib/geo.js';
import { notify } from '../lib/notifications.js';
import { config } from '../config.js';
import { ensureReferralCode } from './loyalty.js';

export interface RegisterInput { email: string; password: string; full_name: string; phone?: string; marketing_opt_in?: boolean; referral_code?: string; device_fingerprint?: string }

export async function createUser(input: RegisterInput, roleKey: string, actor: Actor, db: Db = pool) {
  const email = input.email.trim().toLowerCase();
  const prob = passwordProblem(input.password);
  if (prob) throw badRequest('WEAK_PASSWORD', prob);
  const dupe = await one('SELECT 1 FROM users WHERE email = $1', [email], db);
  if (dupe) throw conflict('EMAIL_TAKEN', 'An account with that email already exists. Try signing in instead.');
  const hash = await hashPassword(input.password);
  let referrer: string | null = null;
  if (input.referral_code) referrer = (await one<any>('SELECT id FROM users WHERE referral_code = $1', [input.referral_code.trim().toUpperCase()], db))?.id ?? null;
  const user = (await one<any>(
    `INSERT INTO users(email, password_hash, full_name, phone, marketing_opt_in, referred_by, device_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, full_name`,
    [email, hash, input.full_name.trim(), input.phone ?? null, input.marketing_opt_in ?? false, referrer, input.device_fingerprint ?? null], db))!;
  await assignRole(user.id, roleKey, null, db);
  if (referrer) await query('INSERT INTO referrals(referrer_id, referred_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [referrer, user.id], db);
  await audit({ ...actor, userId: actor.userId ?? user.id }, 'user.created', 'user', user.id, { role: roleKey }, db);
  return user as { id: string; email: string; full_name: string };
}

export async function registerCustomer(input: RegisterInput, actor: Actor) {
  const u = await tx((c) => createUser(input, 'customer', actor, c));
  await ensureReferralCode(u.id);
  return u;
}

const MAX_FAILS = 5;
export async function login(email: string, password: string, meta: { ip?: string; ua?: string }) {
  const user = await one<any>('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email.trim().toLowerCase()]);
  const generic = new AppError('BAD_CREDENTIALS', 401, 'That email and password combination is not right. Please try again.');
  if (!user) { await hashPassword(password).catch(() => {}); throw generic; }   // keep timing similar
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw new AppError('LOCKED', 429, 'Too many attempts. Please wait a few minutes or reset your password.');
  if (!(await verifyPassword(password, user.password_hash))) {
    const fails = user.failed_logins + 1;
    await query('UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $2 >= $3 THEN now() + interval \'15 minutes\' END WHERE id = $1', [user.id, fails, MAX_FAILS]);
    throw generic;
  }
  if (user.status !== 'active') throw new AppError('SUSPENDED', 403, 'This account is not active. Please contact support.');
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const token = await createSession(user.id, meta);
  await audit({ userId: user.id, ip: meta.ip, ua: meta.ua }, 'user.login', 'user', user.id);
  return { token, userId: user.id as string };
}

export async function requestPasswordReset(email: string) {
  const user = await one<any>("SELECT id, email FROM users WHERE email = $1 AND status = 'active'", [email.trim().toLowerCase()]);
  if (!user) return; // never reveal whether an account exists
  const token = randomToken(24);
  await query("INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [user.id, sha256(token)]);
  await notify({ userId: user.id, kind: 'password_reset', title: 'Reset your EAZyfoods password', body: `Use this link within one hour: ${config.appUrl}/reset-password?token=${token}`, data: {} });
}
export async function confirmPasswordReset(token: string, password: string) {
  const prob = passwordProblem(password);
  if (prob) throw badRequest('WEAK_PASSWORD', prob);
  return tx(async (c) => {
    const r = await one<any>('SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE', [sha256(token)], c);
    if (!r) throw badRequest('BAD_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');
    await query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [r.user_id, await hashPassword(password)], c);
    await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id], c);
    await revokeAllSessions(r.user_id);
    await audit({ userId: r.user_id }, 'user.password_reset', 'user', r.user_id, null, c);
  });
}
export async function changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
  const u = await one<any>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw badRequest('BAD_CREDENTIALS', 'Your current password is not right.');
  const prob = passwordProblem(next);
  if (prob) throw badRequest('WEAK_PASSWORD', prob);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(next)]);
  await revokeAllSessions(userId, keepSessionId);
}

// ---- addresses ----
export interface AddressInput { label?: string; recipient_name?: string; phone?: string; line1: string; line2?: string; city: string; region: string; postal_code: string; country?: string; lat?: number; lng?: number; instructions?: string; is_default?: boolean }
export async function saveAddress(userId: string, input: AddressInput, id?: string) {
  let { lat, lng } = input;
  if (lat == null || lng == null) {
    const g = await geocode(input);
    if (!g) throw badRequest('ADDRESS_NOT_LOCATED', 'We could not locate that address. Please check the postal code.');
    lat = g.lat; lng = g.lng;
  }
  return tx(async (c) => {
    const count = (await one<any>('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1 AND deleted_at IS NULL', [userId], c))!.n;
    const makeDefault = input.is_default || count === 0;
    if (makeDefault) await query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId], c);
    const vals = [userId, input.label ?? 'Home', input.recipient_name ?? null, input.phone ?? null, input.line1, input.line2 ?? null, input.city, input.region.toUpperCase(), input.postal_code.toUpperCase().replace(/\s+/g, ' ').trim(), input.country ?? 'CA', lat, lng, input.instructions ?? null, makeDefault];
    if (id) {
      const r = await one<any>(
        `UPDATE addresses SET label=$2, recipient_name=$3, phone=$4, line1=$5, line2=$6, city=$7, region=$8, postal_code=$9, country=$10, lat=$11, lng=$12, instructions=$13, is_default=$14, updated_at=now()
         WHERE id = $15 AND user_id = $1 AND deleted_at IS NULL RETURNING *`, [...vals, id], c);
      if (!r) throw notFound('That address');
      return r;
    }
    return one<any>(
      `INSERT INTO addresses(user_id,label,recipient_name,phone,line1,line2,city,region,postal_code,country,lat,lng,instructions,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, vals, c);
  });
}
export async function deleteAddress(userId: string, id: string) {
  const r = await one<any>('UPDATE addresses SET deleted_at = now(), is_default = false WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id', [id, userId]);
  if (!r) throw notFound('That address');
}

/** Account deletion keeps order history for finance but removes personal details. */
export async function closeAccount(userId: string, actor: Actor) {
  await tx(async (c) => {
    const open = await one("SELECT 1 FROM orders WHERE user_id = $1 AND status IN ('pending_payment','confirmed','in_progress') LIMIT 1", [userId], c);
    if (open) throw conflict('OPEN_ORDERS', 'You have orders in progress. Please wait until they are delivered before closing your account.');
    await query("UPDATE users SET status = 'deleted', deleted_at = now(), email = 'deleted+' || id || '@eazyfoods.invalid', phone = NULL, full_name = 'Deleted user' WHERE id = $1", [userId], c);
    await query('UPDATE addresses SET deleted_at = now() WHERE user_id = $1', [userId], c);
    await revokeAllSessions(userId);
    await audit(actor, 'user.closed', 'user', userId, null, c);
  });
}
