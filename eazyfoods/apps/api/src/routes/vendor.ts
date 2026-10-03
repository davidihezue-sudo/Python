import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse, id, pagination } from '../lib/util.js';
import { query, one, tx, pool } from '../db.js';
import { requireVendor, requireUser, type VendorCap } from '../lib/rbac.js';
import { badRequest, notFound } from '../errors.js';
import { updateVendor, updateChef, setHours, submitForReview, addTeamMember, removeTeamMember } from '../modules/vendors.js';
import { addDocument, requirementsFor, jurisdictionFor } from '../modules/compliance.js';
import { createProduct, updateProduct, archiveProduct, productInput } from '../modules/catalog.js';
import { adjust, lookupCode, capacityRemaining } from '../modules/inventory.js';
import { acceptSuborder, startPreparing, markReady, vendorCancel, collectPickup, vendorDeliveryStep } from '../modules/orders/fulfillment.js';
import { vendorSuborder } from '../modules/orderviews.js';
import { savePromotion, promotionInput, promotionStats } from '../modules/marketing.js';
import { payoutStatement } from '../modules/payouts.js';
import { partyBalance } from '../modules/ledger.js';
import { vendorAnalytics, chefAnalytics } from '../modules/insights.js';
import { respondToReview } from '../modules/reviews.js';
import { vendorRespondDispute } from '../modules/support.js';
import { saveIngredient, saveRecipe, recipeCosting, planBatch, ingredientInput, recipeInput } from '../modules/kitchen.js';
import { audit } from '../lib/audit.js';
import { notifyStaff } from '../lib/notifications.js';

const vendorParam = z.object({ vendorId: id });
const zoneInput = z.object({
  name: z.string().min(2).max(80), zone_type: z.enum(['radius', 'postal', 'polygon']), center_lat: z.number().optional().nullable(), center_lng: z.number().optional().nullable(),
  radius_km: z.number().min(0.5).max(100).optional().nullable(), postal_prefixes: z.array(z.string().min(1).max(7)).max(100).default([]), polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(200).optional().nullable(),
  fee_model: z.enum(['flat', 'distance']).default('distance'), base_fee: z.number().min(0).max(200).default(0), per_km_fee: z.number().min(0).max(50).default(0), free_over: z.number().min(0).optional().nullable(),
  min_order: z.number().min(0).default(0), max_distance_km: z.number().min(0.5).max(100).optional().nullable(), priority: z.number().int().default(0), is_active: z.boolean().default(true),
});
const validateZone = (z_: z.infer<typeof zoneInput>) => {
  if (z_.zone_type === 'radius' && !z_.radius_km) throw badRequest('VALIDATION', 'Enter a delivery radius.');
  if (z_.zone_type === 'postal' && !z_.postal_prefixes.length) throw badRequest('VALIDATION', 'Add at least one postal code prefix.');
  if (z_.zone_type === 'polygon' && !z_.polygon) throw badRequest('VALIDATION', 'Draw or paste the zone boundary.');
};

export async function vendorRoutes(app: FastifyInstance) {
  const guard = (req: FastifyRequest, cap: VendorCap) => {
    const { vendorId } = parse(vendorParam, req.params);
    requireVendor(req.auth, vendorId, cap);
    return vendorId;
  };

  // ---------- profile and onboarding ----------
  app.get('/:vendorId/manage', async (req) => {
    const vendorId = guard(req, 'support');
    const v = await one<any>('SELECT * FROM vendors WHERE id = $1 AND deleted_at IS NULL', [vendorId]);
    if (!v) throw notFound('That store');
    const [hours, holidays, chef, docs, team] = await Promise.all([
      query('SELECT weekday, to_char(opens, \'HH24:MI\') AS opens, to_char(closes, \'HH24:MI\') AS closes, is_closed FROM vendor_hours WHERE vendor_id = $1 ORDER BY weekday', [vendorId]),
      query('SELECT id, to_char(day, \'YYYY-MM-DD\') AS day, note FROM vendor_holidays WHERE vendor_id = $1 AND day >= current_date ORDER BY day', [vendorId]),
      one('SELECT * FROM chefs WHERE vendor_id = $1', [vendorId]),
      query('SELECT id, doc_type, status, issue_date, expiry_date, review_note, reference_number, created_at FROM compliance_documents WHERE owner_type = \'vendor\' AND owner_id = $1 ORDER BY created_at DESC', [vendorId]),
      query('SELECT vu.user_id, vu.member_role, u.full_name, u.email FROM vendor_users vu JOIN users u ON u.id = vu.user_id WHERE vu.vendor_id = $1', [vendorId]),
    ]);
    const reqs = await requirementsFor(v.seller_type === 'chef' ? 'chef' : 'vendor', await jurisdictionFor(v.country, v.region));
    return { vendor: v, hours, holidays, chef, documents: docs, requirements: reqs, team };
  });
  app.patch('/:vendorId/manage', async (req) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({
      legal_name: z.string().min(2).max(160).optional(), trading_name: z.string().min(2).max(120).optional(), description: z.string().max(2000).nullable().optional(), logo_url: z.string().max(500).nullable().optional(), cover_url: z.string().max(500).nullable().optional(),
      email: z.string().email().optional(), phone: z.string().max(30).optional(), website: z.string().url().nullable().optional(), business_type: z.string().max(60).optional(), owner_name: z.string().max(120).optional(), tax_number: z.string().max(40).optional(),
      line1: z.string().max(200).optional(), line2: z.string().max(200).nullable().optional(), city: z.string().max(100).optional(), region: z.string().max(10).optional(), postal_code: z.string().max(12).optional(),
      cuisines: z.array(z.string().max(60)).max(10).optional(), accepts_delivery: z.boolean().optional(), accepts_pickup: z.boolean().optional(), uses_own_drivers: z.boolean().optional(), accepting_orders: z.boolean().optional(),
      default_prep_minutes: z.number().int().min(1).max(600).optional(), min_order: z.number().min(0).max(1000).optional(), bank_account_last4: z.string().regex(/^\d{4}$/).optional(),
    }), req.body);
    return { vendor: await updateVendor(vendorId, b, req.actor) };
  });
  app.post('/:vendorId/submit', async (req) => submitForReview(guard(req, 'settings'), req.actor));
  app.put('/:vendorId/hours', async (req) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({ hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), opens: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), closes: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), is_closed: z.boolean().optional() })).max(7) }), req.body);
    await setHours(vendorId, b.hours, req.actor);
    return { ok: true };
  });
  app.post('/:vendorId/holidays', async (req, reply) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(100).optional() }), req.body);
    await query('INSERT INTO vendor_holidays(vendor_id, day, note) VALUES ($1,$2,$3) ON CONFLICT (vendor_id, day) DO UPDATE SET note = EXCLUDED.note', [vendorId, b.day, b.note ?? null]);
    reply.status(201); return { ok: true };
  });
  app.delete('/:vendorId/holidays/:day', async (req) => { const vendorId = guard(req, 'settings'); await query('DELETE FROM vendor_holidays WHERE vendor_id = $1 AND day = $2', [vendorId, (req.params as any).day]); return { ok: true }; });

  app.post('/:vendorId/documents', async (req, reply) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({ docType: z.string().min(2).max(60), fileId: id.optional(), reference: z.string().max(80).optional(), issueDate: z.string().optional(), expiryDate: z.string().optional() }), req.body);
    const doc = await addDocument({ ownerType: 'vendor', ownerId: vendorId, ...b }, req.actor);
    const v = await one<any>('SELECT verification_status, trading_name FROM vendors WHERE id = $1', [vendorId]);
    if (v.verification_status === 'approved') await notifyStaff('compliance.manage', { kind: 'document_review', title: `New document from ${v.trading_name}`, body: b.docType.replace(/_/g, ' '), data: { docId: doc.id } });
    reply.status(201); return { document: doc };
  });

  // ---------- chef profile and capacity ----------
  app.put('/:vendorId/chef', async (req) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({ display_name: z.string().min(2).max(120).optional(), bio: z.string().max(3000).optional(), photo_url: z.string().max(500).nullable().optional(), specialties: z.array(z.string().max(60)).max(15).optional(), operating_days: z.array(z.number().int().min(0).max(6)).max(7).optional(), daily_capacity: z.number().int().min(1).nullable().optional(), hourly_capacity: z.number().int().min(1).nullable().optional(), concurrent_capacity: z.number().int().min(1).nullable().optional(), portions_accepting: z.boolean().optional() }), req.body);
    return { chef: await updateChef(vendorId, b, req.actor) };
  });
  app.get('/:vendorId/chef/capacity', async (req) => {
    const vendorId = guard(req, 'orders');
    const blackouts = await query('SELECT id, starts_at, ends_at, reason FROM capacity_blackouts WHERE vendor_id = $1 AND ends_at > now() ORDER BY starts_at', [vendorId]);
    return { today: await capacityRemaining(vendorId, new Date()), blackouts };
  });
  app.post('/:vendorId/chef/blackouts', async (req, reply) => {
    const vendorId = guard(req, 'settings');
    const b = parse(z.object({ starts_at: z.coerce.date(), ends_at: z.coerce.date(), reason: z.string().max(200).optional() }), req.body);
    if (b.ends_at <= b.starts_at) throw badRequest('VALIDATION', 'The end must be after the start.');
    reply.status(201);
    return { blackout: await one('INSERT INTO capacity_blackouts(vendor_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING *', [vendorId, b.starts_at, b.ends_at, b.reason ?? null]) };
  });
  app.delete('/:vendorId/chef/blackouts/:bid', async (req) => { const vendorId = guard(req, 'settings'); await query('DELETE FROM capacity_blackouts WHERE id = $1 AND vendor_id = $2', [parse(z.object({ bid: id }), req.params).bid, vendorId]); return { ok: true }; });

  // ---------- delivery zones ----------
  app.get('/:vendorId/zones', async (req) => ({ zones: await query("SELECT * FROM delivery_zones WHERE scope = 'vendor' AND vendor_id = $1 ORDER BY priority DESC, name", [guard(req, 'settings')]) }));
  app.post('/:vendorId/zones', async (req, reply) => {
    const vendorId = guard(req, 'settings');
    const b = parse(zoneInput, req.body); validateZone(b);
    const z_ = await one<any>(
      `INSERT INTO delivery_zones(scope, vendor_id, name, zone_type, center_lat, center_lng, radius_km, postal_prefixes, polygon, fee_model, base_fee, per_km_fee, free_over, min_order, max_distance_km, priority, is_active)
       VALUES ('vendor',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [vendorId, b.name, b.zone_type, b.center_lat ?? null, b.center_lng ?? null, b.radius_km ?? null, b.postal_prefixes, b.polygon ? JSON.stringify(b.polygon) : null, b.fee_model, b.base_fee, b.per_km_fee, b.free_over ?? null, b.min_order, b.max_distance_km ?? null, b.priority, b.is_active]);
    await audit(req.actor, 'zone.created', 'vendor', vendorId, { zone: b.name });
    reply.status(201); return { zone: z_ };
  });
  app.put('/:vendorId/zones/:zoneId', async (req) => {
    const vendorId = guard(req, 'settings');
    const zid = parse(z.object({ zoneId: id }), req.params).zoneId;
    const b = parse(zoneInput, req.body); validateZone(b);
    const z_ = await one<any>(
      `UPDATE delivery_zones SET name=$3, zone_type=$4, center_lat=$5, center_lng=$6, radius_km=$7, postal_prefixes=$8, polygon=$9, fee_model=$10, base_fee=$11, per_km_fee=$12, free_over=$13, min_order=$14, max_distance_km=$15, priority=$16, is_active=$17
       WHERE id=$1 AND vendor_id=$2 AND scope='vendor' RETURNING *`,
      [zid, vendorId, b.name, b.zone_type, b.center_lat ?? null, b.center_lng ?? null, b.radius_km ?? null, b.postal_prefixes, b.polygon ? JSON.stringify(b.polygon) : null, b.fee_model, b.base_fee, b.per_km_fee, b.free_over ?? null, b.min_order, b.max_distance_km ?? null, b.priority, b.is_active]);
    if (!z_) throw notFound('That zone');
    await audit(req.actor, 'zone.updated', 'vendor', vendorId, { zone: b.name });
    return { zone: z_ };
  });
  app.delete('/:vendorId/zones/:zoneId', async (req) => { const vendorId = guard(req, 'settings'); await query("DELETE FROM delivery_zones WHERE id = $1 AND vendor_id = $2 AND scope = 'vendor'", [parse(z.object({ zoneId: id }), req.params).zoneId, vendorId]); return { ok: true }; });

  // ---------- products ----------
  app.get('/:vendorId/products', async (req) => {
    const vendorId = guard(req, 'inventory');
    const q = parse(pagination.extend({ q: z.string().max(80).optional(), status: z.enum(['draft', 'active', 'archived']).optional() }), req.query);
    const rows = await query<any>(
      `SELECT p.id, p.slug, p.name, p.status, p.product_type, p.updated_at, c.name AS category,
              (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position LIMIT 1) AS image_url,
              (SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'sale_price', v.sale_price, 'available', coalesce(i.on_hand - i.reserved, 0), 'on_hand', coalesce(i.on_hand,0)) ORDER BY v.position)
                 FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = p.id AND v.is_active) AS variants
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.vendor_id = $1 AND p.deleted_at IS NULL AND ($2::text IS NULL OR p.status = $2) AND ($3::text IS NULL OR lower(p.name) LIKE $3)
        ORDER BY p.updated_at DESC LIMIT $4 OFFSET $5`, [vendorId, q.status ?? null, q.q ? `%${q.q.toLowerCase()}%` : null, q.limit, (q.page - 1) * q.limit]);
    const total = await one<any>("SELECT count(*)::int AS n FROM products WHERE vendor_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR status = $2)", [vendorId, q.status ?? null]);
    return { products: rows, total: total.n };
  });
  app.post('/:vendorId/products', async (req, reply) => {
    const vendorId = guard(req, 'catalog');
    const p = await createProduct(vendorId, parse(productInput, req.body), req.actor);
    reply.status(201); return { product: p };
  });
  app.get('/:vendorId/products/:productId', async (req) => {
    const vendorId = guard(req, 'inventory');
    const pid = parse(z.object({ productId: id }), req.params).productId;
    const p = await one<any>('SELECT p.*, b.name AS brand FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.id = $1 AND p.vendor_id = $2 AND p.deleted_at IS NULL', [pid, vendorId]);
    if (!p) throw notFound('That product');
    delete p.search_tsv;
    const [variants, images] = await Promise.all([
      query('SELECT v.*, coalesce(i.on_hand,0) AS on_hand, coalesce(i.reserved,0) AS reserved, coalesce(i.reorder_threshold,0) AS reorder_threshold FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = $1 ORDER BY v.position', [pid]),
      query('SELECT url, alt FROM product_images WHERE product_id = $1 ORDER BY position', [pid]),
    ]);
    return { product: p, variants, images };
  });
  app.put('/:vendorId/products/:productId', async (req) => {
    const vendorId = guard(req, 'catalog');
    const pid = parse(z.object({ productId: id }), req.params).productId;
    return { product: await updateProduct(pid, vendorId, parse(productInput.partial(), req.body), req.actor) };
  });
  app.delete('/:vendorId/products/:productId', async (req) => { const vendorId = guard(req, 'catalog'); await archiveProduct(parse(z.object({ productId: id }), req.params).productId, vendorId, req.actor); return { ok: true }; });
  app.get('/:vendorId/labels', async (req) => {
    const vendorId = guard(req, 'inventory');
    const q = parse(z.object({ variantIds: z.string().optional() }), req.query);
    const ids = q.variantIds?.split(',').filter(Boolean) ?? null;
    return { labels: await query(`SELECT v.id, v.sku, v.barcode, v.name AS variant, p.name AS product, coalesce(v.sale_price, v.price) AS price, vd.trading_name AS vendor
                                    FROM product_variants v JOIN products p ON p.id = v.product_id JOIN vendors vd ON vd.id = p.vendor_id WHERE p.vendor_id = $1 AND p.deleted_at IS NULL AND ($2::uuid[] IS NULL OR v.id = ANY($2::uuid[])) ORDER BY p.name, v.position LIMIT 200`, [vendorId, ids]) };
  });

  // ---------- inventory ----------
  app.get('/:vendorId/inventory', async (req) => {
    const vendorId = guard(req, 'inventory');
    const q = parse(pagination.extend({ q: z.string().max(80).optional(), filter: z.enum(['low', 'out', 'all']).default('all') }), req.query);
    const rows = await query<any>(
      `SELECT v.id AS variant_id, v.sku, v.barcode, v.name AS variant_name, p.id AS product_id, p.name AS product_name, p.tracks_inventory, i.on_hand, i.reserved, i.on_hand - i.reserved AS available, i.incoming, i.damaged, i.expired, i.reorder_threshold, i.supplier,
              (SELECT min(expiry_date) FROM inventory_batches b WHERE b.variant_id = v.id AND b.quantity > 0 AND b.expiry_date IS NOT NULL) AS next_expiry
         FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
        WHERE i.vendor_id = $1 AND p.deleted_at IS NULL AND v.is_active AND ($2::text IS NULL OR lower(p.name || ' ' || v.name) LIKE $2 OR v.sku ILIKE $3 OR v.barcode = $4)
          AND ($5 = 'all' OR ($5 = 'low' AND i.on_hand - i.reserved <= i.reorder_threshold) OR ($5 = 'out' AND i.on_hand - i.reserved <= 0))
        ORDER BY (i.on_hand - i.reserved) ASC, p.name LIMIT $6 OFFSET $7`, [vendorId, q.q ? `%${q.q.toLowerCase()}%` : null, q.q ? `%${q.q}%` : null, q.q ?? null, q.filter, q.limit, (q.page - 1) * q.limit]);
    return { items: rows };
  });
  app.get('/:vendorId/inventory/lookup', async (req) => {
    const vendorId = guard(req, 'inventory');
    const { code } = parse(z.object({ code: z.string().min(2).max(40) }), req.query);
    const items = await lookupCode(vendorId, code);
    if (!items.length) throw notFound('A product with that barcode or SKU');
    return { items: items.map((i) => ({ ...i, price: Number(i.price), sale_price: i.sale_price != null ? Number(i.sale_price) : null })) };
  });
  app.post('/:vendorId/inventory/adjust', async (req) => {
    const vendorId = guard(req, 'inventory');
    const b = parse(z.object({ variantId: id, kind: z.enum(['receive', 'adjust_add', 'adjust_remove', 'damaged', 'expired', 'correction']), qty: z.number().int().min(0).default(0), newOnHand: z.number().int().min(0).optional(), reason: z.string().max(200).optional(), batchCode: z.string().max(40).optional(), expiryDate: z.string().optional(), supplier: z.string().max(120).optional() }), req.body);
    const r = await tx(async (c) => adjust(c, { ...b, vendorId, actor: req.auth!.user.id }));
    await audit(req.actor, 'inventory.adjusted', 'variant', b.variantId, { kind: b.kind, qty: b.qty, newOnHand: b.newOnHand, reason: b.reason });
    return r;
  });
  app.patch('/:vendorId/inventory/:variantId', async (req) => {
    const vendorId = guard(req, 'inventory');
    const vid = parse(z.object({ variantId: id }), req.params).variantId;
    const b = parse(z.object({ reorder_threshold: z.number().int().min(0).optional(), supplier: z.string().max(120).nullable().optional(), incoming: z.number().int().min(0).optional() }), req.body);
    const r = await one('UPDATE inventory SET reorder_threshold = coalesce($3, reorder_threshold), supplier = CASE WHEN $4::boolean THEN $5 ELSE supplier END, incoming = coalesce($6, incoming) WHERE variant_id = $1 AND vendor_id = $2 RETURNING *', [vid, vendorId, b.reorder_threshold ?? null, 'supplier' in b, b.supplier ?? null, b.incoming ?? null]);
    if (!r) throw notFound('That product');
    return { inventory: r };
  });
  app.get('/:vendorId/inventory/:variantId/movements', async (req) => {
    const vendorId = guard(req, 'inventory');
    const vid = parse(z.object({ variantId: id }), req.params).variantId;
    return { movements: await query(`SELECT m.id, m.kind, m.delta_on_hand, m.delta_reserved, m.on_hand_after, m.reserved_after, m.reason, m.ref_type, m.ref_id, m.created_at, u.full_name AS actor FROM inventory_movements m LEFT JOIN users u ON u.id = m.actor_user_id
                                      WHERE m.variant_id = $1 AND m.vendor_id = $2 ORDER BY m.id DESC LIMIT 100`, [vid, vendorId]),
      batches: await query('SELECT batch_code, quantity, expiry_date, received_at FROM inventory_batches WHERE variant_id = $1 ORDER BY expiry_date NULLS LAST', [vid]) };
  });

  // ---------- orders ----------
  app.get('/:vendorId/orders', async (req) => {
    const vendorId = guard(req, 'orders');
    const q = parse(pagination.extend({ status: z.string().optional(), group: z.enum(['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled']).optional() }), req.query);
    const groups: Record<string, string[]> = { new: ['confirmed'], accepted: ['vendor_accepted'], preparing: ['preparing'], ready: ['ready_for_pickup', 'driver_assigned', 'driver_arriving'], completed: ['picked_up', 'in_transit', 'delivered', 'completed', 'partially_refunded', 'refunded', 'disputed'], cancelled: ['cancelled'] };
    const statuses = q.group ? groups[q.group] : q.status ? q.status.split(',') : null;
    const rows = await query<any>(
      `SELECT s.id, s.number, s.status, s.fulfillment_type, s.created_at, s.requested_for, s.estimated_ready_at, s.prep_minutes, s.items_subtotal, s.vendor_net, s.portions, split_part(o.contact_name, ' ', 1) AS customer_first_name,
              (SELECT coalesce(sum(quantity),0)::int FROM order_items WHERE suborder_id = s.id) AS item_count,
              (SELECT string_agg(name || ' x' || quantity, ', ' ORDER BY name) FROM order_items WHERE suborder_id = s.id) AS summary
         FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.vendor_id = $1 AND s.status <> 'pending_payment' AND ($2::text[] IS NULL OR s.status = ANY($2))
        ORDER BY CASE WHEN s.status = 'confirmed' THEN 0 ELSE 1 END, s.created_at DESC LIMIT $3 OFFSET $4`, [vendorId, statuses, q.limit, (q.page - 1) * q.limit]);
    const counts = await query<any>("SELECT status, count(*)::int AS n FROM suborders WHERE vendor_id = $1 AND status <> 'pending_payment' AND created_at > now() - interval '7 days' GROUP BY 1", [vendorId]);
    return { orders: rows.map((r) => ({ ...r, items_subtotal: Number(r.items_subtotal), vendor_net: Number(r.vendor_net) })), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });
  app.get('/:vendorId/orders/:suborderId', async (req) => {
    const vendorId = guard(req, 'orders');
    return { order: await vendorSuborder(req.auth!, vendorId, parse(z.object({ suborderId: id }), req.params).suborderId) };
  });
  const sid = (req: FastifyRequest) => parse(z.object({ suborderId: id }), req.params).suborderId;
  app.post('/:vendorId/orders/:suborderId/accept', async (req) => {
    const vendorId = guard(req, 'orders');
    const b = parse(z.object({ prepMinutes: z.number().int().min(1).max(600).optional() }), req.body);
    return { order: await acceptSuborder(vendorId, sid(req), req.actor, b) };
  });
  app.post('/:vendorId/orders/:suborderId/prepare', async (req) => ({ order: await startPreparing(guard(req, 'orders'), sid(req), req.actor) }));
  app.post('/:vendorId/orders/:suborderId/ready', async (req) => ({ order: await markReady(guard(req, 'orders'), sid(req), req.actor) }));
  app.post('/:vendorId/orders/:suborderId/reject', async (req) => {
    const b = parse(z.object({ reason: z.string().min(2).max(300) }), req.body);
    return { order: await vendorCancel(guard(req, 'orders'), sid(req), b.reason, req.actor, true) };
  });
  app.post('/:vendorId/orders/:suborderId/cancel', async (req) => {
    const b = parse(z.object({ reason: z.string().min(2).max(300) }), req.body);
    return { order: await vendorCancel(guard(req, 'orders'), sid(req), b.reason, req.actor) };
  });
  app.post('/:vendorId/orders/:suborderId/collect', async (req) => {
    const b = parse(z.object({ code: z.string().min(3).max(8) }), req.body);
    return { order: await collectPickup(guard(req, 'orders'), sid(req), b.code, req.actor) };
  });
  app.post('/:vendorId/orders/:suborderId/delivery', async (req) => {
    const b = parse(z.object({ step: z.enum(['out', 'delivered']) }), req.body);
    return { order: await vendorDeliveryStep(guard(req, 'orders'), sid(req), b.step, req.actor) };
  });

  // ---------- promotions ----------
  app.get('/:vendorId/promotions', async (req) => {
    const vendorId = guard(req, 'promotions');
    const rows = await query<any>(`SELECT p.*, (SELECT count(*)::int FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'active') AS redemptions FROM promotions p WHERE p.vendor_id = $1 ORDER BY p.created_at DESC`, [vendorId]);
    return { promotions: rows };
  });
  app.post('/:vendorId/promotions', async (req, reply) => { const vendorId = guard(req, 'promotions'); reply.status(201); return { promotion: await savePromotion(parse(promotionInput, req.body), { vendorId }, req.actor) }; });
  app.put('/:vendorId/promotions/:promoId', async (req) => {
    const vendorId = guard(req, 'promotions');
    return { promotion: await savePromotion(parse(promotionInput, req.body), { vendorId, id: parse(z.object({ promoId: id }), req.params).promoId }, req.actor) };
  });
  app.get('/:vendorId/promotions/:promoId/stats', async (req) => {
    const vendorId = guard(req, 'promotions');
    const s = await promotionStats(parse(z.object({ promoId: id }), req.params).promoId);
    if (!s || s.vendor_id !== vendorId) throw notFound('That promotion');
    return { stats: s };
  });

  // ---------- finance ----------
  app.get('/:vendorId/payouts', async (req) => {
    const vendorId = guard(req, 'finance');
    const [payouts, balance, fees] = await Promise.all([
      query('SELECT id, period_start, period_end, gross, commission, fees, refunds, net, status, scheduled_for, paid_at, hold_reason FROM payouts WHERE payee_type = \'vendor\' AND payee_id = $1 ORDER BY created_at DESC LIMIT 50', [vendorId]),
      partyBalance('vendor', vendorId),
      query<any>("SELECT percent, fixed_fee FROM commission_rules WHERE is_active AND (scope = 'global' OR vendor_id = $1) ORDER BY (scope = 'vendor') DESC LIMIT 1", [vendorId]),
    ]);
    const v = await one<any>('SELECT commission_override_pct FROM vendors WHERE id = $1', [vendorId]);
    return { payouts, ledger_balance: balance, commission: { percent: v.commission_override_pct ?? fees[0]?.percent ?? null, fixed_fee: fees[0]?.fixed_fee ?? 0 } };
  });
  app.get('/:vendorId/payouts/:payoutId', async (req) => {
    const vendorId = guard(req, 'finance');
    const s = await payoutStatement(parse(z.object({ payoutId: id }), req.params).payoutId);
    if (s.payout.payee_id !== vendorId || s.payout.payee_type !== 'vendor') throw notFound('That payout');
    return s;
  });

  // ---------- analytics, reviews, disputes, team ----------
  app.get('/:vendorId/analytics', async (req) => {
    const vendorId = guard(req, 'orders');
    const days = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query).days;
    const v = await one<any>('SELECT seller_type FROM vendors WHERE id = $1', [vendorId]);
    return v.seller_type === 'chef' ? chefAnalytics(vendorId, days) : vendorAnalytics(vendorId, days);
  });
  app.get('/:vendorId/reviews', async (req) => {
    const vendorId = guard(req, 'reviews');
    return { reviews: await query(`SELECT r.id, r.subject_type, r.rating, r.title, r.body, r.created_at, r.vendor_response, split_part(u.full_name, ' ', 1) AS customer, s.number
                                     FROM reviews r JOIN suborders s ON s.id = r.suborder_id JOIN users u ON u.id = r.user_id WHERE s.vendor_id = $1 AND r.subject_type IN ('vendor','product') AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 50`, [vendorId]) };
  });
  app.post('/:vendorId/reviews/:reviewId/respond', async (req) => {
    const vendorId = guard(req, 'reviews');
    await respondToReview(vendorId, parse(z.object({ reviewId: id }), req.params).reviewId, parse(z.object({ text: z.string().min(2).max(1000) }), req.body).text, req.actor);
    return { ok: true };
  });
  app.get('/:vendorId/disputes', async (req) => {
    const vendorId = guard(req, 'support');
    return { disputes: await query(`SELECT d.id, d.status, d.reason, d.claimed_amount, d.vendor_response, d.resolution, d.resolution_amount, d.created_at, s.number, s.id AS suborder_id,
                                           (SELECT json_agg(json_build_object('name', name, 'qty', quantity)) FROM order_items WHERE suborder_id = s.id) AS items
                                      FROM disputes d JOIN suborders s ON s.id = d.suborder_id WHERE s.vendor_id = $1 ORDER BY d.created_at DESC`, [vendorId]) };
  });
  app.post('/:vendorId/disputes/:disputeId/respond', async (req) => {
    const vendorId = guard(req, 'support');
    await vendorRespondDispute(vendorId, parse(z.object({ disputeId: id }), req.params).disputeId, parse(z.object({ text: z.string().min(2).max(2000) }), req.body).text, req.actor);
    return { ok: true };
  });
  app.post('/:vendorId/team', async (req, reply) => {
    const vendorId = guard(req, 'team');
    const b = parse(z.object({ email: z.string().email(), role: z.enum(['manager', 'staff']) }), req.body);
    await addTeamMember(vendorId, b.email, b.role, req.actor); reply.status(201); return { ok: true };
  });
  app.delete('/:vendorId/team/:userId', async (req) => { const vendorId = guard(req, 'team'); await removeTeamMember(vendorId, parse(z.object({ userId: id }), req.params).userId, req.actor); return { ok: true }; });

  // ---------- kitchen (chefs and prepared food vendors) ----------
  app.get('/:vendorId/ingredients', async (req) => ({ ingredients: await query('SELECT * FROM ingredients WHERE vendor_id = $1 ORDER BY name', [guard(req, 'inventory')]) }));
  app.post('/:vendorId/ingredients', async (req, reply) => { const vendorId = guard(req, 'inventory'); reply.status(201); return { ingredient: await saveIngredient(vendorId, parse(ingredientInput, req.body), undefined, req.actor) }; });
  app.put('/:vendorId/ingredients/:ingredientId', async (req) => { const vendorId = guard(req, 'inventory'); return { ingredient: await saveIngredient(vendorId, parse(ingredientInput, req.body), parse(z.object({ ingredientId: id }), req.params).ingredientId, req.actor) }; });
  app.get('/:vendorId/recipes', async (req) => {
    const vendorId = guard(req, 'inventory');
    const recipes = await query<any>('SELECT r.id, r.name, r.yield_servings, r.selling_price, r.product_id, r.deduct_ingredients, r.prep_minutes, r.cook_minutes FROM recipes r WHERE r.vendor_id = $1 ORDER BY r.name', [vendorId]);
    const out: any[] = [];
    for (const r of recipes) { const c = await recipeCosting(vendorId, r.id); out.push({ ...r, cost_per_serving: c.cost_per_serving, food_cost_pct: c.food_cost_pct, gross_margin: c.gross_margin }); }
    return { recipes: out };
  });
  app.post('/:vendorId/recipes', async (req, reply) => { const vendorId = guard(req, 'catalog'); reply.status(201); return { id: await saveRecipe(vendorId, parse(recipeInput, req.body), undefined, req.actor) }; });
  app.put('/:vendorId/recipes/:recipeId', async (req) => { const vendorId = guard(req, 'catalog'); return { id: await saveRecipe(vendorId, parse(recipeInput, req.body), parse(z.object({ recipeId: id }), req.params).recipeId, req.actor) }; });
  app.get('/:vendorId/recipes/:recipeId', async (req) => {
    const vendorId = guard(req, 'inventory');
    return recipeCosting(vendorId, parse(z.object({ recipeId: id }), req.params).recipeId);
  });
  app.post('/:vendorId/recipes/:recipeId/plan', async (req) => {
    const vendorId = guard(req, 'inventory');
    return planBatch(vendorId, parse(z.object({ recipeId: id }), req.params).recipeId, parse(z.object({ batches: z.number().min(1).max(100) }), req.body).batches);
  });
  void requireUser; void pool;
}
