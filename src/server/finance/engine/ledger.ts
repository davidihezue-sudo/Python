// Ledger rules. Everything that turns raw transactions into balances and period totals lives here.
//
// Accounting rules implemented (see docs in README):
//  1. Amounts are signed from the account's point of view; balance = opening balance + sum of POSTED, non-deleted rows.
//  2. TRANSFER and ADJUSTMENT rows are never income or expense (internal transfers and credit card payments are neutral).
//  3. Spending is recorded once, when it happens (on the card), never again when the card is paid.
//  4. REFUND and REIMBURSEMENT rows reduce the expense category they point at, so net spend = purchases minus refunds.
//  5. PLANNED rows are expectations only: they never touch balances or actuals.
import { D, Dec, ZERO, sum, type Dec as DecT, type DecLike } from "./decimal";
import type { Fx } from "./fx";
import type { IsoDate } from "./dates";
import { monthKeys, monthOf } from "./dates";

export type TxType = "INCOME" | "EXPENSE" | "TRANSFER" | "REFUND" | "REIMBURSEMENT" | "ADJUSTMENT" | "SETTLEMENT";
export const ASSET_ACCOUNT_TYPES = ["CHEQUING", "SAVINGS", "HIGH_INTEREST_SAVINGS", "INVESTMENT", "CASH", "OTHER_ASSET"] as const;
export const LIABILITY_ACCOUNT_TYPES = ["CREDIT_CARD", "LINE_OF_CREDIT", "MORTGAGE", "LOAN", "OTHER_LIABILITY"] as const;
export const LIQUID_ACCOUNT_TYPES = ["CHEQUING", "SAVINGS", "HIGH_INTEREST_SAVINGS", "CASH"] as const;
export const SAVINGS_ACCOUNT_TYPES = ["SAVINGS", "HIGH_INTEREST_SAVINGS"] as const;

export const isLiabilityType = (t: string) => (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(t);
export const isLiquidType = (t: string) => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(t);

export interface LedgerAccount {
  id: string;
  type: string;
  currency: string;
  openingBalance: DecLike;
  openingDate: IsoDate;
}
export interface LedgerTx {
  id: string;
  accountId: string;
  type: TxType;
  status?: "POSTED" | "PLANNED";
  amount: DecLike; // signed, account perspective
  currency: string;
  date: IsoDate;
  categoryId?: string | null;
  memberId?: string | null;
  transferGroupId?: string | null;
  deleted?: boolean;
}

export const countsInBalance = (t: LedgerTx) => !t.deleted && (t.status ?? "POSTED") === "POSTED";

/** Ledger balance of one account as of a date (inclusive). With no date, everything posted is included. */
export function accountBalance(acct: LedgerAccount, txs: LedgerTx[], asOf?: IsoDate): DecT {
  if (asOf && asOf < acct.openingDate) return ZERO;
  let t = D(acct.openingBalance);
  for (const x of txs) {
    if (x.accountId !== acct.id || !countsInBalance(x)) continue;
    if (asOf && x.date > asOf) continue;
    t = t.plus(D(x.amount));
  }
  return t;
}

/** Balances for many accounts in a single pass. */
export function balances(accts: LedgerAccount[], txs: LedgerTx[], asOf?: IsoDate): Map<string, DecT> {
  const m = new Map<string, DecT>();
  for (const a of accts) m.set(a.id, !asOf || asOf >= a.openingDate ? D(a.openingBalance) : ZERO);
  for (const x of txs) {
    if (!countsInBalance(x)) continue;
    const cur = m.get(x.accountId);
    if (!cur) continue;
    if (asOf && x.date > asOf) continue;
    m.set(x.accountId, cur.plus(D(x.amount)));
  }
  return m;
}

/** A transfer pair must net to zero when both legs are in the same currency (money moved, not created). */
export function transferImbalance(legs: Pick<LedgerTx, "amount" | "currency">[]): DecT | null {
  if (new Set(legs.map((l) => l.currency)).size > 1) return null; // cross-currency transfers carry an FX difference by design
  return sum(legs.map((l) => l.amount));
}

export interface ConvertedTx extends LedgerTx {
  base: DecT; // amount in the household base currency (signed)
}
export interface Conversions {
  txs: ConvertedTx[];
  excluded: LedgerTx[];
  missingRates: string[];
}
/** Converts transactions to one currency. Rows without a usable rate are excluded and reported. */
export function toBase(txs: LedgerTx[], baseCurrency: string, fx: Fx): Conversions {
  const out: ConvertedTx[] = [];
  const excluded: LedgerTx[] = [];
  for (const t of txs) {
    const c = fx.convert(t.amount, t.currency, baseCurrency, t.date);
    if (!c) excluded.push(t);
    else out.push({ ...t, base: c.amount });
  }
  return { txs: out, excluded, missingRates: fx.missingPairs() };
}

export interface PeriodTotals {
  income: DecT;
  expenses: DecT; // net of refunds and reimbursements
  grossExpenses: DecT;
  refunds: DecT;
  netCashFlow: DecT;
  savingsRate: DecT | null; // net cash flow / income, as a percentage
  count: number;
}

const inRange = (d: IsoDate, from: IsoDate, to: IsoDate) => d >= from && d <= to;

/** Income and expense totals for a period. Transfers and adjustments are ignored by design. */
export function periodTotals(txs: ConvertedTx[], from: IsoDate, to: IsoDate): PeriodTotals {
  let income = ZERO,
    gross = ZERO,
    refunds = ZERO,
    count = 0;
  for (const t of txs) {
    if (!countsInBalance(t) || !inRange(t.date, from, to)) continue;
    switch (t.type) {
      case "INCOME":
        income = income.plus(t.base);
        count++;
        break;
      case "EXPENSE":
        gross = gross.plus(t.base.negated());
        count++;
        break;
      case "REFUND":
      case "REIMBURSEMENT":
        refunds = refunds.plus(t.base);
        count++;
        break;
    }
  }
  const expenses = gross.minus(refunds);
  const net = income.minus(expenses);
  return { income, expenses, grossExpenses: gross, refunds, netCashFlow: net, savingsRate: income.isZero() ? null : net.div(income).times(100).toDecimalPlaces(2), count };
}

export interface MonthRow extends PeriodTotals {
  month: string;
}
export function monthlySeries(txs: ConvertedTx[], from: IsoDate, to: IsoDate): MonthRow[] {
  const keys = monthKeys(from, to);
  const buckets = new Map<string, ConvertedTx[]>(keys.map((k) => [k, []]));
  for (const t of txs) if (inRange(t.date, from, to)) buckets.get(monthOf(t.date))?.push(t);
  return keys.map((k) => {
    const lo = k === monthOf(from) ? from : `${k}-01`;
    const hi = k === monthOf(to) ? to : `${k}-31`;
    return { month: k, ...periodTotals(buckets.get(k) ?? [], lo, hi) };
  });
}

export interface CategoryNode {
  id: string;
  parentId?: string | null;
}
/** Net spending per category id (purchases minus refunds/reimbursements). Uncategorised rows are reported under "uncategorised". */
export function spendByCategory(txs: ConvertedTx[], from: IsoDate, to: IsoDate, filter?: (t: ConvertedTx) => boolean): Map<string, DecT> {
  const m = new Map<string, DecT>();
  for (const t of txs) {
    if (!countsInBalance(t) || !inRange(t.date, from, to)) continue;
    if (filter && !filter(t)) continue;
    let v: DecT | null = null;
    if (t.type === "EXPENSE") v = t.base.negated();
    else if (t.type === "REFUND" || t.type === "REIMBURSEMENT") v = t.base.negated(); // positive amount reduces spend
    if (v === null) continue;
    const k = t.categoryId ?? "uncategorised";
    m.set(k, (m.get(k) ?? ZERO).plus(v));
  }
  return m;
}

/** Walks up the tree to the first ancestor (or self) that is in `targets`. Null when none matches. */
export function resolveAncestor(categoryId: string | null | undefined, targets: Set<string>, parentOf: Map<string, string | null | undefined>): string | null {
  let cur: string | null | undefined = categoryId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (targets.has(cur)) return cur;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return null;
}

/** Roll child category spending up into top-level categories for reports. */
export function rollUpToRoot(spend: Map<string, DecT>, parentOf: Map<string, string | null | undefined>): Map<string, DecT> {
  const out = new Map<string, DecT>();
  for (const [id, v] of spend) {
    let root = id;
    const seen = new Set<string>();
    while (parentOf.get(root) && !seen.has(root)) {
      seen.add(root);
      root = parentOf.get(root) as string;
    }
    out.set(root, (out.get(root) ?? ZERO).plus(v));
  }
  return out;
}

/** Share of an expense total that is "essential" (used by the emergency fund planner). */
export function essentialMonthly(spend: Map<string, DecT>, essentialIds: Set<string>, months: number): DecT {
  let t = ZERO;
  for (const [k, v] of spend) if (essentialIds.has(k)) t = t.plus(v);
  return months > 0 ? t.div(months) : ZERO;
}

export { Dec };
