// Tags (free labels on transactions) and each member's saved filters and report setups.
import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { money, ZERO, type Dec } from "./engine/decimal";
import { netExpense } from "./analytics";
import { loadReportTxs } from "./load";
import { requireWriter, type FinCtx } from "./access";
import { isoDate, text } from "./common";

export const tagSummaryQuery = z.object({ view: z.enum(["my", "household"]).default("household"), from: isoDate.optional(), to: isoDate.optional() });

/** Spending by tag for the period. A transaction with two tags counts toward both, so tag totals can add up to more than total spending. */
export async function tagSummary(ctx: FinCtx, q: z.infer<typeof tagSummaryQuery>) {
  const to = q.to ?? ctx.today;
  const from = q.from ?? `${to.slice(0, 4)}-01-01`;
  const { txs } = await loadReportTxs(ctx, from, to, q.view);
  const by = new Map<string, { spend: Dec; count: number }>();
  for (const t of txs) {
    const ne = netExpense(t);
    if (ne === null || !t.tags?.length) continue;
    for (const tag of t.tags) { const cur = by.get(tag) ?? { spend: ZERO, count: 0 }; by.set(tag, { spend: cur.spend.plus(ne), count: cur.count + 1 }); }
  }
  return {
    view: q.view, from, to, currency: ctx.base,
    tags: [...by].map(([tag, v]) => ({ tag, spend: money(v.spend), count: v.count })).sort((a, b) => Number(b.spend) - Number(a.spend)),
    note: "A transaction with several tags counts toward each of them, so tag totals can add up to more than total spending.",
  };
}

/** Distinct tags on records you can see, for suggestions in the form. */
export async function listTags(ctx: FinCtx) {
  const rows = await db.$queryRaw<{ tag: string; n: bigint }[]>`SELECT t AS tag, COUNT(*) AS n FROM "FinTransaction", unnest("tags") AS t WHERE "householdId" = ${ctx.householdId} AND "deletedAt" IS NULL AND ("ownerMemberId" = ${ctx.me.id} OR "visibility" = 'HOUSEHOLD' OR ("visibility" = 'SELECTED' AND ${ctx.me.id} = ANY("sharedWithMemberIds"))) GROUP BY t ORDER BY COUNT(*) DESC LIMIT 100`;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
}

const params = z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 30, "Too many fields");
export const savedViewSchema = z.object({ name: text(60), kind: z.enum(["transactions", "report"]), params });

export async function listSavedViews(ctx: FinCtx, kind?: string) {
  const rows = await db.savedView.findMany({ where: { householdId: ctx.householdId, memberId: ctx.me.id, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "asc" } });
  return rows.map((v) => ({ id: v.id, name: v.name, kind: v.kind, params: v.params }));
}
export async function createSavedView(ctx: FinCtx, input: z.infer<typeof savedViewSchema>) {
  requireWriter(ctx);
  const v = await db.savedView.create({ data: { householdId: ctx.householdId, memberId: ctx.me.id, name: input.name, kind: input.kind, params: input.params as object } });
  return { id: v.id };
}
export async function deleteSavedView(ctx: FinCtx, viewId: string) {
  const v = await db.savedView.findFirst({ where: { id: viewId, householdId: ctx.householdId, memberId: ctx.me.id } });
  if (!v) throw notFound("Saved view");
  await db.savedView.delete({ where: { id: v.id } });
  return { ok: true };
}
