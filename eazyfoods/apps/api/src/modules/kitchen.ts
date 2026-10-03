// Chef kitchen management: ingredients, recipes and costing.
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { badRequest, notFound, conflict } from '../errors.js';
import { audit, type Actor } from '../lib/audit.js';

export const ingredientInput = z.object({ name: z.string().min(1).max(100), unit: z.enum(['g', 'kg', 'ml', 'l', 'each']), cost_per_unit: z.coerce.number().min(0), stock_qty: z.coerce.number().min(0).default(0), reorder_threshold: z.coerce.number().min(0).default(0) });
export const recipeInput = z.object({
  name: z.string().min(2).max(120), product_id: z.guid().optional().nullable(), yield_servings: z.coerce.number().positive(), prep_minutes: z.coerce.number().int().min(0).default(0), cook_minutes: z.coerce.number().int().min(0).default(0),
  steps: z.array(z.string().max(500)).max(40).default([]), selling_price: z.coerce.number().min(0).optional().nullable(), deduct_ingredients: z.boolean().default(false),
  ingredients: z.array(z.object({ ingredient_id: z.guid(), quantity: z.coerce.number().positive() })).min(1).max(60),
});

export async function saveIngredient(vendorId: string, data: z.infer<typeof ingredientInput>, id: string | undefined, actor: Actor) {
  if (id) {
    const r = await one<any>('UPDATE ingredients SET name=$3, unit=$4, cost_per_unit=$5, stock_qty=$6, reorder_threshold=$7 WHERE id=$1 AND vendor_id=$2 RETURNING *', [id, vendorId, data.name, data.unit, data.cost_per_unit, data.stock_qty, data.reorder_threshold]);
    if (!r) throw notFound('That ingredient');
    await audit(actor, 'ingredient.updated', 'ingredient', id);
    return r;
  }
  try {
    return await one<any>('INSERT INTO ingredients(vendor_id, name, unit, cost_per_unit, stock_qty, reorder_threshold) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [vendorId, data.name, data.unit, data.cost_per_unit, data.stock_qty, data.reorder_threshold]);
  } catch (e: any) { if (e.code === '23505') throw conflict('DUPLICATE', 'You already have an ingredient with that name.'); throw e; }
}

export async function saveRecipe(vendorId: string, data: z.infer<typeof recipeInput>, id: string | undefined, actor: Actor) {
  return tx(async (c) => {
    const ids = data.ingredients.map((i) => i.ingredient_id);
    const own = await query<any>('SELECT id FROM ingredients WHERE vendor_id = $1 AND id = ANY($2::uuid[])', [vendorId, ids], c);
    if (own.length !== new Set(ids).size) throw badRequest('VALIDATION', 'One of the ingredients does not belong to your kitchen.');
    if (data.product_id && !(await one('SELECT 1 FROM products WHERE id = $1 AND vendor_id = $2', [data.product_id, vendorId], c))) throw badRequest('VALIDATION', 'That dish is not in your menu.');
    let recipeId = id;
    if (id) {
      const r = await one('UPDATE recipes SET name=$3, product_id=$4, yield_servings=$5, prep_minutes=$6, cook_minutes=$7, steps=$8, selling_price=$9, deduct_ingredients=$10 WHERE id=$1 AND vendor_id=$2 RETURNING id',
        [id, vendorId, data.name, data.product_id ?? null, data.yield_servings, data.prep_minutes, data.cook_minutes, data.steps, data.selling_price ?? null, data.deduct_ingredients], c);
      if (!r) throw notFound('That recipe');
      await query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id], c);
    } else {
      recipeId = (await one<any>('INSERT INTO recipes(vendor_id, name, product_id, yield_servings, prep_minutes, cook_minutes, steps, selling_price, deduct_ingredients) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [vendorId, data.name, data.product_id ?? null, data.yield_servings, data.prep_minutes, data.cook_minutes, data.steps, data.selling_price ?? null, data.deduct_ingredients], c))!.id;
    }
    for (const i of data.ingredients) await query('INSERT INTO recipe_ingredients(recipe_id, ingredient_id, quantity) VALUES ($1,$2,$3)', [recipeId, i.ingredient_id, i.quantity], c);
    await audit(actor, id ? 'recipe.updated' : 'recipe.created', 'recipe', recipeId!, { name: data.name }, c);
    return recipeId!;
  });
}

/** Ingredient cost per batch and serving, food cost percentage and gross margin. */
export async function recipeCosting(vendorId: string, recipeId: string) {
  const r = await one<any>('SELECT * FROM recipes WHERE id = $1 AND vendor_id = $2', [recipeId, vendorId]);
  if (!r) throw notFound('That recipe');
  const lines = await query<any>(
    `SELECT i.id, i.name, i.unit, ri.quantity, i.cost_per_unit, (ri.quantity * i.cost_per_unit) AS line_cost, i.stock_qty FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = $1 ORDER BY i.name`, [recipeId]);
  const batch = lines.reduce((s, l) => s + Number(l.line_cost), 0);
  const perServing = batch / Number(r.yield_servings);
  const price = r.selling_price != null ? Number(r.selling_price) : null;
  return {
    recipe: r, lines: lines.map((l) => ({ ...l, line_cost: round2(Number(l.line_cost)), quantity: Number(l.quantity), cost_per_unit: Number(l.cost_per_unit) })),
    batch_cost: round2(batch), cost_per_serving: round2(perServing),
    food_cost_pct: price ? round1((perServing / price) * 100) : null,
    gross_margin: price != null ? round2(price - perServing) : null, gross_margin_pct: price ? round1(((price - perServing) / price) * 100) : null,
    servings_possible: Math.floor(Math.min(...lines.map((l) => (Number(l.quantity) > 0 ? Number(l.stock_qty) / Number(l.quantity) : Infinity))) * Number(r.yield_servings)),
    total_minutes: r.prep_minutes + r.cook_minutes,
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100, round1 = (n: number) => Math.round(n * 10) / 10;

/** Batch preparation: how many servings can be made and what it will consume. */
export async function planBatch(vendorId: string, recipeId: string, batches: number) {
  const c = await recipeCosting(vendorId, recipeId);
  return {
    servings: c.recipe.yield_servings * batches, cost: round2(c.batch_cost * batches),
    needs: c.lines.map((l: any) => ({ ingredient: l.name, unit: l.unit, needed: round2(l.quantity * batches), in_stock: Number(l.stock_qty), short: Math.max(0, round2(l.quantity * batches - Number(l.stock_qty))) })),
  };
}
