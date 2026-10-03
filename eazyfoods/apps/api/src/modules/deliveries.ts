// Delivery jobs and dispatch: create, offer to eligible drivers, assign, track, prove, pay.
import type pg from 'pg';
import { query, one, tx, pool, type Db } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { assertDeliveryTransition, type DeliveryStatus } from '../lib/states.js';
import { getSetting } from '../lib/settings.js';
import { haversineKm, roadKm, minutesFor, approx } from '../lib/geo.js';
import { fromCents, toCents } from '../money.js';
import { enqueue } from '../lib/jobs.js';
import { notify, notifyStaff, notifyVendor } from '../lib/notifications.js';
import { publish } from '../lib/events.js';
import { audit, type Actor } from '../lib/audit.js';
import { randomDigits } from '../lib/util.js';
import { addHistory, recomputeOrderStatus, transitionSuborder } from './orders/core.js';
import { finishDelivered } from './orders/fulfillment.js';
import { computeDriverPay, payToJson, type PayConfig } from './driverpay.js';
import { canBatch, planRoute, type BatchJob } from './batching.js';
import { postDriverPay } from './ledger.js';

type C = pg.PoolClient;
const ACTIVE: DeliveryStatus[] = ['assigned', 'at_pickup', 'picked_up', 'in_transit'];

async function setJobStatus(c: C, jobId: string, to: DeliveryStatus, actor: Actor, set: Record<string, any> = {}, note?: string) {
  const j = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId], c);
  if (!j) throw notFound('That delivery');
  if (j.status === to) return j;
  assertDeliveryTransition(j.status, to);
  const cols = ['status = $2', ...Object.keys(set).map((k, i) => `${k} = $${i + 3}`)];
  const row = await one<any>(`UPDATE delivery_jobs SET ${cols.join(', ')} WHERE id = $1 RETURNING *`, [jobId, to, ...Object.values(set)], c);
  await addHistory(c, 'delivery', jobId, j.status, to, actor, note);
  publish(`order:${j.order_id}`, 'delivery.status', { jobId, status: to });
  publish('admin', 'delivery.status', { jobId, status: to });
  return row;
}

export async function createDeliveryJob(c: C, suborderId: string) {
  const s = await one<any>('SELECT s.*, v.lat AS vlat, v.lng AS vlng, v.line1, v.city, o.delivery_address FROM suborders s JOIN vendors v ON v.id = s.vendor_id JOIN orders o ON o.id = s.order_id WHERE s.id = $1', [suborderId], c);
  const addr = s.delivery_address;
  if (!addr?.lat || s.vlat == null) throw badRequest('NO_LOCATION', 'This delivery has no location.');
  const items = await query<any>(
    `SELECT oi.quantity, oi.product_type, coalesce(v.weight_grams, p.weight_grams, 0) AS w FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = oi.product_id WHERE oi.suborder_id = $1`, [suborderId], c);
  const weight = items.reduce((t, i) => t + i.w * i.quantity, 0);
  const cold = items.some((i) => ['frozen', 'fresh'].includes(i.product_type));
  const cfg = await getSetting('delivery', c as any);
  const km = Number(s.distance_km ?? roadKm({ lat: s.vlat, lng: s.vlng }, { lat: addr.lat, lng: addr.lng }));
  const fee = toCents(s.delivery_fee) - toCents(s.delivery_subsidy_vendor) - toCents(s.delivery_subsidy_platform);
  const job = await one<any>(
    `INSERT INTO delivery_jobs(suborder_id, order_id, vendor_id, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, distance_km, est_minutes, weight_grams, needs_cold, customer_fee, tip, delivery_pin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [suborderId, s.order_id, s.vendor_id, s.vlat, s.vlng, [s.line1, s.city].filter(Boolean).join(', '), addr.lat, addr.lng, km, minutesFor(km, cfg.avg_speed_kmh.car), weight, cold, fromCents(Math.max(0, fee)), s.tip, randomDigits(4)], c);
  await addHistory(c, 'delivery', job.id, null, 'waiting_for_ready', { userId: null, role: 'system' });
  return job;
}

export async function markJobReady(c: C, suborderId: string) {
  const j = await one<any>('SELECT * FROM delivery_jobs WHERE suborder_id = $1 FOR UPDATE', [suborderId], c);
  if (!j || j.status !== 'waiting_for_ready') return;
  await setJobStatus(c, j.id, 'awaiting_driver', { userId: null, role: 'system' }, { ready_at: new Date() });
  await enqueue('dispatch_job', { jobId: j.id }, { db: c, uniqueKey: `dispatch:${j.id}:0` });
}

export async function cancelJobForSuborder(c: C, suborderId: string, reason: string) {
  const j = await one<any>('SELECT * FROM delivery_jobs WHERE suborder_id = $1 FOR UPDATE', [suborderId], c);
  if (!j || ['delivered', 'cancelled', 'failed'].includes(j.status)) return;
  const driverId = j.driver_id;
  if (driverId && ['at_pickup', 'picked_up', 'in_transit'].includes(j.status)) await compensateDriver(c, j, driverId);
  await query("UPDATE delivery_offers SET status = 'withdrawn', responded_at = now() WHERE job_id = $1 AND status = 'offered'", [j.id], c);
  await setJobStatus(c, j.id, 'cancelled', { userId: null, role: 'system' }, { failure_reason: reason }, reason);
  if (driverId) {
    await notify({ userId: driverId, kind: 'delivery_cancelled', title: 'Delivery cancelled', body: 'The order was cancelled. Any compensation has been added to your earnings.', data: { jobId: j.id } }, c);
    publish(`driver:${driverId}`, 'job.cancelled', { jobId: j.id });
  }
}

async function compensateDriver(c: C, job: any, driverId: string) {
  const cfg = await getSetting('driver_pay', c as any);
  const amount = toCents(cfg.cancellation_compensation);
  if (amount <= 0) return;
  await query(`INSERT INTO driver_earnings(driver_id, job_id, kind, base, total) VALUES ($1,$2,'cancellation_compensation',$3,$3)`, [driverId, job.id, fromCents(amount)], c);
  await postDriverPay(c, { jobId: job.id, orderId: job.order_id, suborderId: job.suborder_id, driverId, pay: amount, tip: 0 });
}

// ---------------- dispatch ----------------

interface Candidate { driverId: string; score: number; pickupKm: number; batch: boolean; sibling: boolean; route?: any }

export async function findCandidates(c: Db, job: any): Promise<Candidate[]> {
  const cfg = await getSetting('dispatch', c);
  const del = await getSetting('delivery', c);
  const pickup = { lat: job.pickup_lat, lng: job.pickup_lng };
  const rows = await query<any>(
    `SELECT d.user_id, d.current_lat, d.current_lng, d.offers_received, d.offers_accepted,
            (SELECT vehicle_type FROM vehicles v WHERE v.driver_id = d.user_id AND v.is_active ORDER BY v.id LIMIT 1) AS vehicle_type,
            (SELECT bool_or(has_cold_storage) FROM vehicles v WHERE v.driver_id = d.user_id AND v.is_active) AS cold
       FROM driver_profiles d
      WHERE d.verification_status = 'approved' AND d.availability = 'online' AND d.current_lat IS NOT NULL
        AND d.location_updated_at > now() - ($2 || ' minutes')::interval
        AND NOT EXISTS (SELECT 1 FROM compliance_documents x WHERE x.owner_type = 'driver' AND x.owner_id = d.user_id AND x.status = 'expired')
        AND NOT EXISTS (SELECT 1 FROM delivery_offers o WHERE o.job_id = $1 AND o.driver_id = d.user_id AND o.status IN ('rejected','expired'))`,
    [job.id, String(cfg.location_fresh_minutes)], c);
  const out: Candidate[] = [];
  for (const d of rows) {
    if (!d.vehicle_type) continue;
    if (job.weight_grams > 15000 && !['car', 'van'].includes(d.vehicle_type)) continue;
    const pos = { lat: d.current_lat, lng: d.current_lng };
    const pickupKm = roadKm(pos, pickup);
    if (pickupKm > cfg.max_pickup_km) continue;
    const active = await query<any>(
      `SELECT j.*, s.ready_at AS s_ready FROM delivery_jobs j JOIN suborders s ON s.id = j.suborder_id WHERE j.driver_id = $1 AND j.status IN ('assigned','at_pickup','picked_up','in_transit')`, [d.user_id], c);
    if (active.length >= cfg.max_active_jobs) continue;
    let batch = false, route: any;
    if (active.length) {
      const speed = del.avg_speed_kmh[d.vehicle_type] ?? 25;
      const toBJ = (j: any): BatchJob => ({ id: j.id, pickup: { lat: j.pickup_lat, lng: j.pickup_lng }, dropoff: { lat: j.dropoff_lat, lng: j.dropoff_lng }, needsCold: j.needs_cold, readyAt: j.ready_at ? new Date(j.ready_at) : null, picked: ['picked_up', 'in_transit'].includes(j.status) });
      const chk = canBatch(pos, [...active.map(toBJ), toBJ(job)], cfg.batching, speed);
      if (!chk.ok) continue;
      batch = true; route = chk.route;
    }
    const sibling = active.some((a) => a.order_id === job.order_id);
    const acceptRate = d.offers_received > 0 ? d.offers_accepted / d.offers_received : 1;
    const score = cfg.weights.distance * pickupKm + cfg.weights.load * active.length + cfg.weights.acceptance * (1 - acceptRate) - (sibling ? 100 : 0);
    out.push({ driverId: d.user_id, score, pickupKm, batch, sibling, route });
  }
  return out.sort((a, b) => a.score - b.score);
}

async function demandRatio(c: Db) {
  const r = await one<any>(
    `SELECT (SELECT count(*) FROM delivery_jobs WHERE status IN ('awaiting_driver','offered','assigned','at_pickup'))::float AS jobs,
            (SELECT count(*) FROM driver_profiles WHERE availability='online' AND verification_status='approved')::float AS drivers`, [], c);
  return r.jobs / Math.max(1, r.drivers);
}

/** Offer a job to the best eligible driver, one at a time. Called by the dispatch job. */
export async function dispatchJob(jobId: string) {
  return tx(async (c) => {
    const job = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId], c);
    if (!job || !['awaiting_driver', 'offered'].includes(job.status)) return { skipped: true };
    const cfg = await getSetting('dispatch', c as any);
    // expire stale offers first
    const stale = await query<any>("UPDATE delivery_offers SET status = 'expired', responded_at = now() WHERE job_id = $1 AND status = 'offered' AND expires_at <= now() RETURNING driver_id", [jobId], c);
    if (stale.length && job.status === 'offered') await setJobStatus(c, jobId, 'awaiting_driver', { userId: null, role: 'system' });
    const open = await one("SELECT 1 FROM delivery_offers WHERE job_id = $1 AND status = 'offered'", [jobId], c);
    if (open) return { waiting: true };
    const fresh = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1', [jobId], c);
    const cands = await findCandidates(c, fresh);
    const attempts = fresh.dispatch_attempts + 1;
    await query('UPDATE delivery_jobs SET dispatch_attempts = $2 WHERE id = $1', [jobId, attempts], c);
    if (!cands.length) {
      const waitedMin = (Date.now() - new Date(fresh.ready_at ?? fresh.created_at).getTime()) / 60000;
      if (waitedMin >= cfg.alert_after_minutes) {
        await query(`INSERT INTO operational_alerts(kind, severity, title, details, entity_type, entity_id, dedupe_key) VALUES ('no_driver','high',$1,$2,'delivery_job',$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
          ['No driver available for a ready order', JSON.stringify({ jobId, waitedMin: Math.round(waitedMin) }), jobId, `nodrv:${jobId}`], c);
        await notifyStaff('dispatch.manage', { kind: 'operational_alert', title: 'No driver available', body: `An order has waited ${Math.round(waitedMin)} minutes for a driver.`, data: { jobId } }, c);
      }
      await enqueue('dispatch_job', { jobId }, { runAt: new Date(Date.now() + cfg.retry_seconds * 1000), uniqueKey: `dispatch:${jobId}:${attempts}`, db: c });
      return { offered: false, reason: 'no_eligible_driver' };
    }
    const best = cands[0];
    const pay = await estimatePay(c, fresh, best.batch ? 2 : 1);
    const expires = new Date(Date.now() + cfg.offer_timeout_seconds * 1000);
    await query(
      `INSERT INTO delivery_offers(job_id, driver_id, score, est_pay, pickup_distance_km, is_batch, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, best.driverId, best.score, fromCents(pay.total), best.pickupKm, best.batch, expires], c);
    await query('UPDATE driver_profiles SET offers_received = offers_received + 1 WHERE user_id = $1', [best.driverId], c);
    if (fresh.status === 'awaiting_driver') await setJobStatus(c, jobId, 'offered', { userId: null, role: 'system' });
    await notify({ userId: best.driverId, kind: 'delivery_offer', title: 'New delivery offer', body: `$${fromCents(pay.total).toFixed(2)} for about ${fresh.distance_km} km. Respond within ${cfg.offer_timeout_seconds} seconds.`, data: { jobId } }, c);
    publish(`driver:${best.driverId}`, 'offer', { jobId });
    await enqueue('offer_timeout', { jobId }, { runAt: new Date(expires.getTime() + 1000), uniqueKey: `offer-to:${jobId}:${attempts}`, db: c });
    return { offered: true, driverId: best.driverId };
  });
}

async function estimatePay(c: Db, job: any, batchSize: number) {
  const cfg = await getSetting('driver_pay', c) as PayConfig;
  return computeDriverPay({ distanceKm: Number(job.distance_km) + 0, minutes: job.est_minutes, at: new Date(), demandRatio: await demandRatio(c), batchSize }, cfg);
}

export async function expireOffers() {
  const jobs = await query<{ job_id: string }>("SELECT DISTINCT job_id FROM delivery_offers WHERE status = 'offered' AND expires_at <= now()");
  for (const j of jobs) await dispatchJob(j.job_id);
  // Also retry jobs waiting for a driver with no pending dispatch
  const waiting = await query<{ id: string }>(`SELECT id FROM delivery_jobs WHERE status = 'awaiting_driver' AND NOT EXISTS (SELECT 1 FROM jobs q WHERE q.name = 'dispatch_job' AND q.status IN ('queued','running') AND q.payload->>'jobId' = delivery_jobs.id::text)`);
  for (const w of waiting) await enqueue('dispatch_job', { jobId: w.id }, { uniqueKey: `dispatch:${w.id}:sweep:${Math.floor(Date.now() / 30000)}` });
  return jobs.length;
}

export async function acceptOffer(driverId: string, jobId: string, actor: Actor) {
  return tx(async (c) => {
    const job = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId], c);
    if (!job) throw notFound('That delivery');
    const offer = await one<any>("SELECT * FROM delivery_offers WHERE job_id = $1 AND driver_id = $2 AND status = 'offered' FOR UPDATE", [jobId, driverId], c);
    if (!offer || job.status !== 'offered') throw conflict('OFFER_GONE', 'This offer is no longer available.');
    if (new Date(offer.expires_at) < new Date()) {
      await query("UPDATE delivery_offers SET status = 'expired', responded_at = now() WHERE id = $1", [offer.id], c);
      await setJobStatus(c, jobId, 'awaiting_driver', actor);
      await enqueue('dispatch_job', { jobId }, { db: c, uniqueKey: `dispatch:${jobId}:exp:${Date.now()}` });
      throw conflict('OFFER_EXPIRED', 'This offer expired.');
    }
    await query("UPDATE delivery_offers SET status = 'accepted', responded_at = now() WHERE id = $1", [offer.id], c);
    await query('UPDATE driver_profiles SET offers_accepted = offers_accepted + 1 WHERE user_id = $1', [driverId], c);
    return assignDriver(c, job, driverId, actor);
  });
}

async function assignDriver(c: C, job: any, driverId: string, actor: Actor) {
  const active = await query<any>("SELECT * FROM delivery_jobs WHERE driver_id = $1 AND status IN ('assigned','at_pickup','picked_up','in_transit') AND id <> $2", [driverId, job.id], c);
  const batchSize = active.length + 1;
  const pay = await estimatePay(c, job, batchSize);
  let batchId: string | null = active[0]?.batch_id ?? null;
  if (active.length) {
    const drv = await one<any>('SELECT current_lat, current_lng FROM driver_profiles WHERE user_id = $1', [driverId], c);
    const del = await getSetting('delivery', c as any);
    const veh = await one<any>('SELECT vehicle_type FROM vehicles WHERE driver_id = $1 AND is_active LIMIT 1', [driverId], c);
    const toBJ = (j: any): BatchJob => ({ id: j.id, pickup: { lat: j.pickup_lat, lng: j.pickup_lng }, dropoff: { lat: j.dropoff_lat, lng: j.dropoff_lng }, needsCold: j.needs_cold, readyAt: j.ready_at ? new Date(j.ready_at) : null, picked: ['picked_up', 'in_transit'].includes(j.status) });
    const route = planRoute({ lat: drv.current_lat, lng: drv.current_lng }, [...active, job].map(toBJ), del.avg_speed_kmh[veh?.vehicle_type ?? 'car'] ?? 25);
    if (!batchId) batchId = (await one<any>("INSERT INTO delivery_batches(driver_id, route) VALUES ($1,$2) RETURNING id", [driverId, JSON.stringify(route.stops)], c))!.id;
    else await query('UPDATE delivery_batches SET route = $2 WHERE id = $1', [batchId, JSON.stringify(route.stops)], c);
    await query('UPDATE delivery_jobs SET batch_id = $2 WHERE id = ANY($1::uuid[])', [active.map((a) => a.id), batchId], c);
  }
  const updated = await setJobStatus(c, job.id, 'assigned', actor, {
    driver_id: driverId, assigned_at: new Date(), driver_pay: fromCents(pay.total - 0), pay_breakdown: JSON.stringify(payToJson(pay)),
    platform_margin: fromCents(toCents(job.customer_fee) - pay.total), batch_id: batchId,
  });
  const sub = await one<any>('SELECT * FROM suborders WHERE id = $1', [job.suborder_id], c);
  if (sub.status === 'ready_for_pickup') await transitionSuborder(c, sub.id, 'driver_assigned', actor);
  const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [job.order_id], c);
  const d = await one<any>(`SELECT u.full_name, (SELECT vehicle_type FROM vehicles v WHERE v.driver_id = u.id AND v.is_active LIMIT 1) AS vt FROM users u WHERE u.id = $1`, [driverId], c);
  await notify({ userId: order.user_id, kind: 'driver_assigned', title: 'Driver assigned', body: `${d.full_name.split(' ')[0]} is on the way to pick up your order${d.vt ? ` by ${d.vt}` : ''}.`, data: { orderId: job.order_id } }, c);
  await recomputeOrderStatus(c, job.order_id, actor);
  await audit(actor, 'delivery.assigned', 'delivery_job', job.id, { driverId }, c);
  publish(`driver:${driverId}`, 'job.assigned', { jobId: job.id });
  return updated;
}

export async function rejectOffer(driverId: string, jobId: string, actor: Actor) {
  return tx(async (c) => {
    const offer = await one<any>("SELECT * FROM delivery_offers WHERE job_id = $1 AND driver_id = $2 AND status = 'offered' FOR UPDATE", [jobId, driverId], c);
    if (!offer) throw conflict('OFFER_GONE', 'This offer is no longer available.');
    await query("UPDATE delivery_offers SET status = 'rejected', responded_at = now() WHERE id = $1", [offer.id], c);
    await setJobStatus(c, jobId, 'awaiting_driver', actor);
    await enqueue('dispatch_job', { jobId }, { db: c, uniqueKey: `dispatch:${jobId}:rej:${offer.id}` });
    return { ok: true };
  });
}

// ---------------- driver actions ----------------

async function ownJob(c: C, driverId: string, jobId: string) {
  const j = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId], c);
  if (!j || j.driver_id !== driverId) throw notFound('That delivery');
  return j;
}

export async function arrivedAtPickup(driverId: string, jobId: string, actor: Actor) {
  return tx(async (c) => {
    const j = await ownJob(c, driverId, jobId);
    await setJobStatus(c, jobId, 'at_pickup', actor);
    const sub = await one<any>('SELECT status FROM suborders WHERE id = $1', [j.suborder_id], c);
    if (sub.status === 'driver_assigned') await transitionSuborder(c, j.suborder_id, 'driver_arriving', actor);
    const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [j.order_id], c);
    await notify({ userId: order.user_id, kind: 'driver_arriving', title: 'Driver at the store', body: 'Your driver has arrived to collect your order.', data: { orderId: j.order_id } }, c);
    await recomputeOrderStatus(c, j.order_id, actor);
    return { ok: true };
  });
}

export async function confirmPickup(driverId: string, jobId: string, actor: Actor) {
  return tx(async (c) => {
    const j = await ownJob(c, driverId, jobId);
    const sub = await one<any>('SELECT * FROM suborders WHERE id = $1 FOR UPDATE', [j.suborder_id], c);
    if (!['ready_for_pickup', 'driver_assigned', 'driver_arriving'].includes(sub.status) || sub.ready_at == null) {
      throw conflict('NOT_READY', 'The store has not marked this order ready yet. You can report a problem if you are waiting.');
    }
    await setJobStatus(c, jobId, 'picked_up', actor, { picked_up_at: new Date() });
    await transitionSuborder(c, j.suborder_id, 'picked_up', actor);
    await recomputeOrderStatus(c, j.order_id, actor);
    return { ok: true };
  });
}

export async function startTransit(driverId: string, jobId: string, actor: Actor) {
  return tx(async (c) => {
    const j = await ownJob(c, driverId, jobId);
    await setJobStatus(c, jobId, 'in_transit', actor);
    await transitionSuborder(c, j.suborder_id, 'in_transit', actor);
    const order = await one<any>('SELECT user_id FROM orders WHERE id = $1', [j.order_id], c);
    await notify({ userId: order.user_id, kind: 'driver_arriving', title: 'Your order is on the way', body: 'Your driver is heading to you now. Have your delivery PIN ready.', data: { orderId: j.order_id } }, c);
    await recomputeOrderStatus(c, j.order_id, actor);
    return { ok: true };
  });
}

export interface Proof { pin?: string; photoFileId?: string; signatureFileId?: string; lat?: number; lng?: number }
export async function completeDelivery(driverId: string, jobId: string, proof: Proof, actor: Actor) {
  return tx(async (c) => {
    const j = await ownJob(c, driverId, jobId);
    if (j.status !== 'in_transit') throw conflict('INVALID_TRANSITION', 'Start the delivery before confirming it.');
    const del = await getSetting('delivery', c as any);
    const required: string[] = del.proof_required;
    const evidence: Record<string, any> = { at: new Date().toISOString() };
    if (required.includes('pin')) {
      if (j.pin_attempts >= del.pin_attempts) throw new AppError('PIN_LOCKED', 423, 'Too many incorrect PIN attempts. Please contact support from the app.');
      if (!proof.pin || proof.pin !== j.delivery_pin) {
        await query('UPDATE delivery_jobs SET pin_attempts = pin_attempts + 1 WHERE id = $1', [jobId], c);
        // A failed attempt must persist, so commit it and then report. We do this by throwing after recording in a savepoint-free way.
        throw Object.assign(new AppError('BAD_PIN', 400, 'That PIN does not match. Ask the customer for the 4 digit code shown in their order.'), { persistAttempt: true });
      }
      evidence.pin = true;
    }
    if (required.includes('photo')) {
      if (!proof.photoFileId) throw badRequest('PROOF_PHOTO', 'A photo of the delivered order is required.');
      const f = await one<any>('SELECT id FROM uploaded_files WHERE id = $1 AND owner_user_id = $2', [proof.photoFileId, driverId], c);
      if (!f) throw badRequest('PROOF_PHOTO', 'That photo could not be found. Please upload it again.');
      evidence.photo_file_id = proof.photoFileId;
    }
    if (required.includes('signature')) {
      if (!proof.signatureFileId) throw badRequest('PROOF_SIGNATURE', 'A signature is required.');
      evidence.signature_file_id = proof.signatureFileId;
    }
    let distanceM: number | null = null;
    if (proof.lat != null && proof.lng != null) {
      distanceM = Math.round(haversineKm({ lat: proof.lat, lng: proof.lng }, { lat: j.dropoff_lat, lng: j.dropoff_lng }) * 1000);
      evidence.gps = { lat: proof.lat, lng: proof.lng, distance_m: distanceM };
    }
    if (required.includes('gps')) {
      if (distanceM == null) throw badRequest('PROOF_GPS', 'Location is required to confirm delivery. Please enable location.');
      if (distanceM > del.gps_radius_m) throw badRequest('PROOF_GPS', `You appear to be ${distanceM} m from the delivery address. Move closer to confirm.`);
    }
    const fraud = await getSetting('fraud', c as any);
    if (distanceM != null && distanceM > fraud.driver_gps_mismatch_m) {
      await query(`INSERT INTO risk_signals(subject_type, subject_id, kind, severity, details, dedupe_key) VALUES ('driver',$1,'delivery_far_from_address','medium',$2,$3) ON CONFLICT (dedupe_key) DO NOTHING`,
        [driverId, JSON.stringify({ jobId, distanceM }), `gpsfar:${jobId}`], c);
    }
    await setJobStatus(c, jobId, 'delivered', actor, { delivered_at: new Date(), proof: JSON.stringify(evidence) });
    const fresh = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1', [jobId], c);
    const bd = fresh.pay_breakdown ?? {};
    const cents = (k: string) => toCents(bd[k] ?? 0);
    const total = toCents(fresh.driver_pay);
    await query(
      `INSERT INTO driver_earnings(driver_id, job_id, kind, base, distance_pay, time_pay, peak_bonus, surge, guarantee_topup, multi_order_bonus, promo_bonus, tip, total)
       VALUES ($1,$2,'delivery',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [driverId, jobId, fromCents(cents('base')), fromCents(cents('distance_pay')), fromCents(cents('time_pay')), fromCents(cents('peak_bonus')), fromCents(cents('surge')), fromCents(cents('guarantee_topup')),
        fromCents(cents('multi_order_bonus')), fromCents(cents('promo_bonus')), fresh.tip, fromCents(total + toCents(fresh.tip))], c);
    await postDriverPay(c, { jobId, orderId: j.order_id, suborderId: j.suborder_id, driverId, pay: total, tip: toCents(fresh.tip) });
    await query('UPDATE driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = $1', [driverId], c);
    await transitionSuborder(c, j.suborder_id, 'delivered', actor);
    await finishDelivered(c, j.suborder_id, actor);
    await recomputeOrderStatus(c, j.order_id, actor);
    if (j.batch_id) {
      const left = await one("SELECT 1 FROM delivery_jobs WHERE batch_id = $1 AND status NOT IN ('delivered','cancelled','failed') LIMIT 1", [j.batch_id], c);
      if (!left) await query("UPDATE delivery_batches SET status = 'completed' WHERE id = $1", [j.batch_id], c);
    }
    await notify({ userId: driverId, kind: 'earnings', title: 'Delivery complete', body: `You earned $${fromCents(total + toCents(fresh.tip)).toFixed(2)}.`, data: { jobId } }, c);
    publish(`driver:${driverId}`, 'job.completed', { jobId });
    return { ok: true, earned: fromCents(total + toCents(fresh.tip)), pay: fromCents(total), tip: Number(fresh.tip) };
  }).catch(async (e: any) => {
    // Persist the failed PIN attempt outside the rolled back transaction.
    if (e?.persistAttempt) await query('UPDATE delivery_jobs SET pin_attempts = pin_attempts + 1 WHERE id = $1 AND driver_id = $2', [jobId, driverId]);
    throw e;
  });
}

export async function updateDriverLocation(driverId: string, lat: number, lng: number, heading?: number, speedKmh?: number) {
  const active = await one<any>("SELECT id, order_id, status FROM delivery_jobs WHERE driver_id = $1 AND status IN ('assigned','at_pickup','picked_up','in_transit') ORDER BY assigned_at LIMIT 1", [driverId]);
  await query('UPDATE driver_profiles SET current_lat = $2, current_lng = $3, location_updated_at = now() WHERE user_id = $1', [driverId, lat, lng]);
  await query('INSERT INTO driver_locations(driver_id, lat, lng, heading, speed_kmh, delivery_job_id) VALUES ($1,$2,$3,$4,$5,$6)', [driverId, lat, lng, heading ?? null, speedKmh ?? null, active?.id ?? null]);
  if (active && ['picked_up', 'in_transit', 'assigned', 'at_pickup'].includes(active.status)) {
    const priv = await getSetting('privacy');
    if (priv.show_driver_location_to_customer) publish(`order:${active.order_id}`, 'driver.location', { lat, lng, heading: heading ?? null, jobId: active.id });
  }
  publish('admin', 'driver.location', { driverId, lat, lng });
}

export async function setAvailability(driverId: string, online: boolean) {
  const d = await one<any>('SELECT verification_status FROM driver_profiles WHERE user_id = $1', [driverId]);
  if (!d) throw notFound('Driver profile');
  if (online && d.verification_status !== 'approved') throw forbidden('You can go online once your application is approved.');
  if (online) {
    const expired = await one("SELECT 1 FROM compliance_documents WHERE owner_type='driver' AND owner_id=$1 AND status='expired'", [driverId]);
    if (expired) throw forbidden('One of your documents has expired. Please upload a new one to go online.');
  }
  if (!online) {
    const active = await one("SELECT 1 FROM delivery_jobs WHERE driver_id = $1 AND status IN ('assigned','at_pickup','picked_up','in_transit')", [driverId]);
    if (active) throw conflict('HAS_ACTIVE_JOB', 'Finish your current deliveries before going offline.');
  }
  await query("UPDATE driver_profiles SET availability = $2 WHERE user_id = $1", [driverId, online ? 'online' : 'offline']);
  publish('admin', 'driver.availability', { driverId, online });
  return { online };
}

// ---------------- issues, admin reassign, views ----------------

const ISSUE_RULES: Record<string, { priority: 'normal' | 'high' | 'urgent'; releases?: boolean; offline?: boolean; notifyVendor?: boolean; notifyCustomer?: string }> = {
  vendor_not_ready: { priority: 'normal', notifyVendor: true },
  vendor_closed: { priority: 'high', notifyVendor: true },
  customer_unavailable: { priority: 'normal', notifyCustomer: 'Your driver is at your door but could not reach you. Please check your phone or the app.' },
  incorrect_address: { priority: 'high', notifyCustomer: 'Your driver cannot find the delivery address. Please contact support or check your address.' },
  damaged_order: { priority: 'high' },
  vehicle_problem: { priority: 'high', releases: true },
  accident: { priority: 'urgent', releases: true, offline: true },
  other: { priority: 'normal' },
};
export async function reportIssue(driverId: string, jobId: string, kind: string, notes: string | undefined, actor: Actor) {
  const rule = ISSUE_RULES[kind];
  if (!rule) throw badRequest('VALIDATION', 'Choose what went wrong.');
  return tx(async (c) => {
    const j = await ownJob(c, driverId, jobId);
    const sub = await one<any>('SELECT * FROM suborders WHERE id = $1', [j.suborder_id], c);
    const order = await one<any>('SELECT user_id, number FROM orders WHERE id = $1', [j.order_id], c);
    const num = (await one<any>("SELECT nextval('ticket_number_seq')::int AS n", [], c))!.n;
    const ticket = await one<any>(
      `INSERT INTO support_tickets(number, requester_id, order_id, suborder_id, vendor_id, driver_id, category, subject, priority, status) VALUES ($1,$2,$3,$4,$5,$6,'driver_issue',$7,$8,'open') RETURNING id`,
      [`T-${num}`, driverId, j.order_id, j.suborder_id, j.vendor_id, driverId, `Driver reported: ${kind.replace(/_/g, ' ')} (${sub.number})`, rule.priority], c);
    if (notes) await query("INSERT INTO messages(thread_type, thread_id, sender_id, sender_role, body) VALUES ('ticket',$1,$2,'driver',$3)", [ticket.id, driverId, notes], c);
    await query('INSERT INTO driver_issues(job_id, driver_id, kind, notes, ticket_id) VALUES ($1,$2,$3,$4,$5)', [jobId, driverId, kind, notes ?? null, ticket.id], c);
    if (rule.notifyVendor) await notifyVendor(j.vendor_id, { kind: 'driver_issue', title: `Driver waiting for ${sub.number}`, body: kind === 'vendor_closed' ? 'Your driver reports the store is closed.' : 'Your driver is waiting. Please mark the order ready as soon as it is.', data: { suborderId: sub.id } }, c);
    if (rule.notifyCustomer) await notify({ userId: order.user_id, kind: 'support_update', title: `Update on order ${order.number}`, body: rule.notifyCustomer, data: { orderId: j.order_id } }, c);
    await notifyStaff('dispatch.manage', { kind: 'operational_alert', title: `Driver issue: ${kind.replace(/_/g, ' ')}`, body: `Order ${sub.number}`, data: { jobId, ticketId: ticket.id } }, c);
    await query(`INSERT INTO operational_alerts(kind, severity, title, details, entity_type, entity_id, dedupe_key) VALUES ('driver_issue',$1,$2,$3,'delivery_job',$4,$5) ON CONFLICT (dedupe_key) DO NOTHING`,
      [rule.priority === 'urgent' ? 'high' : 'medium', `Driver issue: ${kind.replace(/_/g, ' ')}`, JSON.stringify({ jobId, order: sub.number }), jobId, `di:${jobId}:${kind}`], c);
    if (rule.releases && ['assigned', 'at_pickup'].includes(j.status)) {
      await setJobStatus(c, jobId, 'awaiting_driver', actor, { driver_id: null, assigned_at: null }, `Released after: ${kind}`);
      if (sub.status === 'driver_assigned' || sub.status === 'driver_arriving') await transitionSuborder(c, sub.id, 'ready_for_pickup', actor, { note: `Driver released: ${kind}` });
      await enqueue('dispatch_job', { jobId }, { db: c, uniqueKey: `dispatch:${jobId}:issue:${Date.now()}` });
    }
    if (rule.offline) await query("UPDATE driver_profiles SET availability = 'offline' WHERE user_id = $1", [driverId], c);
    return { ticketId: ticket.id, released: !!rule.releases };
  });
}

export async function adminReassign(jobId: string, newDriverId: string | null, actor: Actor) {
  return tx(async (c) => {
    const j = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE', [jobId], c);
    if (!j) throw notFound('That delivery');
    if (['delivered', 'cancelled', 'failed'].includes(j.status)) throw conflict('INVALID_TRANSITION', 'That delivery is already finished.');
    const old = j.driver_id;
    if (newDriverId) {
      const d = await one<any>("SELECT verification_status FROM driver_profiles WHERE user_id = $1", [newDriverId], c);
      if (!d || d.verification_status !== 'approved') throw badRequest('DRIVER_NOT_APPROVED', 'That driver is not approved.');
    }
    await query("UPDATE delivery_offers SET status = 'withdrawn', responded_at = now() WHERE job_id = $1 AND status = 'offered'", [jobId], c);
    if (['picked_up', 'in_transit'].includes(j.status)) {
      if (!newDriverId) throw badRequest('VALIDATION', 'Choose a driver to take over a delivery that is already picked up.');
      await query('UPDATE delivery_jobs SET driver_id = $2, batch_id = NULL WHERE id = $1', [jobId, newDriverId], c);
    } else if (newDriverId) {
      if (j.status === 'waiting_for_ready') throw conflict('NOT_READY', 'The order is not ready yet.');
      if (['assigned', 'at_pickup'].includes(j.status)) await setJobStatus(c, jobId, 'awaiting_driver', actor);
      const fresh = await one<any>('SELECT * FROM delivery_jobs WHERE id = $1', [jobId], c);
      if (fresh.status === 'offered') await setJobStatus(c, jobId, 'awaiting_driver', actor);
      await query('UPDATE delivery_jobs SET driver_id = NULL, batch_id = NULL WHERE id = $1', [jobId], c);
      await assignDriver(c, await one<any>('SELECT * FROM delivery_jobs WHERE id = $1', [jobId], c), newDriverId, actor);
    } else {
      if (['assigned', 'at_pickup'].includes(j.status)) await setJobStatus(c, jobId, 'awaiting_driver', actor, { driver_id: null });
      const sub = await one<any>('SELECT status FROM suborders WHERE id = $1', [j.suborder_id], c);
      if (['driver_assigned', 'driver_arriving'].includes(sub.status)) await transitionSuborder(c, j.suborder_id, 'ready_for_pickup', actor, { note: 'Driver removed by operations' });
      await enqueue('dispatch_job', { jobId }, { db: c, uniqueKey: `dispatch:${jobId}:admin:${Date.now()}` });
    }
    if (old) { await notify({ userId: old, kind: 'delivery_cancelled', title: 'Delivery reassigned', body: 'Operations reassigned this delivery.', data: { jobId } }, c); publish(`driver:${old}`, 'job.cancelled', { jobId }); }
    await audit(actor, 'delivery.reassigned', 'delivery_job', jobId, { from: old, to: newDriverId }, c);
    return { ok: true };
  });
}

/** Driver view of a job with privacy rules applied for the current stage. */
export async function driverJobView(job: any, driverId: string, db: Db = pool) {
  const priv = await getSetting('privacy', db);
  const s = await one<any>(`SELECT s.number, s.customer_total, s.status AS sub_status, s.items_subtotal, o.delivery_address, o.contact_name, o.contact_phone,
                                   (SELECT coalesce(sum(quantity),0)::int FROM order_items WHERE suborder_id = s.id) AS item_count,
                                   (SELECT string_agg(name || ' x' || quantity, ', ') FROM order_items WHERE suborder_id = s.id) AS items,
                                   v.trading_name, v.line1 AS v_line1, v.city AS v_city, v.phone AS v_phone
                              FROM suborders s JOIN orders o ON o.id = s.order_id JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1`, [job.suborder_id], db);
  const offered = job.status === 'offered';
  const finished = ['delivered', 'cancelled', 'failed'].includes(job.status);
  const showFull = !offered && !finished && priv.driver_full_address_after_accept && job.driver_id === driverId;
  const afterDone = finished && !priv.hide_customer_after_complete;
  const addr = s.delivery_address ?? {};
  const base: any = {
    id: job.id, status: job.status, orderNumber: s.number, store: s.trading_name, itemCount: s.item_count, distanceKm: Number(job.distance_km), estMinutes: job.est_minutes,
    pay: Number(job.driver_pay), payBreakdown: job.pay_breakdown, tip: Number(job.tip), needsCold: job.needs_cold, weightKg: Math.round(job.weight_grams / 100) / 10, batchId: job.batch_id,
  };
  if (offered) {
    return { ...base, pickupArea: approx({ lat: job.pickup_lat, lng: job.pickup_lng }), dropoffArea: approx({ lat: job.dropoff_lat, lng: job.dropoff_lng }), instructions: null, pay: null };
  }
  if (showFull) {
    return {
      ...base, items: s.items,
      pickup: { name: s.trading_name, address: job.pickup_address, lat: job.pickup_lat, lng: job.pickup_lng, phone: null },
      dropoff: { name: String(s.contact_name ?? '').split(' ')[0], address: [addr.line1, addr.line2, addr.city, addr.postal_code].filter(Boolean).join(', '), lat: job.dropoff_lat, lng: job.dropoff_lng, instructions: addr.instructions ?? null },
      proofRequired: (await getSetting('delivery', db)).proof_required,
    };
  }
  return { ...base, pickupArea: approx({ lat: job.pickup_lat, lng: job.pickup_lng }), dropoffArea: afterDone ? approx({ lat: job.dropoff_lat, lng: job.dropoff_lng }) : null, redacted: true };
}
