// Vendor and chef lifecycle: application, onboarding, verification, hours, team.
import { query, one, tx, type Db, pool } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { assertVerification, type VendorVerification } from '../lib/states.js';
import { getSetting } from '../lib/settings.js';
import { geocode } from '../lib/geo.js';
import { notifyVendor, notifyStaff } from '../lib/notifications.js';
import { assignRole } from '../lib/rbac.js';
import { audit, diff, type Actor } from '../lib/audit.js';
import { uniqueSlug, patch } from '../lib/util.js';
import { jurisdictionFor, missingDocuments } from './compliance.js';

export interface VendorApplication {
  seller_type: 'grocery' | 'specialty' | 'prepared' | 'chef';
  legal_name: string; trading_name: string; description?: string; email?: string; phone?: string;
  business_type?: string; owner_name?: string; tax_number?: string;
  line1?: string; line2?: string; city?: string; region?: string; postal_code?: string; country?: string; lat?: number; lng?: number;
  cuisines?: string[]; accepts_delivery?: boolean; accepts_pickup?: boolean; uses_own_drivers?: boolean;
  chef?: { display_name?: string; bio?: string; specialties?: string[]; daily_capacity?: number; hourly_capacity?: number };
}

export async function createVendor(userId: string, a: VendorApplication, actor: Actor, db?: Db) {
  const run = async (c: any) => {
    const slug = await uniqueSlug('vendors', a.trading_name, c);
    let { lat, lng } = a;
    if ((lat == null || lng == null) && a.postal_code) {
      const g = await geocode({ line1: a.line1, city: a.city, region: a.region, postal_code: a.postal_code });
      if (g) { lat = g.lat; lng = g.lng; }
    }
    const v = (await one<any>(
      `INSERT INTO vendors(slug, seller_type, legal_name, trading_name, description, email, phone, business_type, owner_name, tax_number, line1, line2, city, region, postal_code, country, lat, lng,
                           cuisines, accepts_delivery, accepts_pickup, uses_own_drivers, created_by, default_prep_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [slug, a.seller_type, a.legal_name, a.trading_name, a.description ?? null, a.email ?? null, a.phone ?? null, a.business_type ?? null, a.owner_name ?? null, a.tax_number ?? null,
        a.line1 ?? null, a.line2 ?? null, a.city ?? null, a.region?.toUpperCase() ?? null, a.postal_code ?? null, a.country ?? 'CA', lat ?? null, lng ?? null, a.cuisines ?? [],
        a.accepts_delivery ?? true, a.accepts_pickup ?? true, a.uses_own_drivers ?? false, userId, a.seller_type === 'chef' ? 45 : 20], c))!;
    await query("INSERT INTO vendor_users(vendor_id, user_id, member_role) VALUES ($1,$2,'owner')", [v.id, userId], c);
    await assignRole(userId, a.seller_type === 'chef' ? 'chef' : 'vendor', null, c);
    if (a.seller_type === 'chef') {
      await query(`INSERT INTO chefs(vendor_id, display_name, bio, specialties, daily_capacity, hourly_capacity) VALUES ($1,$2,$3,$4,$5,$6)`,
        [v.id, a.chef?.display_name ?? a.trading_name, a.chef?.bio ?? null, a.chef?.specialties ?? [], a.chef?.daily_capacity ?? null, a.chef?.hourly_capacity ?? null], c);
    }
    await audit(actor, 'vendor.created', 'vendor', v.id, { seller_type: a.seller_type }, c);
    return v;
  };
  return db ? run(db) : tx(run);
}

const PROFILE_FIELDS = ['legal_name', 'trading_name', 'description', 'logo_url', 'cover_url', 'email', 'phone', 'website', 'business_type', 'owner_name', 'tax_number', 'line1', 'line2', 'city', 'region', 'postal_code',
  'country', 'lat', 'lng', 'cuisines', 'accepts_delivery', 'accepts_pickup', 'uses_own_drivers', 'accepting_orders', 'default_prep_minutes', 'min_order', 'bank_account_last4', 'timezone'];

export async function updateVendor(vendorId: string, data: Record<string, any>, actor: Actor) {
  return tx(async (c) => {
    const before = await one<any>('SELECT * FROM vendors WHERE id = $1 FOR UPDATE', [vendorId], c);
    if (!before) throw notFound('That store');
    if (data.region) data.region = String(data.region).toUpperCase();
    const addrChanged = ['line1', 'city', 'region', 'postal_code'].some((k) => k in data && data[k] !== before[k]);
    if (addrChanged && !('lat' in data)) {
      const g = await geocode({ line1: data.line1 ?? before.line1, city: data.city ?? before.city, region: data.region ?? before.region, postal_code: data.postal_code ?? before.postal_code });
      if (g) { data.lat = g.lat; data.lng = g.lng; }
    }
    const after = await patch('vendors', 'id', vendorId, data, PROFILE_FIELDS, c);
    if (!after) return before;
    if (before.verification_status === 'approved' && ['legal_name', 'tax_number'].some((k) => k in data && data[k] !== before[k])) {
      await notifyStaff('vendors.approve', { kind: 'vendor_issue', title: `${before.trading_name} changed legal details`, body: 'Review the updated legal name or tax number.', data: { vendorId } }, c);
    }
    await audit(actor, 'vendor.updated', 'vendor', vendorId, diff(before, after), c);
    return after;
  });
}

export async function updateChef(vendorId: string, data: Record<string, any>, actor: Actor) {
  const allowed = ['display_name', 'bio', 'photo_url', 'specialties', 'operating_days', 'daily_capacity', 'hourly_capacity', 'concurrent_capacity', 'portions_accepting'];
  const before = await one<any>('SELECT * FROM chefs WHERE vendor_id = $1', [vendorId]);
  if (!before) throw notFound('That chef profile');
  const after = await patch('chefs', 'vendor_id', vendorId, data, allowed);
  await audit(actor, 'chef.updated', 'vendor', vendorId, after ? diff(before, after) : null);
  return after ?? before;
}

export async function setHours(vendorId: string, hours: { weekday: number; opens?: string | null; closes?: string | null; is_closed?: boolean }[], actor: Actor) {
  await tx(async (c) => {
    await query('DELETE FROM vendor_hours WHERE vendor_id = $1', [vendorId], c);
    for (const h of hours) {
      if (!h.is_closed && (!h.opens || !h.closes)) throw badRequest('VALIDATION', 'Set opening and closing times for each open day.');
      await query('INSERT INTO vendor_hours(vendor_id, weekday, opens, closes, is_closed) VALUES ($1,$2,$3,$4,$5)', [vendorId, h.weekday, h.is_closed ? null : h.opens, h.is_closed ? null : h.closes, !!h.is_closed], c);
    }
    await audit(actor, 'vendor.hours_updated', 'vendor', vendorId, { days: hours.length }, c);
  });
}

// ---- verification workflow ----
export async function submitForReview(vendorId: string, actor: Actor) {
  return tx(async (c) => {
    const v = await one<any>('SELECT * FROM vendors WHERE id = $1 FOR UPDATE', [vendorId], c);
    if (!v) throw notFound('That store');
    assertVerification(v.verification_status, 'submitted');
    const gaps: string[] = [];
    for (const f of ['legal_name', 'trading_name', 'line1', 'city', 'region', 'postal_code', 'phone', 'email']) if (!v[f]) gaps.push(f.replace('_', ' '));
    if (v.lat == null) gaps.push('a locatable address');
    if (gaps.length) throw badRequest('INCOMPLETE_PROFILE', `Please complete your business profile first: ${gaps.join(', ')}.`, { gaps });
    const cfg = await getSetting('vendors', c as any);
    if (cfg.require_documents) {
      const missing = await missingDocuments('vendor', vendorId, v.seller_type === 'chef' ? 'chef' : 'vendor', await jurisdictionFor(v.country, v.region), 'uploaded', c);
      if (missing.length) throw badRequest('MISSING_DOCUMENTS', `Please upload: ${missing.map((m) => m.label).join(', ')}.`, { missing });
    }
    await query("UPDATE vendors SET verification_status = 'submitted', submitted_at = now(), verification_note = NULL WHERE id = $1", [vendorId], c);
    await audit(actor, 'vendor.submitted', 'vendor', vendorId, { from: v.verification_status }, c);
    await notifyStaff('vendors.approve', { kind: 'vendor_issue', title: `New application: ${v.trading_name}`, body: 'A store or chef is waiting for review.', data: { vendorId } }, c);
    return { status: 'submitted' };
  });
}

export type ReviewAction = 'start_review' | 'request_info' | 'approve' | 'reject' | 'suspend' | 'reinstate';
export async function reviewVendor(vendorId: string, action: ReviewAction, note: string | undefined, actor: Actor) {
  return tx(async (c) => {
    const v = await one<any>('SELECT * FROM vendors WHERE id = $1 FOR UPDATE', [vendorId], c);
    if (!v) throw notFound('That store');
    const from = v.verification_status as VendorVerification;
    const to: VendorVerification = ({ start_review: 'under_review', request_info: 'info_required', approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'approved' } as const)[action];
    assertVerification(from, to);
    if (['request_info', 'reject', 'suspend'].includes(action) && !note?.trim()) throw badRequest('VALIDATION', 'Please add a note explaining the decision.');
    if (to === 'approved') {
      const cfg = await getSetting('vendors', c as any);
      if (cfg.require_documents) {
        const missing = await missingDocuments('vendor', vendorId, v.seller_type === 'chef' ? 'chef' : 'vendor', await jurisdictionFor(v.country, v.region), 'verified', c);
        if (missing.length) throw conflict('DOCUMENTS_NOT_VERIFIED', `These required documents are not verified yet: ${missing.map((m) => m.label).join(', ')}.`, { missing });
      }
    }
    await query('UPDATE vendors SET verification_status = $2, verification_note = $3, approved_at = CASE WHEN $2 = \'approved\' THEN coalesce(approved_at, now()) ELSE approved_at END, approved_by = CASE WHEN $2 = \'approved\' THEN $4 ELSE approved_by END WHERE id = $1',
      [vendorId, to, note ?? null, actor.userId], c);
    await audit(actor, `vendor.${action}`, 'vendor', vendorId, { from, to, note }, c);
    const titles: Record<string, string> = { under_review: 'Your application is under review', info_required: 'We need more information', approved: action === 'reinstate' ? 'Your store was reinstated' : 'You are approved to sell', rejected: 'Your application was not approved', suspended: 'Your store was suspended' };
    await notifyVendor(vendorId, { kind: 'vendor_status', title: titles[to], body: note || (to === 'approved' ? 'You can now publish products and receive orders.' : 'Open your vendor portal for details.'), data: { vendorId, status: to } }, c);
    if (to === 'suspended') await query("UPDATE products SET status = CASE WHEN status = 'active' THEN 'active' ELSE status END WHERE vendor_id = $1", [vendorId], c); // products stay but are hidden by visibility rules
    return { from, to };
  });
}

export async function addTeamMember(vendorId: string, email: string, role: 'manager' | 'staff', actor: Actor) {
  const u = await one<any>("SELECT id FROM users WHERE email = $1 AND status = 'active'", [email.trim().toLowerCase()]);
  if (!u) throw notFound('A user with that email');
  await query('INSERT INTO vendor_users(vendor_id, user_id, member_role) VALUES ($1,$2,$3) ON CONFLICT (vendor_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role WHERE vendor_users.member_role <> \'owner\'', [vendorId, u.id, role]);
  await assignRole(u.id, 'vendor');
  await audit(actor, 'vendor.team_added', 'vendor', vendorId, { userId: u.id, role });
}
export async function removeTeamMember(vendorId: string, userId: string, actor: Actor) {
  const m = await one<any>('SELECT member_role FROM vendor_users WHERE vendor_id = $1 AND user_id = $2', [vendorId, userId]);
  if (!m) throw notFound('That team member');
  if (m.member_role === 'owner') throw forbidden('The store owner can not be removed.');
  await query('DELETE FROM vendor_users WHERE vendor_id = $1 AND user_id = $2', [vendorId, userId]);
  await audit(actor, 'vendor.team_removed', 'vendor', vendorId, { userId });
}

/** SQL fragment: a vendor is publicly visible and can sell. */
export async function visibilityCondition(alias = 'v') {
  const cfg = await getSetting('vendors');
  return cfg.approval_required ? `${alias}.verification_status = 'approved' AND ${alias}.deleted_at IS NULL` : `${alias}.verification_status NOT IN ('suspended','rejected') AND ${alias}.deleted_at IS NULL`;
}
