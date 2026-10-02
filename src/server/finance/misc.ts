// Small cross-cutting services: analytics endpoint, record history, exchange rates and personal data export.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { D, money } from "./engine/decimal";
import { addMonths, endOfMonth, startOfMonth } from "./engine/dates";
import { audit } from "../services/audit";
import { currencyCode, dateIso, id, isoDate, toDate } from "./common";
import { memberRef, requireWriter, visWhere, type FinCtx } from "./access";
import { parentSharing } from "./docaccess";
import { canSee } from "./access";
import { summarise, trend } from "./analytics";

export const analyticsQuery = z.object({ scope: z.enum(["my", "household"]).default("my"), member: id.optional(), from: isoDate.optional(), to: isoDate.optional() });
/** Spending analysis for a view or for one member's records (only what the viewer may see). */
export async function getAnalytics(ctx: FinCtx, q: z.infer<typeof analyticsQuery>) {
  const from = q.from ?? startOfMonth(addMonths(ctx.today, -5)), to = q.to ?? endOfMonth(ctx.today);
  const scope = q.member ? (q.member === ctx.me.id ? ("my" as const) : { member: q.member }) : q.scope;
  const [s, t] = await Promise.all([summarise(ctx, scope, from, to), trend(ctx, scope, from, to)]);
  return { ...s, ...t, member: q.member ? memberRef(ctx, q.member) : null };
}

const ENTITIES: Record<string, string> = { transaction: "FinTransaction", income: "IncomeSource", account: "FinAccount", bill: "Bill", debt: "Debt", goal: "SavingsGoal", asset: "Asset", insurance: "InsurancePolicy", subscription: "Subscription" };
/** Audit trail for one record. Only available to someone who can see the record itself. */
export async function auditHistory(ctx: FinCtx, entity: string, entityId: string) {
  const name = ENTITIES[entity];
  if (!name) throw new AppError("NOT_FOUND", "Unknown record type");
  let sharing = await parentSharing(ctx.householdId, entity, entityId);
  if (!sharing && entity === "account") sharing = await db.finAccount.findFirst({ where: { id: entityId, householdId: ctx.householdId, deletedAt: null }, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
  if (!sharing && entity === "goal") sharing = await db.savingsGoal.findFirst({ where: { id: entityId, householdId: ctx.householdId, deletedAt: null }, select: { ownerMemberId: true, visibility: true, sharedWithMemberIds: true } });
  if (!sharing || !canSee(ctx, sharing)) throw new AppError("NOT_FOUND", "Record not found");
  const rows = await db.auditLog.findMany({ where: { householdId: ctx.householdId, entity: name, entityId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((h) => ({ id: h.id, action: h.action, at: h.createdAt.toISOString(), by: memberRef(ctx, ctx.members.find((m) => m.userId === h.userId)?.id), before: h.before, after: h.after }));
}

export const fxSchema = z.object({ base: currencyCode, quote: currencyCode, rate: z.union([z.string(), z.number()]).refine((v) => Number(v) > 0 && Number.isFinite(Number(v)), "Rate must be positive"), asOf: isoDate, source: z.string().max(60).default("manual") });
export async function listFx(ctx: FinCtx) {
  const rows = await db.fxRate.findMany({ where: { householdId: ctx.householdId }, orderBy: [{ asOf: "desc" }, { base: "asc" }] });
  return rows.map((r) => ({ id: r.id, base: r.base, quote: r.quote, rate: r.rate.toString(), asOf: dateIso(r.asOf), source: r.source }));
}
export async function saveFx(ctx: FinCtx, i: z.infer<typeof fxSchema>) {
  requireWriter(ctx);
  if (i.base === i.quote) throw new AppError("VALIDATION_ERROR", "Choose two different currencies");
  const r = await db.fxRate.upsert({ where: { householdId_base_quote_asOf: { householdId: ctx.householdId, base: i.base, quote: i.quote, asOf: toDate(i.asOf) } }, create: { householdId: ctx.householdId, base: i.base, quote: i.quote, rate: String(i.rate), asOf: toDate(i.asOf), source: i.source }, update: { rate: String(i.rate), source: i.source } });
  await audit(null, ctx.actor, { entity: "FxRate", entityId: r.id, action: "save", householdId: ctx.householdId, after: i });
  return { id: r.id };
}
export async function deleteFx(ctx: FinCtx, fxId: string) {
  requireWriter(ctx);
  const r = await db.fxRate.findFirst({ where: { id: fxId, householdId: ctx.householdId } });
  if (!r) throw new AppError("NOT_FOUND", "Rate not found");
  await db.fxRate.delete({ where: { id: r.id } });
  return { ok: true };
}

/** A machine readable export of everything the signed-in member can see in this household. */
export async function exportMyData(ctx: FinCtx) {
  const w = { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, "all") };
  const [accounts, txs, income, bills, debts, goals, assets, subs, ins, tax] = await Promise.all([
    db.finAccount.findMany({ where: w }), db.finTransaction.findMany({ where: w, include: { allocations: true } }), db.incomeSource.findMany({ where: w }), db.bill.findMany({ where: w }), db.debt.findMany({ where: w }), db.savingsGoal.findMany({ where: w }), db.asset.findMany({ where: w }), db.recurringSubscription.findMany({ where: w }), db.insurancePolicy.findMany({ where: w }), db.taxRecord.findMany({ where: w }),
  ]);
  const clean = (rows: object[]) => JSON.parse(JSON.stringify(rows));
  return { exportedAt: new Date().toISOString(), format: "family-finance-hub-export-v1", household: { id: ctx.householdId, name: ctx.household.name, currency: ctx.base }, note: "Contains only records you own or that were shared with you.", accounts: clean(accounts), transactions: clean(txs), income: clean(income), bills: clean(bills), debts: clean(debts), goals: clean(goals), assets: clean(assets), subscriptions: clean(subs), insurance: clean(ins), taxRecords: clean(tax) };
}
export { money, D };
