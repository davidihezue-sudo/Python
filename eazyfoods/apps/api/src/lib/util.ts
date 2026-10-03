import { z } from 'zod';
import { AppError } from '../errors.js';
import { one, query, type Db, pool } from '../db.js';

export const id = z.guid();
export const money = z.coerce.number().min(0).max(1_000_000).multipleOf(0.01);
export const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(24) });

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
    throw new AppError('VALIDATION', 400, 'Please check the highlighted fields and try again.', { fields });
  }
  return r.data;
}

export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

export async function uniqueSlug(table: 'products' | 'vendors' | 'categories' | 'brands' | 'articles' | 'collections', base: string, db: Db = pool) {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; ; i++) {
    const hit = await one(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug], db);
    if (!hit) return slug;
    slug = `${root}-${i}`;
  }
}

export const pick = <T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) as Pick<T, K>;

/** Build a dynamic UPDATE from a partial object limited to whitelisted columns. */
export async function patch(table: string, idCol: string, idVal: any, data: Record<string, any>, allowed: string[], db: Db = pool, jsonCols: string[] = []) {
  const cols = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined);
  if (!cols.length) return null;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const vals = cols.map((c) => (jsonCols.includes(c) && data[c] !== null ? JSON.stringify(data[c]) : data[c]));
  const rows = await query(`UPDATE ${table} SET ${sets} WHERE ${idCol} = $1 RETURNING *`, [idVal, ...vals], db);
  return rows[0] ?? null;
}

export const randomDigits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
