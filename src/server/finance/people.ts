// People: comments on records, and the wish list with approvals.
// A comment is exactly as visible as the record it is on. A wish is visible to the person who made it and to the household's adults.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { audit } from "../services/audit";
import { D, money } from "./engine/decimal";
import { canSee, type FinCtx, type Shareable } from "./access";
import { id, nonNegMoney, optText, text } from "./common";
import { parentSharing } from "./docaccess";

const isAdult = (role: string) => role === "ADMIN" || role === "MEMBER";
const canParticipate = (ctx: FinCtx) => ["ADMIN", "MEMBER", "CHILD", "ACCOUNTANT"].includes(ctx.me.role);
const notify = async (ctx: FinCtx, memberIds: string[], title: string, body: string, actionUrl: string, key: string) => {
  const users = ctx.members.filter((m) => memberIds.includes(m.id) && m.userId !== ctx.actor.id);
  for (const u of users) await db.notification.upsert({ where: { userId_dedupeKey: { userId: u.userId, dedupeKey: key } }, create: { userId: u.userId, householdId: ctx.householdId, type: "SYSTEM", severity: "INFO", title, body, actionUrl, dedupeKey: key, deliveredInAppAt: new Date() }, update: {} });
};

// ───────────── comments
export const COMMENT_ENTITIES = ["transaction", "bill", "goal", "income", "debt", "wish"] as const;
export const commentQuery = z.object({ entity: z.enum(COMMENT_ENTITIES), entityId: id });
export const commentSchema = commentQuery.extend({ body: text(1000) });

type Parent = { share: Shareable | null; audience: "record" | "wish"; owner: string | null };
async function parent(ctx: FinCtx, entity: string, entityId: string): Promise<Parent | null> {
  if (entity === "wish") {
    const w = await db.wishItem.findFirst({ where: { id: entityId, householdId: ctx.householdId, deletedAt: null } });
    return w && wishVisible(ctx, w) ? { share: null, audience: "wish", owner: w.requestedByMemberId } : null;
  }
  const s = entity === "goal" ? await db.savingsGoal.findFirst({ where: { id: entityId, householdId: ctx.householdId, deletedAt: null }, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } }) : await parentSharing(ctx.householdId, entity, entityId);
  return s && canSee(ctx, s) ? { share: s, audience: "record", owner: s.ownerMemberId } : null;
}

export async function listComments(ctx: FinCtx, q: z.infer<typeof commentQuery>) {
  if (!(await parent(ctx, q.entity, q.entityId))) throw notFound("Record");
  const rows = await db.finComment.findMany({ where: { householdId: ctx.householdId, entity: q.entity, entityId: q.entityId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map((c) => { const a = ctx.members.find((m) => m.id === c.authorMemberId); return { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: a ? { id: a.id, name: a.name, color: a.avatarColor } : null, mine: c.authorMemberId === ctx.me.id, canDelete: c.authorMemberId === ctx.me.id || ctx.isAdmin }; });
}

export async function addComment(ctx: FinCtx, input: z.infer<typeof commentSchema>) {
  if (!canParticipate(ctx)) throw forbidden("Your access to this household is read-only");
  const p = await parent(ctx, input.entity, input.entityId);
  if (!p) throw notFound("Record");
  const c = await db.finComment.create({ data: { householdId: ctx.householdId, entity: input.entity, entityId: input.entityId, authorMemberId: ctx.me.id, body: input.body } });
  const who = new Set<string>();
  if (p.owner) who.add(p.owner);
  const prior = await db.finComment.findMany({ where: { householdId: ctx.householdId, entity: input.entity, entityId: input.entityId, deletedAt: null }, select: { authorMemberId: true } });
  for (const x of prior) who.add(x.authorMemberId);
  // Only people who may see the record are told about it.
  const eligible = [...who].filter((mid) => { const m = ctx.members.find((x) => x.id === mid); return !!m && (p.audience === "wish" ? mid === p.owner || isAdult(m.role) : p.share ? canSee({ me: m }, p.share) : false); });
  await notify(ctx, eligible, `${ctx.me.name} commented`, input.body.slice(0, 140), input.entity === "wish" ? "/wishlist" : input.entity === "goal" ? "/goals" : "/transactions", `comment:${c.id}`);
  return { id: c.id };
}

export async function deleteComment(ctx: FinCtx, commentId: string) {
  const c = await db.finComment.findFirst({ where: { id: commentId, householdId: ctx.householdId, deletedAt: null } });
  if (!c || !(await parent(ctx, c.entity, c.entityId))) throw notFound("Comment");
  if (c.authorMemberId !== ctx.me.id && !ctx.isAdmin) throw forbidden();
  await db.finComment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

// ───────────── wish list
type Wish = Awaited<ReturnType<typeof db.wishItem.findFirstOrThrow>>;
function wishVisible(ctx: FinCtx, w: Pick<Wish, "requestedByMemberId" | "householdId">) {
  return w.householdId === ctx.householdId && (w.requestedByMemberId === ctx.me.id || isAdult(ctx.me.role));
}
export const wishSchema = z.object({ name: text(120), estimatedCost: nonNegMoney, url: optText(500), note: optText(500) });
export const decisionSchema = z.object({ decision: z.enum(["APPROVED", "DECLINED"]), note: optText(300) });

const view = (ctx: FinCtx, w: Wish) => {
  const by = ctx.members.find((m) => m.id === w.requestedByMemberId), dec = ctx.members.find((m) => m.id === w.decidedByMemberId);
  const mine = w.requestedByMemberId === ctx.me.id;
  return { id: w.id, name: w.name, estimatedCost: money(w.estimatedCost), url: w.url, note: w.note, status: w.status, requestedBy: by ? { id: by.id, name: by.name, color: by.avatarColor } : null, mine, decidedBy: dec?.name ?? null, decidedAt: w.decidedAt?.toISOString() ?? null, decisionNote: w.decisionNote, createdAt: w.createdAt.toISOString(),
    canDecide: isAdult(ctx.me.role) && !mine && w.status === "PENDING", canCancel: mine && (w.status === "PENDING" || w.status === "APPROVED"), canMarkPurchased: w.status === "APPROVED" && (mine || isAdult(ctx.me.role)) };
};

export async function listWishes(ctx: FinCtx) {
  const rows = await db.wishItem.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...(isAdult(ctx.me.role) ? {} : { requestedByMemberId: ctx.me.id }) }, orderBy: [{ createdAt: "desc" }] });
  const items = rows.map((w) => view(ctx, w));
  const pending = items.filter((i) => i.status === "PENDING");
  return { items, summary: { pending: pending.length, pendingTotal: money(pending.reduce((a, i) => a.plus(D(i.estimatedCost)), D(0))), currency: ctx.base }, canRequest: canParticipate(ctx) && ctx.me.role !== "ACCOUNTANT" };
}

export async function createWish(ctx: FinCtx, input: z.infer<typeof wishSchema>) {
  if (!canParticipate(ctx) || ctx.me.role === "ACCOUNTANT") throw forbidden("Your access to this household is read-only");
  const w = await db.wishItem.create({ data: { householdId: ctx.householdId, requestedByMemberId: ctx.me.id, name: input.name, estimatedCost: input.estimatedCost, url: input.url ?? null, note: input.note ?? null } });
  await notify(ctx, ctx.members.filter((m) => isAdult(m.role)).map((m) => m.id), `${ctx.me.name} added a wish`, `${input.name}, about ${money(input.estimatedCost)}`, "/wishlist", `wish:${w.id}:new`);
  await audit(null, ctx.actor, { entity: "WishItem", entityId: w.id, action: "create", householdId: ctx.householdId, after: { name: input.name } });
  return { id: w.id };
}

async function loadWish(ctx: FinCtx, wishId: string) {
  const w = await db.wishItem.findFirst({ where: { id: wishId, householdId: ctx.householdId, deletedAt: null } });
  if (!w || !wishVisible(ctx, w)) throw notFound("Wish");
  return w;
}

export async function decideWish(ctx: FinCtx, wishId: string, input: z.infer<typeof decisionSchema>) {
  const w = await loadWish(ctx, wishId);
  if (!isAdult(ctx.me.role) || w.requestedByMemberId === ctx.me.id) throw forbidden("Someone else in the household has to decide this");
  if (w.status !== "PENDING") throw new AppError("CONFLICT", "This wish has already been decided");
  await db.wishItem.update({ where: { id: w.id }, data: { status: input.decision, decidedByMemberId: ctx.me.id, decidedAt: new Date(), decisionNote: input.note ?? null } });
  await notify(ctx, [w.requestedByMemberId], input.decision === "APPROVED" ? `Your wish was approved: ${w.name}` : `Your wish was declined: ${w.name}`, input.note ?? "", "/wishlist", `wish:${w.id}:${input.decision}`);
  await audit(null, ctx.actor, { entity: "WishItem", entityId: w.id, action: input.decision.toLowerCase(), householdId: ctx.householdId });
  return { ok: true };
}

export async function updateWishStatus(ctx: FinCtx, wishId: string, to: "PURCHASED" | "CANCELLED") {
  const w = await loadWish(ctx, wishId);
  const mine = w.requestedByMemberId === ctx.me.id;
  if (to === "CANCELLED") { if (!mine || !["PENDING", "APPROVED"].includes(w.status)) throw forbidden(); }
  else if (w.status !== "APPROVED" || !(mine || isAdult(ctx.me.role))) throw forbidden("Only an approved wish can be marked as bought");
  await db.wishItem.update({ where: { id: w.id }, data: { status: to } });
  return { ok: true };
}
