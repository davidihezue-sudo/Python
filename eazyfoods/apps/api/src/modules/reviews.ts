// Reviews tied to real delivered orders. Aggregates are recomputed from published reviews.
import { query, one, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { audit, type Actor } from '../lib/audit.js';
import { notifyVendor } from '../lib/notifications.js';

export interface ReviewInput { suborderId: string; subjectType: 'product' | 'vendor' | 'driver' | 'order'; subjectId?: string; rating: number; title?: string; body?: string; photos?: string[] }

export async function createReview(userId: string, input: ReviewInput, actor: Actor) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw badRequest('VALIDATION', 'Choose a rating from 1 to 5 stars.');
  return tx(async (c) => {
    const s = await one<any>(`SELECT s.*, o.user_id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1`, [input.suborderId], c);
    if (!s || s.user_id !== userId) throw notFound('That order');
    if (!['delivered', 'completed', 'partially_refunded'].includes(s.status)) throw forbidden('You can review an order after it has been delivered.');
    let subjectId = input.subjectId;
    if (input.subjectType === 'vendor') subjectId = s.vendor_id;
    else if (input.subjectType === 'order') subjectId = s.id;
    else if (input.subjectType === 'product') {
      const ok = subjectId && (await one('SELECT 1 FROM order_items WHERE suborder_id = $1 AND product_id = $2', [s.id, subjectId], c));
      if (!ok) throw forbidden('You can only review items you ordered.');
    } else if (input.subjectType === 'driver') {
      const job = await one<any>("SELECT driver_id FROM delivery_jobs WHERE suborder_id = $1 AND status = 'delivered'", [s.id], c);
      if (!job?.driver_id) throw forbidden('This order was not delivered by an EAZyfoods driver.');
      subjectId = job.driver_id;
    }
    const dupe = await one('SELECT 1 FROM reviews WHERE user_id = $1 AND suborder_id = $2 AND subject_type = $3 AND subject_id = $4', [userId, s.id, input.subjectType, subjectId], c);
    if (dupe) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this.');
    const r = await one<any>(
      `INSERT INTO reviews(user_id, suborder_id, subject_type, subject_id, rating, title, body, photos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, s.id, input.subjectType, subjectId, input.rating, input.title ?? null, input.body?.slice(0, 2000) ?? null, input.photos ?? []], c);
    await refreshAggregate(c, input.subjectType, subjectId!);
    if (input.subjectType === 'vendor') await notifyVendor(s.vendor_id, { kind: 'new_review', title: `New ${input.rating} star review`, body: input.body?.slice(0, 120) || 'A customer left a rating.', data: { reviewId: r.id } }, c);
    await audit(actor, 'review.created', 'review', r.id, { subject: input.subjectType, rating: input.rating }, c);
    return r;
  });
}

export async function refreshAggregate(c: any, type: string, id: string) {
  const agg = await one<any>("SELECT coalesce(avg(rating),0)::numeric(3,2) AS a, count(*)::int AS n FROM reviews WHERE subject_type = $1 AND subject_id = $2 AND status = 'published'", [type, id], c);
  const table = { product: ['products', 'id'], vendor: ['vendors', 'id'], driver: ['driver_profiles', 'user_id'] }[type as 'product'];
  if (table) await query(`UPDATE ${table[0]} SET rating_avg = $2, rating_count = $3 WHERE ${table[1]} = $1`, [id, agg.a, agg.n], c);
}

export async function respondToReview(vendorId: string, reviewId: string, text: string, actor: Actor) {
  const r = await one<any>(`SELECT r.*, s.vendor_id FROM reviews r JOIN suborders s ON s.id = r.suborder_id WHERE r.id = $1`, [reviewId]);
  if (!r || r.vendor_id !== vendorId) throw notFound('That review');
  if (!text.trim()) throw badRequest('VALIDATION', 'Write a short response.');
  await query('UPDATE reviews SET vendor_response = $2, responded_at = now(), responded_by = $3 WHERE id = $1', [reviewId, text.trim().slice(0, 1000), actor.userId]);
  await audit(actor, 'review.responded', 'review', reviewId);
}

export async function moderateReview(reviewId: string, status: 'published' | 'hidden' | 'flagged', note: string | undefined, actor: Actor) {
  return tx(async (c) => {
    const r = await one<any>('UPDATE reviews SET status = $2, moderation_note = $3 WHERE id = $1 RETURNING *', [reviewId, status, note ?? null], c);
    if (!r) throw notFound('That review');
    await refreshAggregate(c, r.subject_type, r.subject_id);
    await audit(actor, `review.${status}`, 'review', reviewId, { note }, c);
  });
}
