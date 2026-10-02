// Financial accounts. Balance = opening balance + posted ledger rows. Liability accounts carry negative balances (amount owed).
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, conflict, notFound } from "@/lib/errors";
import { D, money, ZERO, type Dec } from "./engine/decimal";
import { isLiabilityType, isLiquidType, accountBalance } from "./engine/ledger";
import { computeNetWorth } from "./engine/networth";
import { audit } from "../services/audit";
import { currencyCode, dateIso, id, isoDate, moneyIn, optText, text, toDate, nonNegMoney } from "./common";
import { canEdit, memberRef, ownerFor, requireAccount, resolveVisibility, visibilityFields, visWhere, type FinCtx, type View } from "./access";
import { ACCOUNT_DEBT_TYPE } from "./defaults";
import { loadBooks, nwInputs, iso } from "./load";

export const ACCOUNT_TYPES = ["CHEQUING", "SAVINGS", "HIGH_INTEREST_SAVINGS", "CREDIT_CARD", "LINE_OF_CREDIT", "INVESTMENT", "MORTGAGE", "LOAN", "CASH", "OTHER_ASSET", "OTHER_LIABILITY"] as const;

export const accountSchema = z.object({
  name: text(80),
  institution: optText(80),
  type: z.enum(ACCOUNT_TYPES),
  /** Joint account owned by the whole household (always shared). */
  joint: z.boolean().optional(),
  /** Assign the account to another household member (default: the signed-in user). */
  ownerMemberId: id.nullish(),
  ...visibilityFields,
  currency: currencyCode.optional(),
  /** Signed ledger balance. For liability types enter the amount owed as a positive number with `openingIsOwed`. */
  openingBalance: moneyIn.default("0.00"),
  openingIsOwed: z.boolean().optional(),
  openingDate: isoDate.optional(),
  creditLimit: nonNegMoney.nullish(),
  accountMask: z.string().regex(/^\d{2,4}$/, "Enter only the last 2 to 4 digits").nullish(),
  notes: optText(1000),
  investmentKind: z.enum(["RRSP", "TFSA", "FHSA", "RESP", "NON_REGISTERED", "PENSION", "EMPLOYER_PLAN", "OTHER"]).optional(),
  debt: z.object({ lender: z.string().max(80).optional(), interestRate: z.union([z.string(), z.number()]).optional(), minimumPayment: moneyIn.optional(), regularPayment: moneyIn.optional(), frequency: z.string().optional(), nextDueDate: isoDate.nullish() }).partial().optional(),
});
export const accountPatchSchema = z.object({ name: text(80).optional(), institution: optText(80), ...visibilityFields, creditLimit: nonNegMoney.nullish(), accountMask: z.string().regex(/^\d{2,4}$/).nullish(), notes: optText(1000), status: z.enum(["ACTIVE", "CLOSED"]).optional(), openingBalance: moneyIn.optional(), openingDate: isoDate.optional() });

/** Sum of posted, non-deleted rows by account (opening balances are added separately). */
export async function ledgerSums(householdId: string, ids: string[], asOf?: string): Promise<Map<string, Dec>> {
  if (!ids.length) return new Map();
  const g = await db.finTransaction.groupBy({ by: ["accountId"], where: { householdId, accountId: { in: ids }, status: "POSTED", deletedAt: null, ...(asOf ? { date: { lte: toDate(asOf) } } : {}) }, _sum: { amount: true } });
  return new Map(g.map((r) => [r.accountId, D(r._sum.amount)]));
}
export async function currentBalance(householdId: string, account: { id: string; openingBalance: { toString(): string } }, asOf?: string) {
  const s = await ledgerSums(householdId, [account.id], asOf);
  return D(account.openingBalance).plus(s.get(account.id) ?? ZERO);
}

export async function listAccounts(ctx: FinCtx, view: View | "all" = "all") {
  const accts = await db.finAccount.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, include: { debt: { select: { id: true } }, investment: { include: { valuations: { orderBy: { date: "desc" }, take: 1 } } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] });
  const sums = await ledgerSums(ctx.householdId, accts.map((a) => a.id));
  const pending = await db.finTransaction.groupBy({ by: ["accountId"], where: { householdId: ctx.householdId, accountId: { in: accts.map((a) => a.id) }, status: "PLANNED", deletedAt: null }, _sum: { amount: true } });
  const pendingMap = new Map(pending.map((p) => [p.accountId, D(p._sum.amount)]));
  const books = await loadBooks(ctx, { view });
  const nw = computeNetWorth({ ...(await nwInputs(ctx, view)), txs: books.balanceTxs, baseCurrency: ctx.base, fx: books.fx, asOf: ctx.today });
  const items = accts.map((a) => {
    const ledger = D(a.openingBalance).plus(sums.get(a.id) ?? ZERO);
    const liability = isLiabilityType(a.type);
    const val = a.investment?.valuations[0];
    const balance = a.type === "INVESTMENT" && val ? D(val.marketValue) : ledger;
    const available = a.creditLimit && (a.type === "CREDIT_CARD" || a.type === "LINE_OF_CREDIT") ? D(a.creditLimit).plus(ledger) : liability ? null : ledger.plus(pendingMap.get(a.id) ?? ZERO);
    return {
      id: a.id, name: a.name, institution: a.institution, type: a.type, currency: a.currency, status: a.status, notes: a.notes, accountMask: a.accountMask ? `**** ${a.accountMask}` : null, accountMaskDigits: a.accountMask,
      openingBalance: money(a.openingBalance), openingDate: dateIso(a.openingDate), currentBalance: money(balance), ledgerBalance: money(ledger), valuedOn: val ? dateIso(val.date) : null, valuationBased: a.type === "INVESTMENT" && !!val,
      availableBalance: available ? money(available) : null, creditLimit: a.creditLimit ? money(a.creditLimit) : null, isLiability: liability, isLiquid: isLiquidType(a.type),
      owner: memberRef(ctx, a.ownerMemberId), ownerMemberId: a.ownerMemberId, joint: !a.ownerMemberId, mine: a.ownerMemberId === ctx.me.id, canEdit: canEdit(ctx, a),
      visibility: a.visibility, sharedWithMemberIds: a.ownerMemberId === ctx.me.id ? a.sharedWithMemberIds : undefined, createdBy: memberRef(ctx, ctx.members.find((m) => m.userId === a.createdById)?.id), debtId: a.debt?.id ?? null, investmentId: a.investment?.id ?? null,
      reconciledThrough: dateIso(a.reconciledThrough), statementBalance: a.statementBalance ? money(a.statementBalance) : null,
    };
  });
  return { view, items, totals: { assets: money(nw.assets), liabilities: money(nw.liabilities), netWorth: money(nw.netWorth), currency: ctx.base, unconverted: nw.unconverted }, hiddenAccountCount: ctx.hiddenAccountCount };
}

export async function getAccount(ctx: FinCtx, accountId: string) {
  await requireAccount(ctx, accountId);
  const all = await listAccounts(ctx, "all");
  const a = all.items.find((x) => x.id === accountId);
  if (!a) throw notFound("Account");
  return a;
}

export async function createAccount(ctx: FinCtx, input: z.infer<typeof accountSchema>) {
  const liability = isLiabilityType(input.type);
  const joint = !!input.joint;
  const owner = joint ? null : ownerFor(ctx, input.ownerMemberId);
  const kind = liability ? "debts" : input.type === "SAVINGS" || input.type === "HIGH_INTEREST_SAVINGS" ? "savings" : "accounts";
  const vis = resolveVisibility(ctx, input, kind, { joint });
  let opening = D(input.openingBalance);
  if (liability && (input.openingIsOwed ?? true)) opening = opening.abs().negated();
  if (!liability && input.openingIsOwed) opening = opening.abs();
  const a = await db.$transaction(async (tx) => {
    const acct = await tx.finAccount.create({ data: { householdId: ctx.householdId, name: input.name, institution: input.institution ?? null, type: input.type, ownerMemberId: owner, ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id, currency: input.currency ?? ctx.base, openingBalance: money(opening), openingDate: toDate(input.openingDate ?? ctx.today), creditLimit: input.creditLimit ?? null, accountMask: input.accountMask ?? null, notes: input.notes ?? null } });
    if (liability) {
      const d = input.debt ?? {};
      await tx.debt.create({ data: { householdId: ctx.householdId, accountId: acct.id, ownerMemberId: owner, ...vis, createdById: ctx.actor.id, updatedById: ctx.actor.id, lender: d.lender || input.institution || input.name, type: ACCOUNT_DEBT_TYPE[input.type] as never, originalAmount: money(opening.abs()), interestRate: String(d.interestRate ?? 0), compoundingPerYear: input.type === "MORTGAGE" ? 2 : 12, minimumPayment: d.minimumPayment ?? "0.00", regularPayment: d.regularPayment ?? d.minimumPayment ?? "0.00", frequency: (d.frequency as never) ?? "MONTHLY", nextDueDate: d.nextDueDate ? toDate(d.nextDueDate) : null, startDate: toDate(input.openingDate ?? ctx.today) } });
    }
    if (input.type === "INVESTMENT") await tx.investmentProfile.create({ data: { householdId: ctx.householdId, accountId: acct.id, kind: input.investmentKind ?? "NON_REGISTERED" } });
    await audit(tx, ctx.actor, { entity: "FinAccount", entityId: acct.id, action: "create", householdId: ctx.householdId, after: { name: acct.name, type: acct.type, currency: acct.currency, visibility: vis.visibility } });
    return acct;
  });
  return { id: a.id };
}

export async function updateAccount(ctx: FinCtx, accountId: string, patch: z.infer<typeof accountPatchSchema>) {
  const a = await requireAccount(ctx, accountId, { write: true });
  const isOwner = a.ownerMemberId === ctx.me.id;
  if ((patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined) && !isOwner) throw new AppError("FORBIDDEN", "Only the owner can change who an account is shared with");
  if (patch.status === "CLOSED") {
    const bal = await currentBalance(ctx.householdId, a);
    if (!bal.isZero() && a.type !== "INVESTMENT") throw conflict("An account can only be closed when its balance is zero. Transfer the balance out first.");
  }
  const data: Record<string, unknown> = { updatedById: ctx.actor.id };
  for (const k of ["name", "institution", "creditLimit", "accountMask", "notes", "status"] as const) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.visibility !== undefined || patch.sharedWithMemberIds !== undefined) {
    if (!a.ownerMemberId) throw new AppError("VALIDATION_ERROR", "A joint account is always shared with the household");
    const v = resolveVisibility(ctx, patch, "accounts", { current: a });
    Object.assign(data, v);
    // dependent debt and investment records follow the account's visibility so they cannot leak or contradict it
    await db.debt.updateMany({ where: { accountId: a.id }, data: v });
  }
  if (patch.openingBalance !== undefined) data.openingBalance = patch.openingBalance;
  if (patch.openingDate !== undefined) {
    const earliest = await db.finTransaction.findFirst({ where: { accountId: a.id, deletedAt: null }, orderBy: { date: "asc" }, select: { date: true } });
    if (earliest && toDate(patch.openingDate) > earliest.date) throw conflict("The opening date cannot be later than the account's earliest transaction");
    data.openingDate = toDate(patch.openingDate);
  }
  await db.finAccount.update({ where: { id: a.id }, data });
  await audit(null, ctx.actor, { entity: "FinAccount", entityId: a.id, action: patch.openingBalance !== undefined ? "update-opening-balance" : "update", householdId: ctx.householdId, before: { name: a.name, openingBalance: money(a.openingBalance), status: a.status, visibility: a.visibility }, after: patch });
  return { id: a.id };
}

export async function deleteAccount(ctx: FinCtx, accountId: string) {
  const a = await requireAccount(ctx, accountId, { write: true });
  if (a.ownerMemberId ? a.ownerMemberId !== ctx.me.id : !ctx.isAdmin && a.createdById !== ctx.actor.id) throw new AppError("FORBIDDEN", "Only the owner can delete an account");
  const n = await db.finTransaction.count({ where: { accountId: a.id, deletedAt: null } });
  if (n > 0) throw conflict(`This account has ${n} transaction${n === 1 ? "" : "s"}. Close it instead so history and reports stay intact.`);
  await db.$transaction(async (tx) => {
    await tx.finTransaction.deleteMany({ where: { accountId: a.id } });
    await tx.debt.deleteMany({ where: { accountId: a.id } });
    await tx.investmentProfile.deleteMany({ where: { accountId: a.id } });
    await tx.finAccount.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx.actor, { entity: "FinAccount", entityId: a.id, action: "delete", householdId: ctx.householdId, before: { name: a.name } });
  });
  return { ok: true };
}

export const balanceUpdateSchema = z.object({ balance: moneyIn, date: isoDate.optional(), note: optText(300) });
/**
 * Manual balance update. The ledger stays the source of truth, so a manual figure is recorded as a controlled ADJUSTMENT row
 * for exactly the difference (never by overwriting history). Adjustments are excluded from income and expense totals.
 */
export async function setBalance(ctx: FinCtx, accountId: string, input: z.infer<typeof balanceUpdateSchema>) {
  const a = await requireAccount(ctx, accountId, { write: true });
  const date = input.date ?? ctx.today;
  if (date < iso(a.openingDate)) throw new AppError("VALIDATION_ERROR", "The date is before the account's opening date");
  const target = a.type !== "INVESTMENT" && isLiabilityType(a.type) ? D(input.balance) : D(input.balance);
  const current = await currentBalance(ctx.householdId, a, date);
  const diff = target.minus(current);
  if (diff.isZero()) return { adjustment: null, balance: money(current) };
  const t = await db.finTransaction.create({ data: { householdId: ctx.householdId, accountId: a.id, type: "ADJUSTMENT", amount: money(diff), currency: a.currency, date: toDate(date), description: "Balance adjustment", notes: input.note ?? "Manual balance update", ownerMemberId: ctx.me.id, payerMemberId: ctx.me.id, visibility: a.visibility, sharedWithMemberIds: a.sharedWithMemberIds, createdById: ctx.actor.id, updatedById: ctx.actor.id } });
  await audit(null, ctx.actor, { entity: "FinTransaction", entityId: t.id, action: "balance-adjustment", householdId: ctx.householdId, before: { balance: money(current) }, after: { balance: money(target), adjustment: money(diff) } });
  return { adjustment: { id: t.id, amount: money(diff) }, balance: money(target) };
}

export const reconcileSchema = z.object({ statementDate: isoDate, statementBalance: moneyIn, createAdjustment: z.boolean().default(false) });
/** Compares the ledger with a statement. Matching rows are marked RECONCILED; a difference can be booked as a controlled adjustment. */
export async function reconcile(ctx: FinCtx, accountId: string, input: z.infer<typeof reconcileSchema>) {
  const a = await requireAccount(ctx, accountId, { write: true });
  const ledger = await currentBalance(ctx.householdId, a, input.statementDate);
  const diff = D(input.statementBalance).minus(ledger);
  let adjusted = false;
  if (!diff.isZero()) {
    if (!input.createAdjustment) return { reconciled: false, ledgerBalance: money(ledger), statementBalance: money(input.statementBalance), difference: money(diff) };
    await db.finTransaction.create({ data: { householdId: ctx.householdId, accountId: a.id, type: "ADJUSTMENT", amount: money(diff), currency: a.currency, date: toDate(input.statementDate), description: "Reconciliation adjustment", notes: `Statement balance ${money(input.statementBalance)}`, ownerMemberId: ctx.me.id, payerMemberId: ctx.me.id, visibility: a.visibility, sharedWithMemberIds: a.sharedWithMemberIds, createdById: ctx.actor.id, updatedById: ctx.actor.id } });
    adjusted = true;
  }
  const r = await db.$transaction(async (tx) => {
    const n = await tx.finTransaction.updateMany({ where: { accountId: a.id, deletedAt: null, status: "POSTED", date: { lte: toDate(input.statementDate) }, reconciliation: { not: "RECONCILED" } }, data: { reconciliation: "RECONCILED" } });
    await tx.finAccount.update({ where: { id: a.id }, data: { reconciledThrough: toDate(input.statementDate), statementBalance: money(input.statementBalance) } });
    await audit(tx, ctx.actor, { entity: "FinAccount", entityId: a.id, action: "reconcile", householdId: ctx.householdId, after: { through: input.statementDate, adjusted, marked: n.count } });
    return n.count;
  });
  return { reconciled: true, adjusted, markedReconciled: r, ledgerBalance: money(input.statementBalance), difference: "0.00" };
}

/** Whether the ledger rows of an account sum (with the opening balance) to its reported balance; used by integrity checks and tests. */
export async function verifyAccountBalance(ctx: FinCtx, accountId: string) {
  const a = await requireAccount(ctx, accountId);
  const rows = await db.finTransaction.findMany({ where: { accountId: a.id }, select: { id: true, accountId: true, type: true, status: true, amount: true, currency: true, date: true, deletedAt: true } });
  const engine = accountBalance({ id: a.id, type: a.type, currency: a.currency, openingBalance: a.openingBalance.toString(), openingDate: iso(a.openingDate) }, rows.map((r) => ({ id: r.id, accountId: r.accountId, type: r.type, status: r.status, amount: r.amount.toString(), currency: r.currency, date: iso(r.date), deleted: !!r.deletedAt })));
  const sql = await currentBalance(ctx.householdId, a);
  return { engine: money(engine), database: money(sql), matches: engine.eq(sql) };
}
