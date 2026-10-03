// Driver onboarding and verification.
import { query, one, tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { assertVerification, type VendorVerification } from '../lib/states.js';
import { assignRole } from '../lib/rbac.js';
import { audit, type Actor } from '../lib/audit.js';
import { notify, notifyStaff } from '../lib/notifications.js';
import { jurisdictionFor, missingDocuments } from './compliance.js';
import { getSetting } from '../lib/settings.js';

export interface DriverApplication {
  legal_name: string; phone: string; address_line1?: string; city?: string; region?: string; postal_code?: string; licence_number?: string; licence_expiry?: string;
  vehicle?: { vehicle_type: 'car' | 'bike' | 'ebike' | 'scooter' | 'van'; make?: string; model?: string; year?: number; colour?: string; plate?: string; insurance_expiry?: string; has_cold_storage?: boolean };
}

export async function applyDriver(userId: string, a: DriverApplication, actor: Actor, db?: any) {
  const run = async (c: any) => {
    if (await one('SELECT 1 FROM driver_profiles WHERE user_id = $1', [userId], c)) throw conflict('ALREADY_DRIVER', 'You already have a driver application.');
    await query(
      `INSERT INTO driver_profiles(user_id, legal_name, phone, address_line1, city, region, postal_code, licence_number, licence_expiry) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, a.legal_name, a.phone, a.address_line1 ?? null, a.city ?? null, a.region?.toUpperCase() ?? null, a.postal_code ?? null, a.licence_number ?? null, a.licence_expiry ?? null], c);
    if (a.vehicle) await addVehicle(userId, a.vehicle, c);
    await assignRole(userId, 'driver', null, c);
    await audit(actor, 'driver.created', 'driver', userId, null, c);
  };
  return db ? run(db) : tx(run);
}

export async function addVehicle(driverId: string, v: NonNullable<DriverApplication['vehicle']>, db?: any) {
  return one<any>(
    `INSERT INTO vehicles(driver_id, vehicle_type, make, model, year, colour, plate, insurance_expiry, has_cold_storage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [driverId, v.vehicle_type, v.make ?? null, v.model ?? null, v.year ?? null, v.colour ?? null, v.plate ?? null, v.insurance_expiry ?? null, v.has_cold_storage ?? false], db);
}

export async function submitDriver(driverId: string, actor: Actor) {
  return tx(async (c) => {
    const d = await one<any>('SELECT * FROM driver_profiles WHERE user_id = $1 FOR UPDATE', [driverId], c);
    if (!d) throw notFound('Driver profile');
    assertVerification(d.verification_status, 'submitted');
    if (!(await one('SELECT 1 FROM vehicles WHERE driver_id = $1 AND is_active', [driverId], c))) throw badRequest('INCOMPLETE_PROFILE', 'Add a vehicle before submitting your application.');
    const missing = await missingDocuments('driver', driverId, 'driver', await jurisdictionFor('CA', d.region), 'uploaded', c);
    if (missing.length) throw badRequest('MISSING_DOCUMENTS', `Please upload: ${missing.map((m) => m.label).join(', ')}.`, { missing });
    await query("UPDATE driver_profiles SET verification_status = 'submitted', verification_note = NULL WHERE user_id = $1", [driverId], c);
    await audit(actor, 'driver.submitted', 'driver', driverId, null, c);
    await notifyStaff('drivers.approve', { kind: 'driver_issue', title: 'New driver application', body: `${d.legal_name} is waiting for review.`, data: { driverId } }, c);
  });
}

export type DriverAction = 'start_review' | 'request_documents' | 'approve' | 'reject' | 'suspend' | 'reactivate';
export async function reviewDriver(driverId: string, action: DriverAction, note: string | undefined, actor: Actor) {
  return tx(async (c) => {
    const d = await one<any>('SELECT * FROM driver_profiles WHERE user_id = $1 FOR UPDATE', [driverId], c);
    if (!d) throw notFound('Driver profile');
    const from = d.verification_status as VendorVerification;
    const to: VendorVerification = ({ start_review: 'under_review', request_documents: 'info_required', approve: 'approved', reject: 'rejected', suspend: 'suspended', reactivate: 'approved' } as const)[action];
    assertVerification(from, to);
    if (['request_documents', 'reject', 'suspend'].includes(action) && !note?.trim()) throw badRequest('VALIDATION', 'Please add a note explaining the decision.');
    if (to === 'approved') {
      const cfg = await getSetting('vendors', c as any);
      if (cfg.require_documents) {
        const missing = await missingDocuments('driver', driverId, 'driver', await jurisdictionFor('CA', d.region), 'verified', c);
        if (missing.length) throw conflict('DOCUMENTS_NOT_VERIFIED', `These required documents are not verified yet: ${missing.map((m) => m.label).join(', ')}.`, { missing });
      }
    }
    await query("UPDATE driver_profiles SET verification_status = $2, verification_note = $3, approved_at = CASE WHEN $2='approved' THEN coalesce(approved_at, now()) ELSE approved_at END, approved_by = CASE WHEN $2='approved' THEN $4 ELSE approved_by END, availability = CASE WHEN $2 <> 'approved' THEN 'offline' ELSE availability END WHERE user_id = $1",
      [driverId, to, note ?? null, actor.userId], c);
    await audit(actor, `driver.${action}`, 'driver', driverId, { from, to, note }, c);
    const titles: Record<string, string> = { under_review: 'Your application is under review', info_required: 'We need more documents', approved: action === 'reactivate' ? 'Your account was reactivated' : 'Welcome to the team', rejected: 'Your application was not approved', suspended: 'Your driver account was suspended' };
    await notify({ userId: driverId, kind: 'driver_status', title: titles[to], body: note || (to === 'approved' ? 'You can now go online and receive delivery offers.' : 'Open the driver app for details.'), data: { status: to } }, c);
    return { from, to };
  });
}

export async function driverEarningsSummary(driverId: string) {
  const r = await one<any>(
    `SELECT coalesce(sum(total) FILTER (WHERE created_at >= date_trunc('day', now())),0) AS today,
            coalesce(sum(total) FILTER (WHERE created_at >= date_trunc('week', now())),0) AS week,
            coalesce(sum(total) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS month,
            coalesce(sum(total) FILTER (WHERE status = 'pending'),0) AS pending,
            coalesce(sum(tip),0) AS tips, count(*) FILTER (WHERE kind = 'delivery')::int AS deliveries
       FROM driver_earnings WHERE driver_id = $1`, [driverId]);
  const stats = await one<any>(
    `SELECT d.rating_avg, d.rating_count, d.offers_received, d.offers_accepted, d.jobs_completed,
            (SELECT coalesce(sum(distance_km),0) FROM delivery_jobs WHERE driver_id = d.user_id AND status = 'delivered') AS km,
            (SELECT coalesce(avg(extract(epoch FROM delivered_at - assigned_at)/60),0) FROM delivery_jobs WHERE driver_id = d.user_id AND status = 'delivered') AS avg_minutes,
            (SELECT count(*) FROM delivery_jobs WHERE driver_id = d.user_id AND status IN ('cancelled','failed'))::int AS lost
       FROM driver_profiles d WHERE d.user_id = $1`, [driverId]);
  return {
    earnings: { today: Number(r.today), week: Number(r.week), month: Number(r.month), pending: Number(r.pending), tips: Number(r.tips), deliveries: r.deliveries },
    performance: {
      rating: Number(stats.rating_avg), ratingCount: stats.rating_count,
      acceptanceRate: stats.offers_received ? Math.round((stats.offers_accepted / stats.offers_received) * 100) : null,
      completionRate: stats.jobs_completed + stats.lost ? Math.round((stats.jobs_completed / (stats.jobs_completed + stats.lost)) * 100) : null,
      totalKm: Math.round(Number(stats.km) * 10) / 10, avgDeliveryMinutes: Math.round(Number(stats.avg_minutes)),
    },
  };
}
