// Household contributions: independent tracking, shared accountability. Presented neutrally: positions and differences, never rankings.
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { analyseContributions, ARRANGEMENT_LABEL, type Arrangement, type ArrangementKind, type ContribExpense } from "./engine/contribution";
import { monthsBetween, previousPeriod } from "./engine/dates";
import { audit } from "../services/audit";
import { dateIso, id, isoDate, moneyIn, optText, posMoney, text, toDate } from "./common";
import { memberRef, requireAccount, requireMember, requireWriter, visWhere, clampToAccount, resolveVisibility, type FinCtx } from "./access";
import { loadReportTxs, iso } from "./load";
import { allocationsOf, netExpense } from "./analytics";
import { incomeSummary } from "./income";

export const ruleSchema = z.object({
  name: text(80),
  arrangement: z.enum(["INDEPENDENT", "SHARED_EQUAL", "INCOME_BASED", "FIXED", "CUSTOM"]),
  participants: z.array(id).max(50).default([]),
  percentOfNet: z.union([z.string(), z.number()]).nullish(),
  fixedMonthly: z.record(z.string(), moneyIn).optional(),
  customShares: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  effectiveFrom: isoDate,
  active: z.boolean().default(true),
});

function toArrangement(ctx: FinCtx, r: { arrangement: string; settings: unknown }): Arrangement {
  const s = (r.settings ?? {}) as { participants?: string[]; percentOfNet?: number | string | null; fixedMonthly?: Record<string, string>; customShares?: Record<string, string | number> };
  return { kind: r.arrangement as ArrangementKind, participants: (s.participants?.length ? s.participants : ctx.members.filter((m) => m.role !== "READ_ONLY").map((m) => m.id)), percentOfNet: s.percentOfNet ?? null, fixedMonthly: s.fixedMonthly, customShares: s.customShares };
}
const ruleView = (ctx: FinCtx, r: { id: string; name: string; arrangement: string; settings: unknown; effectiveFrom: Date; active: boolean }) => ({ id: r.id, name: r.name, arrangement: r.arrangement, label: ARRANGEMENT_LABEL[r.arrangement as ArrangementKind], settings: r.settings, effectiveFrom: dateIso(r.effectiveFrom), active: r.active, participants: toArrangement(ctx, r).participants.map((p) => memberRef(ctx, p)) });

function validateRule(ctx: FinCtx, i: z.infer<typeof ruleSchema>) {
  for (const p of i.participants) requireMember(ctx, p);
  if (i.arrangement === "CUSTOM") {
    const total = Object.values(i.customShares ?? {}).reduce((a, v) => a.plus(D(v)), ZERO);
    if (!total.eq(100)) throw new AppError("VALIDATION_ERROR", `Custom shares add up to ${total.toString()} percent, but they must add up to 100`, { fieldErrors: { customShares: ["Must total 100"] } });
    for (const k of Object.keys(i.customShares ?? {})) requireMember(ctx, k);
  }
  if (i.arrangement === "FIXED" && !Object.keys(i.fixedMonthly ?? {}).length) throw new AppError("VALIDATION_ERROR", "Enter a fixed monthly amount for at least one member");
  if (i.arrangement === "INCOME_BASED" && i.percentOfNet !== undefined && i.percentOfNet !== null && (D(i.percentOfNet).lt(0) || D(i.percentOfNet).gt(100))) throw new AppError("VALIDATION_ERROR", "Percent of net income must be between 0 and 100");
  for (const k of Object.keys(i.fixedMonthly ?? {})) requireMember(ctx, k);
}
const settingsOf = (i: z.infer<typeof ruleSchema>) => ({ participants: i.participants, percentOfNet: i.percentOfNet ?? null, fixedMonthly: i.fixedMonthly ?? {}, customShares: i.customShares ?? {} });

export async function listRules(ctx: FinCtx) {
  const rows = await db.contributionRule.findMany({ where: { householdId: ctx.householdId }, orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }] });
  return rows.map((r) => ruleView(ctx, r));
}
export async function createRule(ctx: FinCtx, input: z.infer<typeof ruleSchema>) {
  requireWriter(ctx);
  validateRule(ctx, input);
  const r = await db.contributionRule.create({ data: { householdId: ctx.householdId, name: input.name, arrangement: input.arrangement, settings: settingsOf(input), effectiveFrom: toDate(input.effectiveFrom), active: input.active, createdById: ctx.actor.id } });
  await audit(null, ctx.actor, { entity: "ContributionRule", entityId: r.id, action: "create", householdId: ctx.householdId, after: { arrangement: input.arrangement } });
  return { id: r.id };
}
export async function updateRule(ctx: FinCtx, ruleId: string, input: z.infer<typeof ruleSchema>) {
  requireWriter(ctx);
  const r = await db.contributionRule.findFirst({ where: { id: ruleId, householdId: ctx.householdId } });
  if (!r) throw new AppError("NOT_FOUND", "Rule not found");
  validateRule(ctx, input);
  await db.contributionRule.update({ where: { id: r.id }, data: { name: input.name, arrangement: input.arrangement, settings: settingsOf(input), effectiveFrom: toDate(input.effectiveFrom), active: input.active } });
  await audit(null, ctx.actor, { entity: "ContributionRule", entityId: r.id, action: "update", householdId: ctx.householdId, before: { arrangement: r.arrangement, settings: r.settings }, after: input });
  return { id: r.id };
}
export async function deleteRule(ctx: FinCtx, ruleId: string) {
  requireWriter(ctx);
  const r = await db.contributionRule.findFirst({ where: { id: ruleId, householdId: ctx.householdId } });
  if (!r) throw new AppError("NOT_FOUND", "Rule not found");
  await db.contributionRule.delete({ where: { id: r.id } });
  await audit(null, ctx.actor, { entity: "ContributionRule", entityId: r.id, action: "delete", householdId: ctx.householdId });
  return { ok: true };
}

export const settlementSchema = z.object({
  fromMemberId: id, toMemberId: id, amount: posMoney, date: isoDate, note: optText(300),
  /** Optional: record the matching ledger movement on accounts you can access so balances reconcile. Never income or expense. */
  fromAccountId: id.nullish(), toAccountId: id.nullish(),
});

export async function listSettlements(ctx: FinCtx, from?: string, to?: string) {
  const rows = await db.settlement.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...(from || to ? { date: { ...(from ? { gte: toDate(from) } : {}), ...(to ? { lte: toDate(to) } : {}) } } : {}) }, orderBy: { date: "desc" } });
  return rows.map((s) => ({ id: s.id, from: memberRef(ctx, s.fromMemberId), to: memberRef(ctx, s.toMemberId), amount: money(s.amount), currency: s.currency, date: dateIso(s.date), note: s.note, enteredBy: memberRef(ctx, ctx.members.find((m) => m.userId === s.createdById)?.id), canDelete: s.fromMemberId === ctx.me.id || s.toMemberId === ctx.me.id || s.createdById === ctx.actor.id }));
}

/** A reimbursement between members. It is never an expense: it only moves each member's position and, optionally, account balances. */
export async function createSettlement(ctx: FinCtx, input: z.infer<typeof settlementSchema>) {
  requireWriter(ctx);
  requireMember(ctx, input.fromMemberId);
  requireMember(ctx, input.toMemberId);
  if (input.fromMemberId === input.toMemberId) throw new AppError("VALIDATION_ERROR", "Choose two different members");
  if (![input.fromMemberId, input.toMemberId].includes(ctx.me.id)) throw forbidden("You can only record a settlement that you are part of");
  const fromA = input.fromAccountId ? await requireAccount(ctx, input.fromAccountId, { write: true }) : null;
  const toA = input.toAccountId ? await requireAccount(ctx, input.toAccountId, { write: true }) : null;
  const s = await db.$transaction(async (tx) => {
    const st = await tx.settlement.create({ data: { householdId: ctx.householdId, fromMemberId: input.fromMemberId, toMemberId: input.toMemberId, amount: input.amount, currency: ctx.base, date: toDate(input.date), note: input.note ?? null, createdById: ctx.actor.id } });
    for (const [acct, sign] of [[fromA, -1], [toA, 1]] as const) {
      if (!acct) continue;
      const vis = clampToAccount(acct, resolveVisibility(ctx, {}, "transactions"));
      await tx.finTransaction.create({ data: { householdId: ctx.householdId, accountId: acct.id, type: "SETTLEMENT", amount: sign === -1 ? D(input.amount).negated().toFixed(2) : D(input.amount).toFixed(2), currency: acct.currency, date: toDate(input.date), description: "Settlement between members", notes: input.note ?? null, transferGroupId: st.id, ownerMemberId: ctx.me.id, payerMemberId: ctx.me.id, ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id } });
    }
    await audit(tx, ctx.actor, { entity: "Settlement", entityId: st.id, action: "create", householdId: ctx.householdId, after: { from: input.fromMemberId, to: input.toMemberId, amount: input.amount } });
    return st;
  });
  return { id: s.id };
}
export async function deleteSettlement(ctx: FinCtx, settlementId: string) {
  requireWriter(ctx);
  const s = await db.settlement.findFirst({ where: { id: settlementId, householdId: ctx.householdId, deletedAt: null } });
  if (!s) throw new AppError("NOT_FOUND", "Settlement not found");
  if (![s.fromMemberId, s.toMemberId].includes(ctx.me.id) && s.createdById !== ctx.actor.id) throw forbidden();
  await db.$transaction(async (tx) => {
    await tx.settlement.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    await tx.finTransaction.updateMany({ where: { transferGroupId: s.id, type: "SETTLEMENT", deletedAt: null }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await audit(tx, ctx.actor, { entity: "Settlement", entityId: s.id, action: "delete", householdId: ctx.householdId });
  });
  return { ok: true };
}

export const previewSchema = z.object({ from: isoDate, to: isoDate, rule: ruleSchema.partial({ name: true, effectiveFrom: true, active: true }).optional() });

/**
 * Contribution analysis for a period over the household view: only records shared with the household (or with the viewer) count,
 * so the figures are identical for every member who can see the same records.
 */
export async function contributionReport(ctx: FinCtx, from: string, to: string, override?: z.infer<typeof previewSchema>["rule"]) {
  const [{ txs, missingRates }, rules, settlements, income] = await Promise.all([loadReportTxs(ctx, from, to, "household"), db.contributionRule.findMany({ where: { householdId: ctx.householdId, active: true, effectiveFrom: { lte: toDate(to) } }, orderBy: { effectiveFrom: "desc" }, take: 1 }), listSettlements(ctx, from, to), incomeSummary(ctx, "household")]);
  const base: Arrangement = override ? toArrangement(ctx, { arrangement: override.arrangement, settings: { participants: override.participants, percentOfNet: override.percentOfNet, fixedMonthly: override.fixedMonthly, customShares: override.customShares } }) : rules[0] ? toArrangement(ctx, rules[0]) : { kind: "INDEPENDENT", participants: ctx.members.map((m) => m.id) };
  const expenses: ContribExpense[] = [];
  const billsPaid = new Map<string, Dec>();
  for (const t of txs) {
    const ne = netExpense(t);
    if (ne === null) continue;
    expenses.push({ id: t.id, amount: ne, payerId: t.payerId, allocations: allocationsOf(t) });
    if (t.billId && t.payerId) billsPaid.set(t.payerId, (billsPaid.get(t.payerId) ?? ZERO).plus(ne));
  }
  // contributions into joint accounts: transfers from a member's own account into a household account
  const jointLegs = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, type: "TRANSFER", status: "POSTED", amount: { gt: 0 }, date: { gte: toDate(from), lte: toDate(to) }, account: { ownerMemberId: null, deletedAt: null }, ...visWhere(ctx, "household") }, select: { ownerMemberId: true, amount: true } });
  const toShared: Record<string, Dec> = {};
  for (const l of jointLegs) if (l.ownerMemberId) toShared[l.ownerMemberId] = (toShared[l.ownerMemberId] ?? ZERO).plus(D(l.amount));
  const netMonthly: Record<string, Dec | null> = {};
  for (const m of ctx.members) {
    const row = income.members.find((x) => x.member?.id === m.id);
    netMonthly[m.id] = row ? D(row.monthlyNet) : null;
  }
  const months = Math.max(1, Math.round(monthsBetween(from, iso(new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000))).toNumber()));
  const analysis = analyseContributions({ members: ctx.members.map((m) => ({ id: m.id, name: m.name })), expenses, settlements: settlements.map((s) => ({ fromMemberId: s.from?.id as string, toMemberId: s.to?.id as string, amount: s.amount })), transfersToShared: toShared, netMonthly, months, arrangement: base });

  const [goalRows, debtRows] = await Promise.all([
    db.goalContribution.findMany({ where: { deletedAt: null, date: { gte: toDate(from), lte: toDate(to) }, goal: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, "household") } }, include: { goal: { select: { name: true, visibility: true, kind: true } } } }),
    db.debtPayment.findMany({ where: { deletedAt: null, date: { gte: toDate(from), lte: toDate(to) }, debt: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, "household") } }, select: { memberId: true, total: true, principal: true, interest: true } }),
  ]);
  const sum = (m: Map<string, Dec>, k: string | null, v: Dec) => k && m.set(k, (m.get(k) ?? ZERO).plus(v));
  const savings = new Map<string, Dec>(), goals = new Map<string, Dec>(), debt = new Map<string, Dec>();
  for (const g of goalRows) { sum(goals, g.memberId, D(g.amount)); if (g.goal.kind !== "DEBT_PAYOFF") sum(savings, g.memberId, D(g.amount)); }
  for (const d of debtRows) sum(debt, d.memberId, D(d.total));
  const per = analysis.members.map((m) => {
    const inc = income.members.find((x) => x.member?.id === m.memberId);
    const g = (map: Map<string, Dec>) => money(map.get(m.memberId) ?? ZERO);
    return {
      member: memberRef(ctx, m.memberId), monthlyGrossIncome: inc?.monthlyGross ?? null, monthlyNetIncome: inc?.monthlyNet ?? null, incomeShare: inc?.share ?? null,
      paidTotal: money(m.paidTotal), paidForSharedExpenses: money(m.paidForShared), paidForOthers: money(m.paidForOthers), allocatedPersonal: money(m.allocatedPersonal), shareOfSharedExpenses: money(m.shareOfPool), owedTotal: money(m.owedTotal),
      sharedBillsPaid: g(billsPaid), transfersToJointAccounts: money(toShared[m.memberId] ?? ZERO), settlementsPaid: money(m.settlementsPaid), settlementsReceived: money(m.settlementsReceived), netPosition: money(m.netPosition),
      target: m.target ? money(m.target) : null, actualContribution: money(m.actualContribution), gapToTarget: m.gapToTarget ? money(m.gapToTarget) : null,
      savingsContributions: g(savings), goalContributions: g(goals), debtPayments: g(debt),
    };
  });
  return {
    from, to, currency: ctx.base, months, arrangement: { kind: base.kind, label: ARRANGEMENT_LABEL[base.kind], rule: rules[0] ? ruleView(ctx, rules[0]) : null, preview: !!override },
    pool: money(analysis.pool), personalTotal: money(analysis.personalTotal), total: money(analysis.total), paidFromJointAccounts: money(analysis.paidFromJointAccounts), members: per,
    suggestedSettlements: analysis.suggestedSettlements.map((s) => ({ from: memberRef(ctx, s.fromMemberId), to: memberRef(ctx, s.toMemberId), amount: money(s.amount) })), settlements, notes: [...analysis.notes, "Only records shared with the household, or with you, are included. Private records of any member are never part of this report.", ...(missingRates.length ? [`Exchange rates are missing for ${missingRates.join(", ")}; those rows are excluded.`] : [])],
    explanation: "Paid is who made the payment. Allocated is who the cost belongs to. An expense is counted once in household totals regardless of how it is allocated. Settlements move positions between members and are never expenses.",
  };
}
export const previousRange = previousPeriod;
export { optText };
