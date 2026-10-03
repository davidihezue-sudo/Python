import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query, one, type Db, pool } from '../db.js';
import { config } from '../config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: any) => Promise<Buffer>;
const N = config.isTest ? 1024 : 16384;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), 32, { N: Number(n), r: 8, p: 1 });
  const expected = Buffer.from(hash, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters for your password.';
  if (!/[a-z]/i.test(pw) || !/[0-9]/.test(pw)) return 'Use a mix of letters and numbers in your password.';
  return null;
}

export async function createSession(userId: string, meta: { ip?: string; ua?: string }, db: Db = pool) {
  const token = randomToken();
  await query(
    `INSERT INTO sessions(user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4, $5)`,
    [userId, sha256(token), String(config.sessionTtlDays), meta.ip ?? null, meta.ua?.slice(0, 300) ?? null], db);
  return token;
}

export interface AuthCtx {
  user: { id: string; email: string; full_name: string; status: string; phone: string | null };
  sessionId: string;
  roles: string[];
  perms: Set<string>;
  memberships: { vendor_id: string; member_role: 'owner' | 'manager' | 'staff' }[];
}

export async function loadAuth(token: string | undefined): Promise<AuthCtx | null> {
  if (!token) return null;
  const s = await one<any>(
    `SELECT s.id AS session_id, u.id, u.email, u.full_name, u.status, u.phone
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`, [sha256(token)]);
  if (!s || s.status !== 'active') return null;
  const [roles, perms, memberships] = await Promise.all([
    query<{ key: string }>(`SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`, [s.id]),
    query<{ permission_key: string }>(
      `SELECT DISTINCT rp.permission_key FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`, [s.id]),
    query<any>(`SELECT vendor_id, member_role FROM vendor_users WHERE user_id = $1`, [s.id]),
  ]);
  query('UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval \'5 minutes\'', [s.session_id]).catch(() => {});
  return {
    user: { id: s.id, email: s.email, full_name: s.full_name, status: s.status, phone: s.phone },
    sessionId: s.session_id,
    roles: roles.map((r) => r.key),
    perms: new Set(perms.map((p) => p.permission_key)),
    memberships,
  };
}

export async function revokeSession(token: string) {
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
}
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)', [userId, exceptSessionId ?? null]);
}
