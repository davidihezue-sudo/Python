// Auto-categorise rules. They only ever fill in details the person left empty, and they only touch records the actor may write.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { audit } from "../services/audit";
import { applyRules, hasConditions, normaliseTags, ruleMatches, type RuleActions, type RuleConditions, type RuleLite } from "./engine/rules";
import { canEdit, requireWriter, visWhere, type FinCtx } from "./access";
import { id, moneyIn, optText, text } from "./common";
import { loadCategories } from "./load";
import { assertVehicleLink } from "./vehicles";

const words = z.array(z.string().trim().min(1).max(60)).max(10);
export const conditionsSchema = z.object({
  textAny: words.optional(), textAll: words.optional(),
  minAmount: moneyIn.nullish(), maxAmount: moneyIn.nullish(), accountId: id.nullish(), type: z.enum(["INCOME", "EXPENSE", "REFUND"]).nullish(),
}).refine((c) => hasConditions(c as RuleConditions), "Add at least one condition, such as words in the description");
export const actionsSchema = z.object({
  categoryId: id.nullish(), vehicleId: id.nullish(), addTags: z.array(z.string().trim().min(1).max(30)).max(10).optional(), merchant: optText(100),
}).refine((a) => !!(a.categoryId || a.vehicleId || a.addTags?.length || a.merchant), "Choose at least one thing for the rule to do");
export const ruleSchema = z.object({
  name: text(80), scope: z.enum(["MINE", "HOUSEHOLD"]).default("MINE"), priority: z.number().int().min(1).max(1000).default(100), active: z.boolean().default(true),
  conditions: conditionsSchema, actions: actionsSchema,
});
export const rulePatchSchema = z.object({ name: text(80).optional(), priority: z.number().int().min(1).max(1000).optional(), active: z.boolean().optional(), conditions: conditionsSchema.optional(), actions: actionsSchema.optional() });
export const previewSchema = z.object({ conditions: conditionsSchema });
export const applyExistingSchema = z.object({ ruleId: id.optional() });

type RuleRow = Awaited<ReturnType<typeof db.finRule.findFirstOrThrow>>;
const asLite = (r: RuleRow): RuleLite => ({ id: r.id, scope: r.scope, priority: r.priority, conditions: r.conditions as RuleConditions, actions: r.actions as RuleActions });

function view(ctx: FinCtx, r: RuleRow) {
  const mine = r.ownerMemberId === ctx.me.id;
  const owner = ctx.members.find((m) => m.id === r.ownerMemberId);
  return { id: r.id, name: r.name, scope: r.scope, priority: r.priority, active: r.active, conditions: r.conditions, actions: r.actions, hitCount: r.hitCount, lastHitAt: r.lastHitAt?.toISOString() ?? null, owner: owner ? { id: owner.id, name: owner.name } : null, canEdit: ctx.canWrite && (mine || (r.scope === "HOUSEHOLD" && ctx.isAdmin)) };
}
const where = (ctx: FinCtx) => ({ householdId: ctx.householdId, OR: [{ scope: "HOUSEHOLD" as const }, { ownerMemberId: ctx.me.id }] });

export async function listRules(ctx: FinCtx) {
  const rows = await db.finRule.findMany({ where: where(ctx), orderBy: [{ scope: "asc" }, { priority: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => view(ctx, r));
}

async function checkActions(ctx: FinCtx, a: RuleActions) {
  if (a.categoryId && !(await loadCategories(ctx)).some((c) => c.id === a.categoryId)) throw new AppError("VALIDATION_ERROR", "Unknown category", { fieldErrors: { "actions.categoryId": ["Unknown category"] } });
  await assertVehicleLink(ctx, a.vehicleId);
}
const clean = (a: RuleActions): RuleActions => ({ ...a, addTags: a.addTags ? normaliseTags(a.addTags) : undefined });

export async function createRule(ctx: FinCtx, input: z.infer<typeof ruleSchema>) {
  requireWriter(ctx);
  if (input.scope === "HOUSEHOLD" && !ctx.isAdmin) throw forbidden("Only a household administrator can create a rule for everyone");
  await checkActions(ctx, input.actions as RuleActions);
  const r = await db.finRule.create({ data: { householdId: ctx.householdId, ownerMemberId: ctx.me.id, scope: input.scope, name: input.name, priority: input.priority, active: input.active, conditions: input.conditions as object, actions: clean(input.actions as RuleActions) as object } });
  await audit(null, ctx.actor, { entity: "FinRule", entityId: r.id, action: "create", householdId: ctx.householdId, after: { name: r.name, scope: r.scope } });
  return { id: r.id };
}

async function editable(ctx: FinCtx, ruleId: string) {
  requireWriter(ctx);
  const r = await db.finRule.findFirst({ where: { id: ruleId, ...where(ctx) } });
  if (!r) throw notFound("Rule");
  if (!(r.ownerMemberId === ctx.me.id || (r.scope === "HOUSEHOLD" && ctx.isAdmin))) throw forbidden("You can only change your own rules");
  return r;
}
export async function updateRule(ctx: FinCtx, ruleId: string, patch: z.infer<typeof rulePatchSchema>) {
  const r = await editable(ctx, ruleId);
  if (patch.actions) await checkActions(ctx, patch.actions as RuleActions);
  await db.finRule.update({ where: { id: r.id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.priority !== undefined ? { priority: patch.priority } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), ...(patch.conditions ? { conditions: patch.conditions as object } : {}), ...(patch.actions ? { actions: clean(patch.actions as RuleActions) as object } : {}) } });
  await audit(null, ctx.actor, { entity: "FinRule", entityId: r.id, action: "update", householdId: ctx.householdId });
  return { id: r.id };
}
export async function deleteRule(ctx: FinCtx, ruleId: string) {
  const r = await editable(ctx, ruleId);
  await db.finRule.delete({ where: { id: r.id } });
  await audit(null, ctx.actor, { entity: "FinRule", entityId: r.id, action: "delete", householdId: ctx.householdId });
  return { ok: true };
}

/** Used when a transaction is created or imported: explicit choices always win, rules fill the gaps. */
export async function withRules<T extends { type: string; accountId: string; amount: string | number; description: string; categoryId?: string | null; vehicleId?: string | null; merchant?: string | null; tags?: string[] | null }>(ctx: FinCtx, input: T, opts: { count?: boolean } = {}): Promise<T> {
  if (input.type !== "INCOME" && input.type !== "EXPENSE" && input.type !== "REFUND") return input;
  const rows = await db.finRule.findMany({ where: { ...where(ctx), active: true } });
  if (!rows.length) return input;
  const out = applyRules(rows.map(asLite), { description: input.description, merchant: input.merchant, amount: input.amount, type: input.type, accountId: input.accountId });
  if (!out.matched.length) return input;
  if (opts.count !== false) await db.finRule.updateMany({ where: { id: { in: out.matched } }, data: { hitCount: { increment: 1 }, lastHitAt: new Date() } });
  const kindOk = out.categoryId ? (await loadCategories(ctx)).find((c) => c.id === out.categoryId)?.kind === (input.type === "INCOME" ? "INCOME" : "EXPENSE") : false;
  let vehicleId = input.vehicleId ?? null;
  if (!vehicleId && out.vehicleId) { try { await assertVehicleLink(ctx, out.vehicleId); vehicleId = out.vehicleId; } catch { /* the member cannot use that vehicle: skip it */ } }
  return { ...input, categoryId: input.categoryId || (kindOk ? out.categoryId : undefined) || input.categoryId, vehicleId, merchant: input.merchant || out.merchant || input.merchant, tags: normaliseTags([...(input.tags ?? []), ...out.tags]) };
}

/** How many of the transactions you can see would this rule have matched in the last year. */
export async function previewRule(ctx: FinCtx, input: z.infer<typeof previewSchema>) {
  const since = new Date(Date.now() - 365 * 86400_000);
  const rows = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, type: { in: ["INCOME", "EXPENSE", "REFUND"] }, date: { gte: since }, ...visWhere(ctx, "all") }, select: { id: true, description: true, amount: true, type: true, accountId: true, date: true, merchant: { select: { name: true } } }, orderBy: { date: "desc" }, take: 5000 });
  const hits = rows.filter((t) => ruleMatches(input.conditions as RuleConditions, { description: t.description, merchant: t.merchant?.name, amount: t.amount.toString(), type: t.type, accountId: t.accountId }));
  return { matched: hits.length, scanned: rows.length, samples: hits.slice(0, 8).map((t) => ({ id: t.id, description: t.description, amount: t.amount.toString(), date: t.date.toISOString().slice(0, 10) })) };
}

/** Back-fills older transactions that are still uncategorised (or have no tags or vehicle). Only records the actor may edit are touched, and nothing already set is changed. */
export async function applyRulesToExisting(ctx: FinCtx, input: z.infer<typeof applyExistingSchema>) {
  requireWriter(ctx);
  const rows = await db.finRule.findMany({ where: { ...where(ctx), active: true, ...(input.ruleId ? { id: input.ruleId } : {}) } });
  if (!rows.length) return { updated: 0, scanned: 0 };
  const cats = await loadCategories(ctx);
  const txs = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, type: { in: ["INCOME", "EXPENSE", "REFUND"] }, ...visWhere(ctx, "all") }, select: { id: true, description: true, amount: true, type: true, accountId: true, categoryId: true, vehicleId: true, tags: true, ownerMemberId: true, visibility: true, sharedWithMemberIds: true, merchant: { select: { name: true } } }, take: 20000 });
  let updated = 0;
  for (const t of txs) {
    if (!canEdit(ctx, { ownerMemberId: t.ownerMemberId, visibility: t.visibility, sharedWithMemberIds: t.sharedWithMemberIds } as never)) continue;
    const out = applyRules(rows.map(asLite), { description: t.description, merchant: t.merchant?.name, amount: t.amount.toString(), type: t.type, accountId: t.accountId });
    if (!out.matched.length) continue;
    const data: Record<string, unknown> = {};
    const catKind = out.categoryId ? cats.find((c) => c.id === out.categoryId)?.kind : null;
    if (!t.categoryId && out.categoryId && catKind === (t.type === "INCOME" ? "INCOME" : "EXPENSE")) data.categoryId = out.categoryId;
    if (!t.vehicleId && out.vehicleId) { try { await assertVehicleLink(ctx, out.vehicleId); data.vehicleId = out.vehicleId; } catch { /* skip */ } }
    const tags = normaliseTags([...t.tags, ...out.tags]);
    if (tags.length !== t.tags.length) data.tags = tags;
    if (!Object.keys(data).length) continue;
    await db.finTransaction.update({ where: { id: t.id }, data: { ...data, updatedById: ctx.actor.id } });
    updated++;
  }
  await audit(null, ctx.actor, { entity: "FinRule", action: "apply-existing", householdId: ctx.householdId, after: { updated } });
  return { updated, scanned: txs.length };
}
