// The central ledger.
//
// Ownership model (each answers a different question, and none of them changes a household total):
//   owner     whose record it is (defaults to the signed-in user)
//   enteredBy the user who typed it in (createdById) and the last editor (updatedById), always the authenticated user
//   payer     who actually paid (a member, or the household when paid from a joint account)
//   allocation who the cost is attributed to (a member, the shared household pool, or a split)
//   account   where the money moved
// An expense is stored once. Splitting or reassigning it only changes allocation rows, never the amount counted.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors";
import { D, money, ZERO } from "./engine/decimal";
import { AllocationError, apportion, resolveAllocations, type AllocationMode } from "./engine/allocation";
import { fingerprint } from "./engine/importer";
import { audit } from "../services/audit";
import { csvList, currencyCode, dateIso, id, isoDate, moneyIn, optText, pageQ, posMoney, text, toDate } from "./common";
import { canEdit, canSee, clampToAccount, memberRef, ownerFor, requireAccount, requireInHousehold, requireMember, requireVisible, requireWriter, resolveVisibility, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { upsertMerchant } from "./categories";
import { assertVehicleLink } from "./vehicles";
import { withRules } from "./rules";
import { normaliseTags } from "./engine/rules";

export const TX_TYPES = ["INCOME", "EXPENSE", "REFUND", "REIMBURSEMENT", "ADJUSTMENT"] as const;
const splitPart = z.object({ memberId: id.nullable(), percent: z.union([z.string(), z.number()]).optional(), amount: moneyIn.optional() });
export const allocationSchema = z.object({ mode: z.enum(["OWNER", "MEMBER", "HOUSEHOLD", "SPLIT"]), memberId: id.nullish(), splits: z.array(splitPart).max(20).optional() });

export const txCreateSchema = z.object({
  type: z.enum(TX_TYPES),
  accountId: id,
  amount: moneyIn,
  date: isoDate,
  postingDate: isoDate.nullish(),
  description: text(200),
  categoryId: id.nullish(),
  merchant: optText(100),
  notes: optText(2000),
  status: z.enum(["POSTED", "PLANNED"]).default("POSTED"),
  /** Record this for another household member. Default: the signed-in user. */
  assignToMemberId: id.nullish(),
  /** Who paid: a member id, or "HOUSEHOLD" when paid from a joint account. Default: the owner (or the household for joint accounts). */
  payer: z.string().max(40).nullish(),
  allocation: allocationSchema.optional(),
  ...visibilityFields,
  incomeSourceId: id.nullish(),
  vehicleId: id.nullish(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  recurringRuleId: id.nullish(),
  force: z.boolean().optional(),
  idempotencyKey: z.string().max(80).nullish(),
});
export const txPatchSchema = z.object({
  amount: moneyIn.optional(), date: isoDate.optional(), postingDate: isoDate.nullish(), description: text(200).optional(), categoryId: id.nullish(), merchant: optText(100), notes: optText(2000),
  type: z.enum(["INCOME", "EXPENSE", "REFUND", "REIMBURSEMENT"]).optional(), accountId: id.optional(), status: z.enum(["POSTED", "PLANNED"]).optional(),
  payer: z.string().max(40).nullish(), vehicleId: id.nullish(), tags: z.array(z.string().max(40)).max(10).optional(), allocation: allocationSchema.optional(), assignToMemberId: id.nullish(), reconciliation: z.enum(["UNRECONCILED", "CLEARED", "RECONCILED"]).optional(), ...visibilityFields,
});
export const transferSchema = z.object({ fromAccountId: id, toAccountId: id, amount: posMoney, toAmount: posMoney.optional(), date: isoDate, description: text(200).default("Transfer"), notes: optText(1000), idempotencyKey: z.string().max(80).nullish() });

const sign = (type: string, mag: string) => (type === "EXPENSE" ? D(mag).abs().negated() : type === "ADJUSTMENT" ? D(mag) : D(mag).abs());
const hasAllocations = (t: string) => t === "EXPENSE" || t === "REFUND" || t === "REIMBURSEMENT";

function resolvePayer(ctx: FinCtx, payer: string | null | undefined, ownerId: string, accountJoint: boolean): string | null {
  if (payer === "HOUSEHOLD") return null;
  if (payer) {
    requireMember(ctx, payer);
    return payer;
  }
  return accountJoint ? null : ownerId;
}

/** Validates the requested allocation and returns the stored shape. Failures are reported as validation errors, never saved. */
function buildAllocation(ctx: FinCtx, type: string, amountAbs: string, ownerId: string, input: z.infer<typeof allocationSchema> | undefined, accountJoint: boolean) {
  if (!hasAllocations(type)) return { mode: "OWNER" as AllocationMode, allocatedMemberId: null as string | null, rows: [] as { memberId: string | null; amount: string; percent: string | null }[] };
  const mode: AllocationMode = input?.mode ?? (accountJoint ? "HOUSEHOLD" : "OWNER");
  try {
    if (mode === "MEMBER") requireMember(ctx, input?.memberId);
    for (const s of input?.splits ?? []) if (s.memberId) requireMember(ctx, s.memberId);
    const resolved = resolveAllocations({ amount: amountAbs, mode, ownerId, allocatedMemberId: input?.memberId ?? null, splits: input?.splits });
    return { mode, allocatedMemberId: mode === "MEMBER" ? (input?.memberId ?? null) : null, rows: mode === "SPLIT" ? resolved.map((r) => ({ memberId: r.memberId, amount: money(r.amount), percent: r.percent ? r.percent.toString() : null })) : [] };
  } catch (e) {
    if (e instanceof AllocationError) throw new AppError("VALIDATION_ERROR", e.message, { fieldErrors: { allocation: [e.message] } });
    throw e;
  }
}

async function checkCategory(ctx: FinCtx, categoryId: string | null | undefined, type: string) {
  if (!categoryId) return null;
  const c = requireInHousehold(ctx, await db.finCategory.findUnique({ where: { id: categoryId } }), "Category");
  if (type === "INCOME" && c.kind !== "INCOME") throw new AppError("VALIDATION_ERROR", "Choose an income category for income", { fieldErrors: { categoryId: ["Choose an income category"] } });
  if (hasAllocations(type) && c.kind !== "EXPENSE") throw new AppError("VALIDATION_ERROR", "Choose an expense category", { fieldErrors: { categoryId: ["Choose an expense category"] } });
  return c;
}

export const TX_INCLUDE = { category: { include: { parent: { select: { name: true } } } }, merchant: { select: { name: true } }, allocations: true, account: { select: { id: true, name: true, currency: true, type: true } } } satisfies Prisma.FinTransactionInclude;
type TxFull = Prisma.FinTransactionGetPayload<{ include: typeof TX_INCLUDE }>;

const byUser = (ctx: FinCtx, userId: string | null) => (userId ? memberRef(ctx, ctx.members.find((m) => m.userId === userId)?.id) : null);

export function txView(ctx: FinCtx, t: TxFull) {
  const amountAbs = D(t.amount).abs();
  const allocations = !hasAllocations(t.type) ? [] : t.allocationMode === "SPLIT" ? t.allocations.map((a) => ({ memberId: a.memberId, member: a.memberId ? memberRef(ctx, a.memberId) : null, amount: money(a.amount), percent: a.percent ? a.percent.toString() : null })) : t.allocationMode === "HOUSEHOLD" ? [{ memberId: null, member: null, amount: money(amountAbs), percent: "100" }] : [{ memberId: t.allocationMode === "MEMBER" ? t.allocatedMemberId : t.ownerMemberId, member: memberRef(ctx, t.allocationMode === "MEMBER" ? t.allocatedMemberId : t.ownerMemberId), amount: money(amountAbs), percent: "100" }];
  return {
    id: t.id, vehicleId: t.vehicleId, tags: t.tags, date: dateIso(t.date), postingDate: dateIso(t.postingDate), description: t.description, amount: money(t.amount), type: t.type, status: t.status, currency: t.currency,
    accountId: t.accountId, accountName: ctx.accountIds.has(t.accountId) ? t.account.name : "Private account", categoryId: t.categoryId, categoryName: t.category ? (t.category.parent ? `${t.category.parent.name} / ${t.category.name}` : t.category.name) : null,
    merchant: t.merchant?.name ?? null, notes: t.notes, owner: memberRef(ctx, t.ownerMemberId), payer: t.payerMemberId ? memberRef(ctx, t.payerMemberId) : null, paidByHousehold: !t.payerMemberId && hasAllocations(t.type),
    enteredBy: byUser(ctx, t.createdById), lastModifiedBy: byUser(ctx, t.updatedById), createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), edited: t.updatedAt.getTime() - t.createdAt.getTime() > 1500,
    allocationMode: t.allocationMode, allocations, visibility: t.visibility, sharedWithMemberIds: t.ownerMemberId === ctx.me.id ? t.sharedWithMemberIds : undefined, mine: t.ownerMemberId === ctx.me.id, canEdit: canEdit(ctx, t),
    transferGroupId: t.transferGroupId, recurring: !!(t.recurringRuleId || t.billId || t.subscriptionId), linked: !!(t.debtPaymentId || t.billId || t.incomeSourceId), reconciliation: t.reconciliation, importBatchId: t.importBatchId,
  };
}

export const txQuerySchema = z.object({
  vehicleId: id.optional(), tag: z.string().max(40).optional(), view: z.enum(["my", "household", "all"]).default("all"), member: id.optional(), from: isoDate.optional(), to: isoDate.optional(), types: csvList, categoryIds: csvList, accountId: id.optional(), merchant: z.string().max(100).optional(), q: z.string().max(100).optional(),
  minAmount: z.coerce.number().optional(), maxAmount: z.coerce.number().optional(), recurring: z.enum(["1", "0"]).optional(), status: z.enum(["POSTED", "PLANNED"]).optional(), reconciliation: z.enum(["UNRECONCILED", "CLEARED", "RECONCILED"]).optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"), ...pageQ,
});

export async function txWhere(ctx: FinCtx, q: Partial<z.infer<typeof txQuerySchema>>): Promise<Prisma.FinTransactionWhereInput> {
  const and: Prisma.FinTransactionWhereInput[] = [];
  if (q.categoryIds?.length) {
    const kids = await db.finCategory.findMany({ where: { householdId: ctx.householdId, OR: [{ id: { in: q.categoryIds } }, { parentId: { in: q.categoryIds } }] }, select: { id: true } });
    and.push({ categoryId: { in: kids.map((k) => k.id) } });
  }
  if (q.q) and.push({ OR: [{ description: { contains: q.q, mode: "insensitive" } }, { notes: { contains: q.q, mode: "insensitive" } }, { merchant: { name: { contains: q.q, mode: "insensitive" } } }] });
  if (q.vehicleId) and.push({ vehicleId: q.vehicleId });
  if (q.tag) and.push({ tags: { has: normaliseTags([q.tag])[0] ?? q.tag } });
  if (q.merchant) and.push({ merchant: { name: { contains: q.merchant, mode: "insensitive" } } });
  if (q.minAmount !== undefined || q.maxAmount !== undefined) {
    // amounts are signed; compare magnitudes
    const lo = q.minAmount ?? 0, hi = q.maxAmount;
    and.push({ OR: [{ amount: { gte: lo, ...(hi !== undefined ? { lte: hi } : {}) } }, { amount: { lte: -lo, ...(hi !== undefined ? { gte: -hi } : {}) } }] });
  }
  if (q.recurring === "1") and.push({ OR: [{ recurringRuleId: { not: null } }, { billId: { not: null } }, { subscriptionId: { not: null } }] });
  if (q.recurring === "0") and.push({ recurringRuleId: null, billId: null, subscriptionId: null });
  const scope = q.member && q.member !== ctx.me.id ? ({ member: q.member } as const) : q.member === ctx.me.id ? ("my" as const) : (q.view ?? "all");
  return { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, scope), ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}), ...(q.types?.length ? { type: { in: q.types as never[] } } : {}), ...(q.accountId ? { accountId: q.accountId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.reconciliation ? { reconciliation: q.reconciliation } : {}), ...(and.length ? { AND: and } : {}) };
}

export async function listTransactions(ctx: FinCtx, q: z.infer<typeof txQuerySchema>) {
  const where = await txWhere(ctx, q);
  const orderBy: Prisma.FinTransactionOrderByWithRelationInput[] = q.sort === "date_asc" ? [{ date: "asc" }, { createdAt: "asc" }] : q.sort === "amount_desc" ? [{ amount: "desc" }] : q.sort === "amount_asc" ? [{ amount: "asc" }] : [{ date: "desc" }, { createdAt: "desc" }];
  const [rows, total, groups] = await Promise.all([
    db.finTransaction.findMany({ where, include: TX_INCLUDE, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.finTransaction.count({ where }),
    db.finTransaction.groupBy({ by: ["type"], where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
  ]);
  const g = (t: string) => D(groups.find((x) => x.type === t)?._sum.amount);
  const income = g("INCOME"), spend = g("EXPENSE").negated().minus(g("REFUND")).minus(g("REIMBURSEMENT"));
  return { items: rows.map((r) => txView(ctx, r)), total, page: q.page, pageSize: q.pageSize, summary: { income: money(income), expenses: money(spend), net: money(income.minus(spend)), note: "Transfers, adjustments and settlements are not income or expenses." } };
}

/** Every transaction matching a query (pages through the results). Used by exports so they are never truncated. */
export async function allTransactions(ctx: FinCtx, q: Partial<z.infer<typeof txQuerySchema>>, cap = 50_000) {
  const items: ReturnType<typeof txView>[] = [];
  let page = 1, total = 0;
  for (;;) {
    const r = await listTransactions(ctx, txQuerySchema.parse({ ...q, page, pageSize: 200 }));
    total = r.total;
    items.push(...r.items);
    if (items.length >= total || items.length >= cap || !r.items.length) return { items, total, summary: r.summary, truncated: items.length < total };
    page++;
  }
}

export async function getTransaction(ctx: FinCtx, txId: string) {
  const t = requireVisible(ctx, await db.finTransaction.findUnique({ where: { id: txId }, include: TX_INCLUDE }), "Transaction");
  const [docs, history, peer] = await Promise.all([
    db.document.findMany({ where: { householdId: ctx.householdId, finEntity: "transaction", finEntityId: t.id, deletedAt: null }, select: { id: true, title: true, mimeType: true, sizeBytes: true, createdAt: true } }),
    db.auditLog.findMany({ where: { householdId: ctx.householdId, entity: "FinTransaction", entityId: t.id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { id: true } } } }),
    t.transferGroupId ? db.finTransaction.findFirst({ where: { transferGroupId: t.transferGroupId, id: { not: t.id }, deletedAt: null }, include: TX_INCLUDE }) : null,
  ]);
  return { ...txView(ctx, t), documents: docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })), transferPeer: peer && ctx.accountIds.has(peer.accountId) ? { accountId: peer.accountId, accountName: peer.account.name, amount: money(peer.amount) } : null, history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt.toISOString(), by: byUser(ctx, h.userId), before: h.before, after: h.after })) };
}

async function duplicateOf(ctx: FinCtx, accountId: string, date: string, amount: string, description: string) {
  const rows = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, accountId, date: toDate(date), amount, deletedAt: null }, select: { description: true, id: true } });
  const key = fingerprint(accountId, date, amount, description);
  return rows.find((r) => fingerprint(accountId, date, amount, r.description) === key) ?? null;
}

export async function createTransaction(ctx: FinCtx, input: z.infer<typeof txCreateSchema>) {
  requireWriter(ctx);
  const acct = await requireAccount(ctx, input.accountId, { write: true });
  if (acct.status !== "ACTIVE") throw conflict("This account is closed");
  if (input.date < dateIso(acct.openingDate)!) throw new AppError("VALIDATION_ERROR", "The date is before the account's opening date", { fieldErrors: { date: ["Before the account opened"] } });
  if (input.type !== "ADJUSTMENT" && D(input.amount).lte(0)) throw new AppError("VALIDATION_ERROR", "Enter an amount greater than zero", { fieldErrors: { amount: ["Must be greater than zero"] } });
  if (input.type === "ADJUSTMENT" && D(input.amount).isZero()) throw new AppError("VALIDATION_ERROR", "An adjustment cannot be zero");
  if (input.idempotencyKey) {
    const prev = await db.finTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prev) {
      if (prev.householdId !== ctx.householdId) throw conflict("Idempotency key already used");
      return { id: prev.id, idempotentReplay: true };
    }
  }
  input = await withRules(ctx, input);
  await checkCategory(ctx, input.categoryId, input.type);
  await assertVehicleLink(ctx, input.vehicleId);
  const owner = ownerFor(ctx, input.assignToMemberId);
  const signed = money(sign(input.type, input.amount));
  if (!input.force) {
    const dup = await duplicateOf(ctx, acct.id, input.date, signed, input.description);
    if (dup) throw new AppError("DUPLICATE_RECORD", "A matching transaction already exists for that account, date and amount. Save anyway if this is a genuine repeat.", { duplicateOf: dup.id });
  }
  const joint = !acct.ownerMemberId;
  const vis = clampToAccount(acct, resolveVisibility(ctx, input, "transactions"));
  const payerId = hasAllocations(input.type) || input.type === "INCOME" ? resolvePayer(ctx, input.payer, owner, joint) : owner;
  const alloc = buildAllocation(ctx, input.type, D(input.amount).abs().toFixed(2), owner, input.allocation, joint);
  const merchantId = await upsertMerchant(ctx.householdId, input.merchant, input.categoryId);
  const t = await db.$transaction(async (tx) => {
    const row = await tx.finTransaction.create({
      data: { householdId: ctx.householdId, accountId: acct.id, type: input.type, status: input.status, amount: signed, currency: acct.currency, date: toDate(input.date), postingDate: input.postingDate ? toDate(input.postingDate) : null, description: input.description, notes: input.notes ?? null, categoryId: input.categoryId ?? null, merchantId, ownerMemberId: owner, payerMemberId: payerId, allocationMode: alloc.mode, allocatedMemberId: alloc.allocatedMemberId, ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id, incomeSourceId: input.incomeSourceId ?? null, vehicleId: input.vehicleId ?? null, tags: normaliseTags(input.tags), recurringRuleId: input.recurringRuleId ?? null, idempotencyKey: input.idempotencyKey ?? null },
    });
    if (alloc.rows.length) await tx.transactionAllocation.createMany({ data: alloc.rows.map((r) => ({ transactionId: row.id, memberId: r.memberId, amount: r.amount, percent: r.percent })) });
    await audit(tx, ctx.actor, { entity: "FinTransaction", entityId: row.id, action: "create", householdId: ctx.householdId, after: { type: input.type, amount: signed, date: input.date, owner, payer: payerId, allocation: alloc.mode, visibility: vis.visibility, enteredBy: ctx.me.id } });
    return row;
  });
  return { id: t.id, idempotentReplay: false };
}

/** A transfer is two linked ledger rows. It is never income or expense, so it cannot inflate either. */
export async function createTransfer(ctx: FinCtx, input: z.infer<typeof transferSchema>) {
  requireWriter(ctx);
  if (input.fromAccountId === input.toAccountId) throw new AppError("VALIDATION_ERROR", "Choose two different accounts");
  const [from, to] = await Promise.all([requireAccount(ctx, input.fromAccountId, { write: true }), requireAccount(ctx, input.toAccountId, { write: true })]);
  if (from.status !== "ACTIVE" || to.status !== "ACTIVE") throw conflict("A closed account cannot take part in a transfer");
  if (input.date < dateIso(from.openingDate)! || input.date < dateIso(to.openingDate)!) throw new AppError("VALIDATION_ERROR", "The date is before an account's opening date");
  let toAmount = D(input.amount);
  if (from.currency !== to.currency) {
    if (!input.toAmount) throw new AppError("VALIDATION_ERROR", `These accounts use different currencies (${from.currency} and ${to.currency}). Enter the amount received in ${to.currency}.`, { fieldErrors: { toAmount: ["Required for a cross currency transfer"] } });
    toAmount = D(input.toAmount);
  }
  if (input.idempotencyKey) {
    const prev = await db.finTransaction.findUnique({ where: { idempotencyKey: `${input.idempotencyKey}:out` } });
    if (prev) return { transferGroupId: prev.transferGroupId, idempotentReplay: true };
  }
  const group = randomUUID();
  const base = { householdId: ctx.householdId, type: "TRANSFER" as const, date: toDate(input.date), description: input.description, notes: input.notes ?? null, transferGroupId: group, ownerMemberId: ctx.me.id, payerMemberId: ctx.me.id, createdById: ctx.actor.id, updatedById: ctx.actor.id };
  const mine = resolveVisibility(ctx, {}, "transactions");
  await db.$transaction(async (tx) => {
    const a = await tx.finTransaction.create({ data: { ...base, accountId: from.id, amount: money(D(input.amount).negated()), currency: from.currency, ...clampToAccount(from, mine), idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:out` : null } });
    await tx.finTransaction.create({ data: { ...base, accountId: to.id, amount: money(toAmount), currency: to.currency, ...clampToAccount(to, mine), idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:in` : null } });
    await audit(tx, ctx.actor, { entity: "FinTransaction", entityId: a.id, action: "transfer", householdId: ctx.householdId, after: { from: from.id, to: to.id, amount: money(input.amount), group } });
  });
  return { transferGroupId: group, idempotentReplay: false };
}

async function linkedReason(tx: { id: string; debtPaymentId: string | null; transferGroupId: string | null }): Promise<string | null> {
  if (tx.debtPaymentId) return "This transaction belongs to a debt payment. Remove the payment from the debt instead.";
  if (tx.transferGroupId) {
    const gc = await db.goalContribution.findFirst({ where: { transferGroupId: tx.transferGroupId, deletedAt: null } });
    if (gc) return "This transfer is a savings goal contribution. Remove it from the goal instead.";
    const ie = await db.investmentEntry.findFirst({ where: { transferGroupId: tx.transferGroupId, deletedAt: null } });
    if (ie) return "This transfer is an investment entry. Remove it from the investment instead.";
  }
  return null;
}

export async function updateTransaction(ctx: FinCtx, txId: string, patch: z.infer<typeof txPatchSchema>) {
  requireWriter(ctx);
  const t = requireVisible(ctx, await db.finTransaction.findUnique({ where: { id: txId }, include: TX_INCLUDE }), "Transaction", { write: true });
  const isOwner = t.ownerMemberId === ctx.me.id;
  if ((patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined || patch.assignToMemberId !== undefined) && !isOwner) throw forbidden("Only the record's owner can change who can see it or who it belongs to");
  const linked = await linkedReason(t);
  const isTransfer = t.type === "TRANSFER";
  const before = txView(ctx, t);

  if (isTransfer || t.type === "SETTLEMENT") {
    if (patch.amount || patch.type || patch.accountId || patch.allocation || patch.categoryId) throw conflict("To change a transfer's amount or accounts, delete it and create a new one.");
    const legs = await db.finTransaction.findMany({ where: { transferGroupId: t.transferGroupId ?? "none", deletedAt: null } });
    await db.finTransaction.updateMany({ where: { id: { in: [t.id, ...(legs.filter((l) => canSee(ctx, l)).map((l) => l.id))] } }, data: { ...(patch.date ? { date: toDate(patch.date) } : {}), ...(patch.description ? { description: patch.description } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), updatedById: ctx.actor.id } });
    await audit(null, ctx.actor, { entity: "FinTransaction", entityId: t.id, action: "update", householdId: ctx.householdId, before: { date: before.date, description: before.description }, after: patch });
    return { id: t.id };
  }
  if (linked && (patch.amount || patch.type || patch.accountId || patch.date || patch.allocation)) throw conflict(linked);

  const type = patch.type ?? t.type;
  if (patch.type && hasAllocations(patch.type) !== hasAllocations(t.type)) throw new AppError("VALIDATION_ERROR", "Income cannot be converted to an expense. Delete it and create the correct type.");
  const acct = patch.accountId && patch.accountId !== t.accountId ? await requireAccount(ctx, patch.accountId, { write: true }) : null;
  if (acct && acct.currency !== t.currency) throw conflict("A transaction cannot move to an account with a different currency");
  const accountRow = acct ?? (await db.finAccount.findUniqueOrThrow({ where: { id: t.accountId } }));
  const mag = patch.amount ? D(patch.amount).abs() : D(t.amount).abs();
  if (mag.lte(0)) throw new AppError("VALIDATION_ERROR", "Enter an amount greater than zero");
  const signed = money(sign(type, mag.toFixed(2)));
  await checkCategory(ctx, patch.categoryId === undefined ? t.categoryId : patch.categoryId, type);
  if (patch.vehicleId) await assertVehicleLink(ctx, patch.vehicleId);
  const owner = patch.assignToMemberId ? ownerFor(ctx, patch.assignToMemberId) : t.ownerMemberId;
  const joint = !accountRow.ownerMemberId;
  const payerId = patch.payer !== undefined ? resolvePayer(ctx, patch.payer, owner ?? ctx.me.id, joint) : t.payerMemberId;
  // Re-allocate when the amount, owner or allocation changes. An unchanged split keeps its proportions.
  let alloc: ReturnType<typeof buildAllocation> | null = null;
  const changedAlloc = patch.allocation !== undefined || patch.amount !== undefined || patch.assignToMemberId !== undefined || patch.type !== undefined;
  if (changedAlloc && hasAllocations(type)) {
    if (patch.allocation) alloc = buildAllocation(ctx, type, mag.toFixed(2), owner ?? ctx.me.id, patch.allocation, joint);
    else if (t.allocationMode === "SPLIT") {
      const parts = apportion(mag, t.allocations.map((a) => a.amount));
      alloc = { mode: "SPLIT", allocatedMemberId: null, rows: t.allocations.map((a, i) => ({ memberId: a.memberId, amount: money(parts[i]), percent: a.percent ? a.percent.toString() : null })) };
    } else alloc = buildAllocation(ctx, type, mag.toFixed(2), owner ?? ctx.me.id, { mode: t.allocationMode as AllocationMode, memberId: t.allocatedMemberId }, joint);
  }
  let vis: { visibility: "PERSONAL" | "HOUSEHOLD" | "SELECTED"; sharedWithMemberIds: string[] } | null = null;
  if (patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined) vis = clampToAccount(accountRow, resolveVisibility(ctx, patch, "transactions", { current: t }));
  const merchantId = patch.merchant !== undefined ? await upsertMerchant(ctx.householdId, patch.merchant, patch.categoryId ?? t.categoryId) : undefined;
  await db.$transaction(async (tx) => {
    await tx.finTransaction.update({
      where: { id: t.id },
      data: { type, amount: signed, ...(patch.vehicleId !== undefined ? { vehicleId: patch.vehicleId } : {}), ...(patch.tags !== undefined ? { tags: normaliseTags(patch.tags) } : {}), ...(patch.date ? { date: toDate(patch.date) } : {}), ...(patch.postingDate !== undefined ? { postingDate: patch.postingDate ? toDate(patch.postingDate) : null } : {}), ...(patch.description ? { description: patch.description } : {}), ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}), ...(merchantId !== undefined ? { merchantId } : {}), ...(acct ? { accountId: acct.id } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.reconciliation ? { reconciliation: patch.reconciliation } : {}), ownerMemberId: owner, payerMemberId: payerId, ...(alloc ? { allocationMode: alloc.mode, allocatedMemberId: alloc.allocatedMemberId } : {}), ...(vis ?? {}), updatedById: ctx.actor.id },
    });
    if (alloc) {
      await tx.transactionAllocation.deleteMany({ where: { transactionId: t.id } });
      if (alloc.rows.length) await tx.transactionAllocation.createMany({ data: alloc.rows.map((r) => ({ transactionId: t.id, memberId: r.memberId, amount: r.amount, percent: r.percent })) });
    }
    await audit(tx, ctx.actor, { entity: "FinTransaction", entityId: t.id, action: "update", householdId: ctx.householdId, before: { amount: before.amount, date: before.date, description: before.description, categoryId: before.categoryId, payer: before.payer?.id ?? null, allocation: before.allocationMode, visibility: before.visibility }, after: { ...patch, modifiedBy: ctx.me.id } });
  });
  return { id: t.id };
}

/** Soft delete. A transfer removes both legs together so balances can never be left half-moved. */
export async function deleteTransaction(ctx: FinCtx, txId: string) {
  requireWriter(ctx);
  const t = requireVisible(ctx, await db.finTransaction.findUnique({ where: { id: txId } }), "Transaction", { write: true });
  const reason = await linkedReason(t);
  if (reason) throw conflict(reason);
  const ids = [t.id];
  if (t.transferGroupId) {
    const others = await db.finTransaction.findMany({ where: { transferGroupId: t.transferGroupId, deletedAt: null, id: { not: t.id } } });
    for (const o of others) ids.push(o.id);
  }
  await db.$transaction(async (tx) => {
    await tx.finTransaction.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await tx.billPayment.deleteMany({ where: { transactionId: { in: ids } } });
    await audit(tx, ctx.actor, { entity: "FinTransaction", entityId: t.id, action: "delete", householdId: ctx.householdId, before: { amount: money(t.amount), type: t.type, date: dateIso(t.date), legs: ids.length } });
  });
  return { deleted: ids.length, accountsAffected: [t.accountId] };
}

export async function duplicateTransaction(ctx: FinCtx, txId: string, date?: string) {
  requireWriter(ctx);
  const t = requireVisible(ctx, await db.finTransaction.findUnique({ where: { id: txId }, include: { allocations: true } }), "Transaction");
  if (t.type === "TRANSFER" || t.type === "SETTLEMENT") throw conflict("Create a new transfer instead of duplicating one");
  const acct = await requireAccount(ctx, t.accountId, { write: true });
  const owner = ctx.me.id;
  const row = await db.$transaction(async (tx) => {
    const n = await tx.finTransaction.create({ data: { householdId: ctx.householdId, accountId: t.accountId, type: t.type, status: "POSTED", amount: t.amount, currency: t.currency, date: toDate(date ?? ctx.today), description: t.description, notes: t.notes, categoryId: t.categoryId, merchantId: t.merchantId, ownerMemberId: owner, payerMemberId: t.payerMemberId === t.ownerMemberId ? owner : t.payerMemberId, allocationMode: t.allocationMode, allocatedMemberId: t.allocatedMemberId, ...clampToAccount(acct, resolveVisibility(ctx, {}, "transactions")), createdById: ctx.actor.id, updatedById: ctx.actor.id } });
    if (t.allocations.length) await tx.transactionAllocation.createMany({ data: t.allocations.map((a) => ({ transactionId: n.id, memberId: a.memberId, amount: a.amount, percent: a.percent })) });
    await audit(tx, ctx.actor, { entity: "FinTransaction", entityId: n.id, action: "duplicate", householdId: ctx.householdId, after: { from: t.id } });
    return n;
  });
  return { id: row.id };
}

export const bulkSchema = z.object({ ids: z.array(id).min(1).max(500), categoryId: id.nullish(), reconciliation: z.enum(["UNRECONCILED", "CLEARED", "RECONCILED"]).optional() });
export async function bulkUpdate(ctx: FinCtx, input: z.infer<typeof bulkSchema>) {
  requireWriter(ctx);
  const rows = await db.finTransaction.findMany({ where: { id: { in: input.ids }, householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, "all") } });
  let changed = 0;
  for (const r of rows) {
    if (!canEdit(ctx, r)) continue;
    if (input.categoryId !== undefined && (r.type === "TRANSFER" || r.type === "ADJUSTMENT" || r.type === "SETTLEMENT")) continue;
    if (input.categoryId) await checkCategory(ctx, input.categoryId, r.type);
    await db.finTransaction.update({ where: { id: r.id }, data: { ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.reconciliation ? { reconciliation: input.reconciliation } : {}), updatedById: ctx.actor.id } });
    changed++;
  }
  await audit(null, ctx.actor, { entity: "FinTransaction", action: "bulk-update", householdId: ctx.householdId, after: { count: changed, categoryId: input.categoryId, reconciliation: input.reconciliation } });
  return { updated: changed, skipped: input.ids.length - changed };
}
export type { View };
export { ZERO, currencyCode };
