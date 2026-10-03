import { query, one, type Db, pool } from '../db.js';
import { publish } from './events.js';
import { enqueue } from './jobs.js';
import { send } from './providers.js';

// Default channel policy per kind. Users can override per kind in notification_preferences.
const POLICY: Record<string, { email: boolean; sms: boolean; push: boolean }> = {
  order_confirmed: { email: true, sms: false, push: true },
  vendor_accepted: { email: false, sms: false, push: true },
  order_ready: { email: false, sms: false, push: true },
  driver_assigned: { email: false, sms: false, push: true },
  driver_arriving: { email: false, sms: true, push: true },
  delivered: { email: true, sms: false, push: true },
  order_cancelled: { email: true, sms: false, push: true },
  refund_issued: { email: true, sms: false, push: true },
  promotion: { email: true, sms: false, push: true },
  support_update: { email: true, sms: false, push: true },
  new_order: { email: false, sms: true, push: true },
  low_inventory: { email: true, sms: false, push: false },
  document_expiry: { email: true, sms: false, push: false },
  payout: { email: true, sms: false, push: false },
  delivery_offer: { email: false, sms: false, push: true },
  password_reset: { email: true, sms: false, push: false },
  default: { email: false, sms: false, push: true },
};

export interface NotifyInput { userId: string; kind: string; title: string; body: string; data?: Record<string, any>; email?: boolean }

export async function notify(n: NotifyInput, db: Db = pool) {
  const row = await one<{ id: string }>(
    `INSERT INTO notifications(user_id, kind, title, body, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [n.userId, n.kind, n.title, n.body, JSON.stringify(n.data ?? {})], db);
  publish(`user:${n.userId}`, 'notification', { id: row!.id, kind: n.kind, title: n.title, body: n.body, data: n.data ?? {} });
  await enqueue('deliver_notification', { notificationId: row!.id }, { db });
  return row!.id;
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>, db: Db = pool) {
  for (const userId of new Set(userIds)) await notify({ ...input, userId }, db);
}
export async function vendorUserIds(vendorId: string, db: Db = pool): Promise<string[]> {
  return (await query<{ user_id: string }>('SELECT user_id FROM vendor_users WHERE vendor_id = $1', [vendorId], db)).map((r) => r.user_id);
}
export async function notifyVendor(vendorId: string, input: Omit<NotifyInput, 'userId'>, db: Db = pool) {
  await notifyMany(await vendorUserIds(vendorId, db), input, db);
}
export async function usersWithPermission(perm: string, db: Db = pool): Promise<string[]> {
  return (await query<{ user_id: string }>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE rp.permission_key = $1`, [perm], db)).map((r) => r.user_id);
}
export async function notifyStaff(perm: string, input: Omit<NotifyInput, 'userId'>, db: Db = pool) {
  await notifyMany(await usersWithPermission(perm, db), input, db);
}

/** Job handler: fan an in-app notification out to email / sms / push according to preferences. */
export async function deliverNotification(notificationId: string) {
  const n = await one<any>(
    `SELECT n.*, u.email, u.phone FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = $1`, [notificationId]);
  if (!n) return;
  const pol = POLICY[n.kind] ?? POLICY.default;
  const pref = await one<any>(
    `SELECT * FROM notification_preferences WHERE user_id = $1 AND kind IN ($2,'*') ORDER BY (kind = $2) DESC LIMIT 1`, [n.user_id, n.kind]);
  const ch = { email: pref?.email ?? pol.email, sms: pref?.sms ?? pol.sms, push: pref?.push ?? pol.push };
  if (ch.email && n.email) await send({ channel: 'email', to: n.email, userId: n.user_id, subject: n.title, body: n.body, data: n.data });
  if (ch.sms && n.phone) await send({ channel: 'sms', to: n.phone, userId: n.user_id, body: `${n.title}: ${n.body}`.slice(0, 300), data: n.data });
  if (ch.push) {
    const tokens = await query<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [n.user_id]);
    for (const t of tokens) await send({ channel: 'push', to: t.token, userId: n.user_id, subject: n.title, body: n.body, data: n.data });
  }
}
