// Data loaders: turn scoped database rows into engine inputs. Everything is filtered through the actor's visibility.
import { db } from "@/lib/db";
import { D, type Dec } from "./engine/decimal";
import { makeFx, type Fx } from "./engine/fx";
import type { ConvertedTx, LedgerAccount, LedgerTx, TxType } from "./engine/ledger";
import { toBase } from "./engine/ledger";
import type { NwAccount, NwAsset } from "./engine/networth";
import { dateIso } from "./common";
import { visWhere, type FinCtx, type View } from "./access";

export const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadFx(ctx: FinCtx): Promise<Fx> {
  const rows = await db.fxRate.findMany({ where: { householdId: ctx.householdId } });
  return makeFx(rows.map((r) => ({ base: r.base, quote: r.quote, rate: r.rate.toString(), asOf: iso(r.asOf), source: r.source })));
}

export async function loadCategories(ctx: FinCtx) {
  return db.finCategory.findMany({ where: { householdId: ctx.householdId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}
export const categoryParents = (cats: { id: string; parentId: string | null }[]) => new Map(cats.map((c) => [c.id, c.parentId]));

const TX_SELECT = { id: true, accountId: true, type: true, status: true, amount: true, currency: true, date: true, categoryId: true, ownerMemberId: true, payerMemberId: true, allocationMode: true, allocatedMemberId: true, transferGroupId: true, description: true, merchantId: true, billId: true, subscriptionId: true, insurancePolicyId: true, debtPaymentId: true, recurringRuleId: true, incomeSourceId: true, visibility: true, sharedWithMemberIds: true, allocations: { select: { memberId: true, amount: true } } } as const;
type TxRow = Awaited<ReturnType<typeof db.finTransaction.findFirstOrThrow<{ select: typeof TX_SELECT }>>>;
export type LoadedTx = LedgerTx & { billId: string | null; description?: string; merchantId?: string | null; scheduled: boolean; payerId: string | null; ownerId: string | null; allocationMode: string; allocatedMemberId: string | null; allocations: { memberId: string | null; amount: string }[]; visibility: string; sharedWith: string[] };
export const toLedgerTx = (t: TxRow): LoadedTx => ({
  id: t.id, accountId: t.accountId, type: t.type as TxType, status: t.status, amount: t.amount.toString(), currency: t.currency, date: iso(t.date), categoryId: t.categoryId, memberId: t.ownerMemberId, transferGroupId: t.transferGroupId, description: t.description, merchantId: t.merchantId,
  scheduled: !!(t.billId || t.subscriptionId || t.insurancePolicyId || t.debtPaymentId || t.recurringRuleId),
  billId: t.billId, payerId: t.payerMemberId, ownerId: t.ownerMemberId, allocationMode: t.allocationMode, allocatedMemberId: t.allocatedMemberId, allocations: t.allocations.map((a) => ({ memberId: a.memberId, amount: a.amount.toString() })), visibility: t.visibility, sharedWith: t.sharedWithMemberIds,
});

export interface Books {
  accounts: Awaited<ReturnType<typeof loadAccountRows>>;
  ledgerAccounts: LedgerAccount[];
  /** Every posted row on the accounts in the view (balances need all rows of an account, not just visible ones). */
  balanceTxs: LedgerTx[];
  fx: Fx;
}
/** Accounts in a view: "my" = accounts I own, "household" = accounts shared with the household (or with me). */
export async function loadAccountRows(ctx: FinCtx, view: View | "all" = "all") {
  return db.finAccount.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, orderBy: [{ createdAt: "asc" }] });
}
export const toLedgerAccount = (a: { id: string; type: string; currency: string; openingBalance: { toString(): string }; openingDate: Date }): LedgerAccount => ({ id: a.id, type: a.type, currency: a.currency, openingBalance: a.openingBalance.toString(), openingDate: iso(a.openingDate) });

export async function loadBooks(ctx: FinCtx, opts: { upTo?: string; view?: View | "all" } = {}): Promise<Books> {
  const accounts = await loadAccountRows(ctx, opts.view ?? "all");
  const rows = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, accountId: { in: accounts.map((a) => a.id) }, status: "POSTED", ...(opts.upTo ? { date: { lte: new Date(`${opts.upTo}T00:00:00Z`) } } : {}) }, select: TX_SELECT });
  return { accounts, ledgerAccounts: accounts.map(toLedgerAccount), balanceTxs: rows.map(toLedgerTx), fx: await loadFx(ctx) };
}

/** Income/expense reporting rows in a view (transaction level visibility applies), converted to the base currency. */
export async function loadReportTxs(ctx: FinCtx, from: string, to: string, view: View | "all" | { member: string } = "household", extraWhere: Record<string, unknown> = {}) {
  const rows = await db.finTransaction.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view), status: "POSTED", date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, ...extraWhere }, select: TX_SELECT, orderBy: { date: "asc" } });
  const fx = await loadFx(ctx);
  const loaded = rows.map(toLedgerTx);
  const conv = toBase(loaded, ctx.base, fx);
  const byId = new Map(loaded.map((l) => [l.id, l]));
  return { txs: conv.txs.map((t) => ({ ...t, ...(byId.get(t.id) as LoadedTx) })) as (ConvertedTx & LoadedTx)[], excluded: conv.excluded, missingRates: conv.missingRates };
}

export async function nwInputs(ctx: FinCtx, view: View | "all" = "all"): Promise<{ accounts: NwAccount[]; assets: NwAsset[] }> {
  const accts = await db.finAccount.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, include: { investment: { include: { valuations: true } } } });
  const assetRows = await db.asset.findMany({ where: { householdId: ctx.householdId, deletedAt: null, ...visWhere(ctx, view) }, include: { valuations: true } });
  return {
    accounts: accts.map((a) => ({ ...toLedgerAccount(a), name: a.name, valuations: a.investment?.valuations.map((v) => ({ date: iso(v.date), value: v.marketValue.toString() })) })),
    assets: assetRows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, currentValue: a.currentValue.toString(), valuationDate: iso(a.valuationDate), valuations: a.valuations.map((v) => ({ date: iso(v.date), value: v.value.toString() })), acquiredOn: (a.details as { purchaseDate?: string } | null)?.purchaseDate ?? null, soldOn: dateIso(a.soldOn) })),
  };
}

export const sumDec = (xs: Dec[]) => xs.reduce((a, b) => a.plus(b), D(0));
