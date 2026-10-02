// Categories (with subcategories) and merchants. Household level data, shared by all members.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { audit } from "../services/audit";
import { id, optText, text } from "./common";
import { requireInHousehold, requireWriter, type FinCtx } from "./access";

export const categorySchema = z.object({ name: text(60), kind: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"), parentId: id.nullish(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(), isEssential: z.boolean().optional() });
export const categoryPatchSchema = z.object({ name: text(60).optional(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(), isEssential: z.boolean().optional(), archived: z.boolean().optional(), parentId: id.nullish() });

export async function listCategories(ctx: FinCtx) {
  const rows = await db.finCategory.findMany({ where: { householdId: ctx.householdId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const used = await db.finTransaction.groupBy({ by: ["categoryId"], where: { householdId: ctx.householdId, deletedAt: null, categoryId: { not: null } }, _count: { _all: true } });
  const usedMap = new Map(used.map((u) => [u.categoryId, u._count._all]));
  // Only the number of uses is exposed, never other members' private transactions.
  return rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId, color: c.color, isEssential: c.isEssential, isSystem: c.isSystem, archived: c.archived, uses: usedMap.get(c.id) ?? 0 }));
}

export async function createCategory(ctx: FinCtx, input: z.infer<typeof categorySchema>) {
  requireWriter(ctx);
  let kind = input.kind;
  if (input.parentId) {
    const p = requireInHousehold(ctx, await db.finCategory.findUnique({ where: { id: input.parentId } }), "Parent category");
    if (p.parentId) throw new AppError("VALIDATION_ERROR", "Subcategories can only be one level deep");
    kind = p.kind;
  }
  const dup = await db.finCategory.findFirst({ where: { householdId: ctx.householdId, kind, parentId: input.parentId ?? null, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) throw conflict("A category with that name already exists here");
  const c = await db.finCategory.create({ data: { householdId: ctx.householdId, name: input.name, kind, parentId: input.parentId ?? null, color: input.color ?? null, isEssential: input.isEssential ?? false, sortOrder: 1000 } });
  await audit(null, ctx.actor, { entity: "FinCategory", entityId: c.id, action: "create", householdId: ctx.householdId, after: { name: c.name } });
  return { id: c.id };
}
export async function updateCategory(ctx: FinCtx, categoryId: string, patch: z.infer<typeof categoryPatchSchema>) {
  requireWriter(ctx);
  const c = requireInHousehold(ctx, await db.finCategory.findUnique({ where: { id: categoryId } }), "Category");
  if (c.isSystem && (patch.archived || patch.name)) throw conflict("System categories cannot be renamed or archived");
  await db.finCategory.update({ where: { id: c.id }, data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.isEssential !== undefined ? { isEssential: patch.isEssential } : {}), ...(patch.archived !== undefined ? { archived: patch.archived } : {}) } });
  await audit(null, ctx.actor, { entity: "FinCategory", entityId: c.id, action: "update", householdId: ctx.householdId, after: patch });
  return { id: c.id };
}
export async function deleteCategory(ctx: FinCtx, categoryId: string) {
  requireWriter(ctx);
  const c = requireInHousehold(ctx, await db.finCategory.findUnique({ where: { id: categoryId } }), "Category");
  if (c.isSystem) throw conflict("System categories cannot be deleted");
  const used = await db.finTransaction.count({ where: { categoryId: c.id } });
  const kids = await db.finCategory.count({ where: { parentId: c.id } });
  if (used || kids) throw conflict("This category is in use. Archive it instead so history stays intact.");
  await db.finCategory.delete({ where: { id: c.id } });
  return { ok: true };
}

export async function listMerchants(ctx: FinCtx, q?: string) {
  const rows = await db.finMerchant.findMany({ where: { householdId: ctx.householdId, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 200 });
  return rows.map((m) => ({ id: m.id, name: m.name, defaultCategoryId: m.defaultCategoryId }));
}
export async function upsertMerchant(householdId: string, name: string | null | undefined, categoryId?: string | null) {
  const n = name?.trim();
  if (!n) return null;
  const existing = await db.finMerchant.findFirst({ where: { householdId, name: { equals: n, mode: "insensitive" } } });
  if (existing) {
    if (!existing.defaultCategoryId && categoryId) await db.finMerchant.update({ where: { id: existing.id }, data: { defaultCategoryId: categoryId } });
    return existing.id;
  }
  return (await db.finMerchant.create({ data: { householdId, name: n.slice(0, 100), defaultCategoryId: categoryId ?? null } })).id;
}
export { notFound, optText };
