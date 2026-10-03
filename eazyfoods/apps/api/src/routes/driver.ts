import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, id, pagination } from '../lib/util.js';
import { query, one } from '../db.js';
import { requireUser } from '../lib/rbac.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { addVehicle, submitDriver, driverEarningsSummary } from '../modules/drivers.js';
import { addDocument, requirementsFor, jurisdictionFor } from '../modules/compliance.js';
import { acceptOffer, rejectOffer, arrivedAtPickup, confirmPickup, startTransit, completeDelivery, updateDriverLocation, setAvailability, reportIssue, driverJobView } from '../modules/deliveries.js';
import { planRoute } from '../modules/batching.js';
import { getSetting } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { sendOrderMessage, listOrderMessages } from '../modules/support.js';

export async function driverRoutes(app: FastifyInstance) {
  const driver = async (req: any) => {
    const a = requireUser(req.auth);
    const d = await one<any>('SELECT * FROM driver_profiles WHERE user_id = $1', [a.user.id]);
    if (!d) throw forbidden('You do not have a driver profile yet.');
    return { a, d };
  };
  const approved = async (req: any) => {
    const x = await driver(req);
    if (x.d.verification_status !== 'approved') throw forbidden('Your driver account must be approved first.');
    return x;
  };

  app.get('/me', async (req) => {
    const { a, d } = await driver(req);
    const [vehicles, docs, reqs, active] = await Promise.all([
      query('SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY is_active DESC', [a.user.id]),
      query('SELECT id, doc_type, status, issue_date, expiry_date, review_note, created_at FROM compliance_documents WHERE owner_type = \'driver\' AND owner_id = $1 ORDER BY created_at DESC', [a.user.id]),
      requirementsFor('driver', await jurisdictionFor('CA', d.region)),
      one<any>("SELECT count(*)::int AS n FROM delivery_jobs WHERE driver_id = $1 AND status IN ('assigned','at_pickup','picked_up','in_transit')", [a.user.id]),
    ]);
    return { profile: d, vehicles, documents: docs, requirements: reqs, activeJobs: active.n };
  });
  app.patch('/me', async (req) => {
    const { a } = await driver(req);
    const b = parse(z.object({ phone: z.string().max(30).optional(), address_line1: z.string().max(200).optional(), city: z.string().max(100).optional(), postal_code: z.string().max(12).optional(), licence_number: z.string().max(40).optional(), licence_expiry: z.string().optional() }), req.body);
    const r = await one('UPDATE driver_profiles SET phone = coalesce($2, phone), address_line1 = coalesce($3, address_line1), city = coalesce($4, city), postal_code = coalesce($5, postal_code), licence_number = coalesce($6, licence_number), licence_expiry = coalesce($7, licence_expiry) WHERE user_id = $1 RETURNING *',
      [a.user.id, b.phone ?? null, b.address_line1 ?? null, b.city ?? null, b.postal_code ?? null, b.licence_number ?? null, b.licence_expiry ?? null]);
    await audit(req.actor, 'driver.updated', 'driver', a.user.id, b);
    return { profile: r };
  });
  app.post('/me/vehicles', async (req, reply) => {
    const { a } = await driver(req);
    const b = parse(z.object({ vehicle_type: z.enum(['car', 'bike', 'ebike', 'scooter', 'van']), make: z.string().max(40).optional(), model: z.string().max(40).optional(), year: z.number().int().min(1990).max(2100).optional(), colour: z.string().max(30).optional(), plate: z.string().max(12).optional(), insurance_expiry: z.string().optional(), has_cold_storage: z.boolean().optional() }), req.body);
    reply.status(201); return { vehicle: await addVehicle(a.user.id, b) };
  });
  app.post('/me/documents', async (req, reply) => {
    const { a } = await driver(req);
    const b = parse(z.object({ docType: z.string().min(2).max(60), fileId: id.optional(), reference: z.string().max(80).optional(), issueDate: z.string().optional(), expiryDate: z.string().optional() }), req.body);
    reply.status(201); return { document: await addDocument({ ownerType: 'driver', ownerId: a.user.id, ...b }, req.actor) };
  });
  app.post('/me/submit', async (req) => { const { a } = await driver(req); await submitDriver(a.user.id, req.actor); return { ok: true }; });

  app.post('/me/availability', async (req) => {
    const { a } = await driver(req);
    return setAvailability(a.user.id, parse(z.object({ online: z.boolean() }), req.body).online);
  });
  app.post('/me/location', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { a } = await approved(req);
    const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), heading: z.number().optional(), speed_kmh: z.number().optional() }), req.body);
    await updateDriverLocation(a.user.id, b.lat, b.lng, b.heading, b.speed_kmh);
    return { ok: true };
  });

  // Offers waiting for this driver, with privacy rules applied (approximate areas until accepted).
  app.get('/me/offers', async (req) => {
    const { a } = await approved(req);
    const rows = await query<any>(
      `SELECT o.id AS offer_id, o.expires_at, o.est_pay, o.pickup_distance_km, o.is_batch, j.* FROM delivery_offers o JOIN delivery_jobs j ON j.id = o.job_id WHERE o.driver_id = $1 AND o.status = 'offered' AND o.expires_at > now() AND j.status = 'offered' ORDER BY o.offered_at`, [a.user.id]);
    const out: any[] = [];
    for (const r of rows) out.push({ offerId: r.offer_id, expiresAt: r.expires_at, estPay: Number(r.est_pay), pickupDistanceKm: Number(r.pickup_distance_km), isBatch: r.is_batch, job: { ...(await driverJobView(r, a.user.id)), estPay: Number(r.est_pay) } });
    return { offers: out };
  });
  app.post('/me/offers/:jobId/accept', async (req) => { const { a } = await approved(req); await acceptOffer(a.user.id, parse(z.object({ jobId: id }), req.params).jobId, req.actor); return { ok: true }; });
  app.post('/me/offers/:jobId/reject', async (req) => { const { a } = await approved(req); return rejectOffer(a.user.id, parse(z.object({ jobId: id }), req.params).jobId, req.actor); });

  app.get('/me/jobs', async (req) => {
    const { a } = await approved(req);
    const q = parse(z.object({ scope: z.enum(['active', 'history']).default('active') }).merge(pagination), req.query);
    const rows = await query<any>(
      q.scope === 'active'
        ? `SELECT j.* FROM delivery_jobs j WHERE j.driver_id = $1 AND j.status IN ('assigned','at_pickup','picked_up','in_transit') ORDER BY j.assigned_at`
        : `SELECT j.*, e.total AS earned FROM delivery_jobs j LEFT JOIN driver_earnings e ON e.job_id = j.id WHERE j.driver_id = $1 AND j.status IN ('delivered','cancelled','failed') ORDER BY j.updated_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`, [a.user.id]);
    const jobs: any[] = [];
    for (const r of rows) jobs.push({ ...(await driverJobView(r, a.user.id)), earned: r.earned != null ? Number(r.earned) : undefined, deliveredAt: r.delivered_at });
    let route: any = null;
    if (q.scope === 'active' && rows.length > 1) {
      const d = await one<any>('SELECT current_lat, current_lng FROM driver_profiles WHERE user_id = $1', [a.user.id]);
      const del = await getSetting('delivery');
      if (d?.current_lat != null) route = planRoute({ lat: d.current_lat, lng: d.current_lng }, rows.map((j) => ({ id: j.id, pickup: { lat: j.pickup_lat, lng: j.pickup_lng }, dropoff: { lat: j.dropoff_lat, lng: j.dropoff_lng }, needsCold: j.needs_cold, readyAt: j.ready_at, picked: ['picked_up', 'in_transit'].includes(j.status) })), del.avg_speed_kmh.car);
    }
    return { jobs, route };
  });
  const jid = (req: any) => parse(z.object({ jobId: id }), req.params).jobId;
  app.post('/me/jobs/:jobId/arrived', async (req) => { const { a } = await approved(req); return arrivedAtPickup(a.user.id, jid(req), req.actor); });
  app.post('/me/jobs/:jobId/pickup', async (req) => { const { a } = await approved(req); return confirmPickup(a.user.id, jid(req), req.actor); });
  app.post('/me/jobs/:jobId/start', async (req) => { const { a } = await approved(req); return startTransit(a.user.id, jid(req), req.actor); });
  app.post('/me/jobs/:jobId/deliver', async (req) => {
    const { a } = await approved(req);
    const b = parse(z.object({ pin: z.string().max(8).optional(), photoFileId: id.optional(), signatureFileId: id.optional(), lat: z.number().optional(), lng: z.number().optional() }), req.body);
    return completeDelivery(a.user.id, jid(req), b, req.actor);
  });
  app.post('/me/jobs/:jobId/issue', async (req) => {
    const { a } = await approved(req);
    const b = parse(z.object({ kind: z.enum(['vendor_not_ready', 'vendor_closed', 'customer_unavailable', 'incorrect_address', 'damaged_order', 'vehicle_problem', 'accident', 'other']), notes: z.string().max(1000).optional() }), req.body);
    return reportIssue(a.user.id, jid(req), b.kind, b.notes, req.actor);
  });
  // Controlled chat with the customer and store for an active delivery. No phone numbers are shared.
  app.get('/me/jobs/:jobId/messages', async (req) => {
    const { a } = await approved(req);
    const j = await one<any>('SELECT suborder_id FROM delivery_jobs WHERE id = $1 AND driver_id = $2', [jid(req), a.user.id]);
    if (!j) throw notFound('That delivery');
    const q = parse(z.object({ channel: z.enum(['customer_driver', 'vendor_driver']) }), req.query);
    return { messages: await listOrderMessages(req.auth!, j.suborder_id, q.channel) };
  });
  app.post('/me/jobs/:jobId/messages', async (req) => {
    const { a } = await approved(req);
    const j = await one<any>('SELECT suborder_id FROM delivery_jobs WHERE id = $1 AND driver_id = $2', [jid(req), a.user.id]);
    if (!j) throw notFound('That delivery');
    const b = parse(z.object({ channel: z.enum(['customer_driver', 'vendor_driver']), body: z.string().min(1).max(1000) }), req.body);
    return sendOrderMessage(req.auth!, j.suborder_id, b.channel, b.body);
  });

  app.get('/me/earnings', async (req) => {
    const { a } = await approved(req);
    const recent = await query<any>(`SELECT e.id, e.kind, e.base, e.distance_pay, e.time_pay, e.peak_bonus, e.surge, e.guarantee_topup, e.multi_order_bonus, e.promo_bonus, e.tip, e.total, e.status, e.created_at, s.number
                                       FROM driver_earnings e LEFT JOIN delivery_jobs j ON j.id = e.job_id LEFT JOIN suborders s ON s.id = j.suborder_id WHERE e.driver_id = $1 ORDER BY e.created_at DESC LIMIT 50`, [a.user.id]);
    const payouts = await query('SELECT id, net, status, paid_at, created_at FROM payouts WHERE payee_type = \'driver\' AND payee_id = $1 ORDER BY created_at DESC LIMIT 20', [a.user.id]);
    return { ...(await driverEarningsSummary(a.user.id)), recent: recent.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['id', 'kind', 'status', 'created_at', 'number'].includes(k) ? v : Number(v)]))), payouts };
  });
  void badRequest;
}
