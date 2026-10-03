import { query, type Db, pool } from '../db.js';
import type { AuthCtx } from './auth.js';

export interface Actor { userId: string | null; role?: string | null; ip?: string | null; ua?: string | null; requestId?: string | null }
export const actorFrom = (a: AuthCtx | null | undefined, req?: { ip?: string; headers?: any; id?: string }): Actor => ({
  userId: a?.user.id ?? null,
  role: a ? (a.roles.find((r) => !['customer', 'vendor', 'chef', 'driver'].includes(r)) ?? a.roles[0] ?? null) : null,
  ip: req?.ip ?? null,
  ua: (req?.headers?.['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  requestId: req?.id ?? null,
});
export const SYSTEM: Actor = { userId: null, role: 'system' };

export async function audit(actor: Actor, action: string, entityType: string, entityId: string | null, changes: unknown = null, db: Db = pool) {
  await query(
    `INSERT INTO audit_logs(actor_user_id, actor_role, action, entity_type, entity_id, changes, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.userId, actor.role ?? null, action, entityType, entityId, changes === null ? null : JSON.stringify(changes), actor.ip ?? null, actor.ua ?? null, actor.requestId ?? null], db);
}

/** Shallow diff of two records for audit payloads. */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const out: Record<string, { from: any; to: any }> = {};
  for (const k of Object.keys(after)) if (JSON.stringify(before?.[k]) !== JSON.stringify(after[k])) out[k] = { from: before?.[k] ?? null, to: after[k] };
  return out;
}
