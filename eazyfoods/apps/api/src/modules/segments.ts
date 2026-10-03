// Customer segments are rules evaluated against real order data. Marketing sees counts, not people.
import { z } from 'zod';
import { query, one, pool, type Db } from '../db.js';
import { badRequest } from '../errors.js';

export const segmentRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('new_customers') }),
  z.object({ type: z.literal('returning'), min_orders: z.number().int().min(2).default(2) }),
  z.object({ type: z.literal('high_frequency'), days: z.number().int().min(1).default(30), min_orders: z.number().int().min(2).default(4) }),
  z.object({ type: z.literal('high_value'), days: z.number().int().min(1).default(90), min_spend: z.number().min(1).default(200) }),
  z.object({ type: z.literal('lapsed'), days: z.number().int().min(1).default(45) }),
  z.object({ type: z.literal('interest_groceries'), min_orders: z.number().int().min(1).default(2) }),
  z.object({ type: z.literal('interest_prepared'), min_orders: z.number().int().min(1).default(2) }),
  z.object({ type: z.literal('vendor_loyal'), vendor_id: z.guid(), min_orders: z.number().int().min(1).default(3) }),
]);
export type SegmentRule = z.infer<typeof segmentRule>;

const COUNTED = `o.status NOT IN ('pending_payment','cancelled')`;

/** Returns a SQL condition over alias u (users) and its params, numbering placeholders from `start`. */
export function segmentCondition(rule: SegmentRule, start = 1): { sql: string; params: any[] } {
  const orders = (extra = '') => `(SELECT count(*) FROM orders o WHERE o.user_id = u.id AND ${COUNTED} ${extra})`;
  switch (rule.type) {
    case 'all': return { sql: 'TRUE', params: [] };
    case 'new_customers': return { sql: `${orders()} = 0`, params: [] };
    case 'returning': return { sql: `${orders()} >= $${start}`, params: [rule.min_orders] };
    case 'high_frequency': return { sql: `${orders(`AND o.placed_at > now() - ($${start} || ' days')::interval`)} >= $${start + 1}`, params: [String(rule.days), rule.min_orders] };
    case 'high_value': return { sql: `(SELECT coalesce(sum(o.total),0) FROM orders o WHERE o.user_id = u.id AND ${COUNTED} AND o.placed_at > now() - ($${start} || ' days')::interval) >= $${start + 1}`, params: [String(rule.days), rule.min_spend] };
    case 'lapsed': return { sql: `${orders()} > 0 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND ${COUNTED} AND o.placed_at > now() - ($${start} || ' days')::interval)`, params: [String(rule.days)] };
    case 'interest_groceries':
      return { sql: `(SELECT count(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = u.id AND ${COUNTED} AND oi.product_type IN ('dry','fresh','frozen')) >= $${start}`, params: [rule.min_orders] };
    case 'interest_prepared':
      return { sql: `(SELECT count(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = u.id AND ${COUNTED} AND oi.product_type IN ('prepared','chef_meal')) >= $${start}`, params: [rule.min_orders] };
    case 'vendor_loyal':
      return { sql: `(SELECT count(*) FROM suborders s JOIN orders o ON o.id = s.order_id WHERE o.user_id = u.id AND s.vendor_id = $${start} AND s.status NOT IN ('pending_payment','cancelled')) >= $${start + 1}`, params: [rule.vendor_id, rule.min_orders] };
  }
}

export function validateRule(rule: unknown): SegmentRule {
  const r = segmentRule.safeParse(rule);
  if (!r.success) throw badRequest('INVALID_SEGMENT', 'That segment rule is not valid.');
  return r.data;
}

export async function segmentSize(rule: SegmentRule, db: Db = pool): Promise<number> {
  const c = segmentCondition(rule, 1);
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'customer'
      WHERE u.status = 'active' AND (${c.sql})`, c.params, db);
  return r!.n;
}

export async function userInSegment(userId: string, rule: SegmentRule, db: Db = pool): Promise<boolean> {
  const c = segmentCondition(rule, 2);
  return !!(await one(`SELECT 1 FROM users u WHERE u.id = $1 AND (${c.sql})`, [userId, ...c.params], db));
}

export async function userSegmentIds(userId: string, segmentIds: string[], db: Db = pool): Promise<Set<string>> {
  const out = new Set<string>();
  if (!segmentIds.length) return out;
  const segs = await query<any>('SELECT id, rule FROM segments WHERE id = ANY($1::uuid[])', [segmentIds], db);
  for (const s of segs) {
    const parsed = segmentRule.safeParse(s.rule);
    if (parsed.success && (await userInSegment(userId, parsed.data, db))) out.add(s.id);
  }
  return out;
}

/** Customer ids in a segment, used server side only for sending campaigns to opted in customers. */
export async function segmentMemberIds(rule: SegmentRule, optedInOnly: boolean, db: Db = pool): Promise<string[]> {
  const c = segmentCondition(rule, 1);
  return (await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.key = 'customer'
      WHERE u.status = 'active' ${optedInOnly ? 'AND u.marketing_opt_in' : ''} AND (${c.sql})`, c.params, db)).map((r) => r.id);
}
