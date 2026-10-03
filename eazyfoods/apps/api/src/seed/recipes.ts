import { query, one } from '../db.js';
import { saveIngredient, saveRecipe } from '../modules/kitchen.js';
import type { Actor } from '../lib/audit.js';

/** Kitchen data: ingredients with costs and recipes with food cost for Lagos Kitchen and the chefs. */
export async function saveRecipeSeed(vend: Record<string, { id: string; userId: string; products: Record<string, { id: string }> }>) {
  const kitchens: { key: string; ingredients: [string, string, number, number, number][]; recipes: { name: string; product: string; yield: number; prep: number; cook: number; price: number; deduct: boolean; lines: [string, number][]; steps: string[] }[] }[] = [
    {
      key: 'lagos',
      ingredients: [['Parboiled rice', 'kg', 3.8, 40, 8], ['Tomatoes', 'kg', 3.2, 25, 6], ['Red peppers (tatashe)', 'kg', 4.5, 12, 4], ['Onions', 'kg', 1.6, 18, 5], ['Vegetable oil', 'l', 4.2, 14, 4], ['Seasoning and spices', 'kg', 18, 3, 1], ['Chicken stock', 'l', 2.5, 20, 5], ['Chicken thighs', 'kg', 8.5, 30, 8]],
      recipes: [{ name: 'Party Jollof Rice', product: 'Party Jollof Rice with Chicken', yield: 20, prep: 30, cook: 75, price: 17.99, deduct: true, lines: [['Parboiled rice', 3], ['Tomatoes', 2.5], ['Red peppers (tatashe)', 1], ['Onions', 0.8], ['Vegetable oil', 0.5], ['Seasoning and spices', 0.08], ['Chicken stock', 2], ['Chicken thighs', 4]], steps: ['Blend tomatoes, peppers and onion.', 'Fry the base until the oil floats.', 'Add rice and stock, seal and cook low.', 'Grill chicken and serve.'] }],
    },
    {
      key: 'ada',
      ingredients: [['Bitterleaf (washed)', 'kg', 9, 4, 1], ['Cocoyam paste', 'kg', 6, 3, 1], ['Goat meat', 'kg', 15, 6, 2], ['Stockfish', 'kg', 32, 1.5, 0.5], ['Palm oil', 'l', 9, 5, 1], ['Crayfish', 'kg', 40, 1, 0.3]],
      recipes: [{ name: 'Ofe Onugbu (batch)', product: 'Ofe Onugbu (Bitterleaf Soup)', yield: 10, prep: 40, cook: 70, price: 21, deduct: false, lines: [['Bitterleaf (washed)', 1], ['Cocoyam paste', 0.8], ['Goat meat', 1.5], ['Stockfish', 0.3], ['Palm oil', 0.4], ['Crayfish', 0.1]], steps: ['Boil meat and stockfish.', 'Thicken with cocoyam paste.', 'Add palm oil, crayfish and bitterleaf. Simmer 15 minutes.'] }],
    },
  ];
  for (const k of kitchens) {
    const v = vend[k.key];
    const actor: Actor = { userId: v.userId, role: 'vendor' };
    const ids: Record<string, string> = {};
    for (const [name, unit, cost, stock, reorder] of k.ingredients) ids[name] = (await saveIngredient(v.id, { name, unit: unit as any, cost_per_unit: cost, stock_qty: stock, reorder_threshold: reorder }, undefined, actor)).id;
    for (const r of k.recipes) {
      await saveRecipe(v.id, { name: r.name, product_id: v.products[r.product]?.id ?? null, yield_servings: r.yield, prep_minutes: r.prep, cook_minutes: r.cook, steps: r.steps, selling_price: r.price, deduct_ingredients: r.deduct, ingredients: r.lines.map(([n, q]) => ({ ingredient_id: ids[n], quantity: q })) }, undefined, actor);
    }
  }
  void query; void one;
}
