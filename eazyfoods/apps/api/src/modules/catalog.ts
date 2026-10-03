// Catalog write operations: products, variants, images, categories, brands. Every change is audited.
import { z } from 'zod';
import type pg from 'pg';
import { query, one, tx, pool, type Db } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { audit, diff, type Actor } from '../lib/audit.js';
import { uniqueSlug, slugify, patch } from '../lib/util.js';
import { randomBytes } from 'node:crypto';
import { visibilityCondition } from './vendors.js';
import { clearCategoryCache } from '../pricing/service.js';

type C = pg.PoolClient;

export const variantInput = z.object({
  id: z.guid().optional(),
  name: z.string().min(1).max(80),
  sku: z.string().min(2).max(40).optional(),
  barcode: z.string().regex(/^[0-9A-Za-z\-]{6,20}$/, 'Barcodes use 6 to 20 letters, numbers or dashes').optional().nullable(),
  price: z.coerce.number().min(0).max(100000),
  sale_price: z.coerce.number().min(0).max(100000).optional().nullable(),
  cost: z.coerce.number().min(0).max(100000).optional().nullable(),
  weight_grams: z.coerce.number().int().min(0).optional().nullable(),
  portions: z.coerce.number().int().min(1).max(500).default(1),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  stock: z.coerce.number().int().min(0).optional(),
  reorder_threshold: z.coerce.number().int().min(0).optional(),
});
export const productInput = z.object({
  name: z.string().min(2).max(160),
  short_description: z.string().max(300).optional().nullable(),
  description: z.string().max(8000).optional().nullable(),
  product_type: z.enum(['dry', 'fresh', 'frozen', 'prepared', 'chef_meal']),
  category_id: z.guid().optional().nullable(),
  brand: z.string().max(80).optional().nullable(),
  country_of_origin: z.string().max(80).optional().nullable(),
  cuisine: z.string().max(80).optional().nullable(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  unit: z.string().max(30).optional(),
  weight_grams: z.coerce.number().int().min(0).optional().nullable(),
  dimensions: z.object({ l: z.number().optional(), w: z.number().optional(), h: z.number().optional() }).optional().nullable(),
  tax_class: z.string().max(30).optional(),
  min_qty: z.coerce.number().int().min(1).optional(),
  max_qty: z.coerce.number().int().min(1).optional().nullable(),
  prep_time_minutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  shelf_life_days: z.coerce.number().int().min(0).optional().nullable(),
  storage_instructions: z.string().max(500).optional().nullable(),
  ingredients_text: z.string().max(2000).optional().nullable(),
  allergens: z.array(z.string().max(40)).optional(),
  dietary: z.array(z.string().max(40)).optional(),
  nutrition: z.record(z.string(), z.any()).optional().nullable(),
  videos: z.array(z.string().url()).max(5).optional(),
  tracks_inventory: z.boolean().optional(),
  daily_capacity: z.coerce.number().int().min(1).optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  seo_title: z.string().max(120).optional().nullable(),
  seo_description: z.string().max(300).optional().nullable(),
  images: z.array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(200).optional() })).max(12).optional(),
  variants: z.array(variantInput).min(1).max(30),
});
export type ProductInput = z.infer<typeof productInput>;

const PRODUCT_COLS = ['category_id', 'name', 'short_description', 'description', 'product_type', 'country_of_origin', 'cuisine', 'tags', 'unit', 'weight_grams', 'dimensions', 'tax_class', 'min_qty', 'max_qty',
  'prep_time_minutes', 'shelf_life_days', 'storage_instructions', 'ingredients_text', 'allergens', 'dietary', 'nutrition', 'videos', 'tracks_inventory', 'daily_capacity', 'status', 'seo_title', 'seo_description', 'brand_id'];

async function brandId(c: C, name?: string | null) {
  if (!name?.trim()) return null;
  const existing = await one<any>('SELECT id FROM brands WHERE lower(name) = lower($1)', [name.trim()], c);
  if (existing) return existing.id as string;
  return (await one<any>('INSERT INTO brands(slug, name) VALUES ($1,$2) RETURNING id', [await uniqueSlug('brands', name, c), name.trim()], c))!.id as string;
}
async function vendorCode(c: C, vendorId: string) {
  const v = await one<any>('SELECT slug FROM vendors WHERE id = $1', [vendorId], c);
  return v.slug.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
}
export const generateSku = (code: string) => `EZ-${code}-${randomBytes(3).toString('hex').toUpperCase()}`;

async function assertCanPublish(c: C, vendorId: string, status?: string) {
  if (status !== 'active') return;
  const cond = await visibilityCondition('v');
  const ok = await one(`SELECT 1 FROM vendors v WHERE v.id = $1 AND ${cond}`, [vendorId], c);
  if (!ok) throw conflict('NOT_APPROVED', 'You can publish products once your store has been approved. Save as a draft for now.');
}

async function checkBarcode(c: C, vendorId: string, barcode: string | null | undefined, exceptVariant?: string) {
  if (!barcode) return;
  const dupe = await one(`SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.vendor_id = $1 AND v.barcode = $2 AND ($3::uuid IS NULL OR v.id <> $3)`, [vendorId, barcode, exceptVariant ?? null], c);
  if (dupe) throw conflict('BARCODE_IN_USE', 'Another product in your store already uses that barcode.');
}

export async function createProduct(vendorId: string, input: ProductInput, actor: Actor) {
  return tx(async (c) => {
    await assertCanPublish(c, vendorId, input.status);
    const slug = await uniqueSlug('products', input.name, c);
    const bid = await brandId(c, input.brand);
    const data: Record<string, any> = { ...input, brand_id: bid };
    const cols = PRODUCT_COLS.filter((k) => data[k] !== undefined);
    const vals = cols.map((k) => (k === 'nutrition' || k === 'dimensions') && data[k] ? JSON.stringify(data[k]) : data[k]);
    const p = (await one<any>(
      `INSERT INTO products(vendor_id, slug, created_by${cols.length ? ', ' + cols.join(',') : ''}) VALUES ($1,$2,$3${cols.map((_, i) => `,$${i + 4}`).join('')}) RETURNING *`,
      [vendorId, slug, actor.userId, ...vals], c))!;
    const code = await vendorCode(c, vendorId);
    const defIdx = Math.max(0, input.variants.findIndex((v) => v.is_default));
    for (let i = 0; i < input.variants.length; i++) {
      await insertVariant(c, p, vendorId, input.variants[i], i === defIdx, i, code, actor);
    }
    for (const [i, img] of (input.images ?? []).entries()) await query('INSERT INTO product_images(product_id, url, alt, position) VALUES ($1,$2,$3,$4)', [p.id, img.url, img.alt ?? p.name, i], c);
    await audit(actor, 'product.created', 'product', p.id, { name: p.name, vendorId }, c);
    return p;
  });
}

async function insertVariant(c: C, p: any, vendorId: string, v: z.infer<typeof variantInput>, isDefault: boolean, pos: number, code: string, actor: Actor) {
  if (v.sale_price != null && v.sale_price > v.price) throw badRequest('VALIDATION', 'The sale price can not be higher than the regular price.');
  await checkBarcode(c, vendorId, v.barcode);
  let sku = v.sku?.toUpperCase() ?? generateSku(code);
  if (await one('SELECT 1 FROM product_variants WHERE sku = $1', [sku], c)) {
    if (v.sku) throw conflict('SKU_IN_USE', `The SKU ${sku} is already in use.`);
    sku = generateSku(code);
  }
  const row = (await one<any>(
    `INSERT INTO product_variants(product_id, sku, barcode, name, price, sale_price, cost, weight_grams, portions, is_default, is_active, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [p.id, sku, v.barcode ?? null, v.name, v.price, v.sale_price ?? null, v.cost ?? null, v.weight_grams ?? null, v.portions ?? 1, isDefault, v.is_active ?? true, pos], c))!;
  await query('INSERT INTO price_history(variant_id, new_price, new_sale_price, changed_by) VALUES ($1,$2,$3,$4)', [row.id, v.price, v.sale_price ?? null, actor.userId], c);
  if (p.tracks_inventory) {
    const stock = v.stock ?? 0;
    await query('INSERT INTO inventory(variant_id, vendor_id, on_hand, reorder_threshold) VALUES ($1,$2,$3,$4)', [row.id, vendorId, stock, v.reorder_threshold ?? 0], c);
    await query(`INSERT INTO inventory_movements(variant_id, vendor_id, kind, delta_on_hand, on_hand_after, reserved_after, reason, actor_user_id) VALUES ($1,$2,'initial',$3,$3,0,'Initial stock',$4)`, [row.id, vendorId, stock, actor.userId], c);
  }
  return row;
}

export async function updateProduct(productId: string, vendorId: string | null, input: Partial<ProductInput>, actor: Actor) {
  return tx(async (c) => {
    const before = await one<any>('SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [productId], c);
    if (!before || (vendorId && before.vendor_id !== vendorId)) throw notFound('That product');
    if (input.status && input.status !== before.status) await assertCanPublish(c, before.vendor_id, input.status);
    const data: Record<string, any> = { ...input };
    if ('brand' in input) data.brand_id = await brandId(c, input.brand);
    for (const k of ['nutrition', 'dimensions']) if (data[k]) data[k] = JSON.stringify(data[k]);
    const after = (await patch('products', 'id', productId, data, PRODUCT_COLS, c)) ?? before;
    if (input.variants) {
      const existing = await query<any>('SELECT * FROM product_variants WHERE product_id = $1', [productId], c);
      const code = await vendorCode(c, before.vendor_id);
      const keep = new Set<string>();
      let defaultSeen = false;
      for (const [i, v] of input.variants.entries()) {
        const cur = v.id ? existing.find((e) => e.id === v.id) : null;
        if (v.id && !cur) throw notFound('That variant');
        if (cur) {
          keep.add(cur.id);
          if (v.sale_price != null && v.sale_price > v.price) throw badRequest('VALIDATION', 'The sale price can not be higher than the regular price.');
          await checkBarcode(c, before.vendor_id, v.barcode, cur.id);
          if (Number(cur.price) !== v.price || (cur.sale_price != null ? Number(cur.sale_price) : null) !== (v.sale_price ?? null)) {
            await query('INSERT INTO price_history(variant_id, old_price, new_price, old_sale_price, new_sale_price, changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [cur.id, cur.price, v.price, cur.sale_price, v.sale_price ?? null, actor.userId], c);
            await audit(actor, 'product.price_changed', 'product', productId, { variant: cur.sku, from: { price: Number(cur.price), sale: cur.sale_price }, to: { price: v.price, sale: v.sale_price ?? null } }, c);
          }
          await query('UPDATE product_variants SET name=$2, barcode=$3, price=$4, sale_price=$5, cost=$6, weight_grams=$7, portions=$8, is_default=$9, is_active=$10, position=$11 WHERE id=$1',
            [cur.id, v.name, v.barcode ?? null, v.price, v.sale_price ?? null, v.cost ?? null, v.weight_grams ?? null, v.portions ?? 1, !!v.is_default && !defaultSeen, v.is_active ?? true, i], c);
          if (v.is_default) defaultSeen = true;
          if (v.reorder_threshold != null) await query('UPDATE inventory SET reorder_threshold = $2 WHERE variant_id = $1', [cur.id, v.reorder_threshold], c);
        } else {
          const row = await insertVariant(c, after, before.vendor_id, v, !!v.is_default && !defaultSeen, i, code, actor);
          keep.add(row.id);
          if (v.is_default) defaultSeen = true;
        }
      }
      // Variants removed from the form are deactivated so order history stays intact.
      for (const e of existing) if (!keep.has(e.id)) await query('UPDATE product_variants SET is_active = false, is_default = false WHERE id = $1', [e.id], c);
      if (!defaultSeen) await query(`UPDATE product_variants SET is_default = true WHERE id = (SELECT id FROM product_variants WHERE product_id = $1 AND is_active ORDER BY position LIMIT 1)`, [productId], c);
    }
    if (input.images) {
      await query('DELETE FROM product_images WHERE product_id = $1', [productId], c);
      for (const [i, img] of input.images.entries()) await query('INSERT INTO product_images(product_id, url, alt, position) VALUES ($1,$2,$3,$4)', [productId, img.url, img.alt ?? after.name, i], c);
    }
    await audit(actor, 'product.updated', 'product', productId, diff(before, after), c);
    return after;
  });
}

export async function archiveProduct(productId: string, vendorId: string | null, actor: Actor) {
  const p = await one<any>('UPDATE products SET status = \'archived\', deleted_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR vendor_id = $2) RETURNING id', [productId, vendorId]);
  if (!p) throw notFound('That product');
  await audit(actor, 'product.archived', 'product', productId);
}

// ---- categories (platform managed) ----
export async function saveCategory(data: { id?: string; name: string; parent_id?: string | null; description?: string; image_url?: string; position?: number; is_active?: boolean; seo_title?: string; seo_description?: string }, actor: Actor) {
  clearCategoryCache();
  if (data.id) {
    const before = await one<any>('SELECT * FROM categories WHERE id = $1', [data.id]);
    if (!before) throw notFound('That category');
    if (data.parent_id === data.id) throw badRequest('VALIDATION', 'A category can not be its own parent.');
    const after = await patch('categories', 'id', data.id, data, ['name', 'parent_id', 'description', 'image_url', 'position', 'is_active', 'seo_title', 'seo_description']);
    await audit(actor, 'category.updated', 'category', data.id, diff(before, after ?? before));
    return after ?? before;
  }
  const slug = await uniqueSlug('categories', data.name);
  const row = await one<any>('INSERT INTO categories(slug, name, parent_id, description, image_url, position, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [slug, data.name, data.parent_id ?? null, data.description ?? null, data.image_url ?? null, data.position ?? 0, data.is_active ?? true]);
  await audit(actor, 'category.created', 'category', row.id, { name: data.name });
  return row;
}
export { slugify };
