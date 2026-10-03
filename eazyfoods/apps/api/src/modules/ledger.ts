// Immutable double entry ledger. Every money movement is a balanced transaction. Reports are computed from here,
// never re-derived from mutable order rows.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { query, one, pool, type Db } from '../db.js';
import { fromCents, type Cents } from '../money.js';

export type Account =
  | 'cash_clearing' | 'liability_vendor' | 'liability_driver' | 'liability_tax' | 'liability_customer_credit'
  | 'revenue_commission' | 'revenue_delivery' | 'revenue_service_fee' | 'expense_promo' | 'expense_driver_pay' | 'expense_refund';

export interface Line { account: Account; side: 'debit' | 'credit'; amount: Cents; partyType?: 'vendor' | 'driver' | 'customer'; partyId?: string | null; memo?: string }
export interface TxnMeta { entryType: string; orderId?: string | null; suborderId?: string | null; jobId?: string | null; refundId?: string | null; payoutId?: string | null; currency?: string; memo?: string }

export async function postTxn(c: pg.PoolClient | Db, meta: TxnMeta, lines: Line[]) {
  const live = lines.filter((l) => l.amount !== 0);
  const d = live.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0);
  const cr = live.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0);
  if (d !== cr) throw new Error(`Unbalanced ledger transaction ${meta.entryType}: debit ${d} credit ${cr}`);
  if (live.some((l) => l.amount < 0)) throw new Error('Ledger lines must be positive');
  const txn = randomUUID();
  const ids: number[] = [];
  for (const l of live) {
    const r = await one<{ id: number }>(
      `INSERT INTO ledger_entries(txn_id, entry_type, account, party_type, party_id, order_id, suborder_id, delivery_job_id, refund_id, payout_id, currency, debit, credit, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [txn, meta.entryType, l.account, l.partyType ?? null, l.partyId ?? null, meta.orderId ?? null, meta.suborderId ?? null, meta.jobId ?? null, meta.refundId ?? null, meta.payoutId ?? null,
        meta.currency ?? 'CAD', l.side === 'debit' ? fromCents(l.amount) : 0, l.side === 'credit' ? fromCents(l.amount) : 0, l.memo ?? meta.memo ?? null], c);
    ids.push(r!.id);
  }
  return { txn, ids };
}

const D = (account: Account, amount: Cents, o: Partial<Line> = {}): Line => ({ account, side: 'debit', amount, ...o });
const Cr = (account: Account, amount: Cents, o: Partial<Line> = {}): Line => ({ account, side: 'credit', amount, ...o });

export interface SuborderMoney {
  id: string; order_id: string; vendor_id: string; fulfillment_type: string;
  items_subtotal: Cents; vendor_discount: Cents; platform_discount: Cents; tax_total: Cents; delivery_fee: Cents;
  delivery_subsidy_vendor: Cents; delivery_subsidy_platform: Cents; service_fee: Cents; tip: Cents; customer_total: Cents;
  commission_amount: Cents; fixed_fee_amount: Cents;
}

/** Posted when a payment is captured for a suborder. */
export async function postCapture(c: pg.PoolClient, s: SuborderMoney, creditShare: Cents) {
  const vendor = { partyType: 'vendor' as const, partyId: s.vendor_id };
  const own = s.fulfillment_type === 'delivery_vendor';
  const lines: Line[] = [
    D('cash_clearing', s.customer_total - creditShare),
    D('liability_customer_credit', creditShare),
    D('expense_promo', s.platform_discount + s.delivery_subsidy_platform),
    D('liability_vendor', s.delivery_subsidy_vendor, vendor),
    Cr('liability_vendor', s.items_subtotal - s.vendor_discount + (own ? s.delivery_fee : 0), vendor),
    Cr('liability_tax', s.tax_total),
    Cr('revenue_delivery', own ? 0 : s.delivery_fee),
    Cr('revenue_service_fee', s.service_fee),
    Cr('liability_driver', s.tip, { memo: 'tip held until delivery' }),
  ];
  await postTxn(c, { entryType: 'capture', orderId: s.order_id, suborderId: s.id }, lines);
  // Commission is taken from the vendor's share in its own transaction so it is visible as a separate event.
  const fee = s.commission_amount + s.fixed_fee_amount;
  await postTxn(c, { entryType: 'commission', orderId: s.order_id, suborderId: s.id }, [D('liability_vendor', fee, vendor), Cr('revenue_commission', fee)]);
}

export async function postDriverPay(c: pg.PoolClient, p: { jobId: string; orderId: string; suborderId: string; driverId: string; pay: Cents; tip: Cents }) {
  const driver = { partyType: 'driver' as const, partyId: p.driverId };
  await postTxn(c, { entryType: 'driver_pay', orderId: p.orderId, suborderId: p.suborderId, jobId: p.jobId }, [
    D('expense_driver_pay', p.pay), Cr('liability_driver', p.pay, driver),
  ]);
  if (p.tip > 0) {
    await postTxn(c, { entryType: 'tip_assign', orderId: p.orderId, suborderId: p.suborderId, jobId: p.jobId }, [
      D('liability_driver', p.tip, { memo: 'tip released' }), Cr('liability_driver', p.tip, driver),
    ]);
  }
}

export interface RefundParts {
  grossVendor: Cents;       // vendor share of refunded items before platform funded discounts
  platformDiscount: Cents;  // platform funded discount attached to refunded items
  netItems: Cents;          // what the customer paid for those items
  tax: Cents; delivery: Cents; serviceFee: Cents; tip: Cents; commission: Cents; fixedFee: Cents;
  subsidyVendor: Cents; subsidyPlatform: Cents;   // delivery waivers unwound when the delivery fee is refunded
  deliveryOwn: boolean; bearer: 'vendor' | 'platform';
  toCard: Cents; toCredit: Cents;
}
export async function postRefund(c: pg.PoolClient, ids: { orderId: string; suborderId: string; vendorId: string; refundId: string }, r: RefundParts) {
  const vendor = { partyType: 'vendor' as const, partyId: ids.vendorId };
  const lines: Line[] = [
    Cr('cash_clearing', r.toCard),
    Cr('liability_customer_credit', r.toCredit, { partyType: 'customer' }),
    D('liability_tax', r.tax),
    D('revenue_service_fee', r.serviceFee),
    D('liability_driver', r.tip, { memo: 'tip refunded' }),
  ];
  if (r.deliveryOwn) {
    lines.push(D('liability_vendor', r.delivery + r.subsidyPlatform, vendor), Cr('expense_promo', r.subsidyPlatform));
  } else {
    lines.push(D('revenue_delivery', r.delivery + r.subsidyVendor + r.subsidyPlatform), Cr('liability_vendor', r.subsidyVendor, vendor), Cr('expense_promo', r.subsidyPlatform));
  }
  if (r.bearer === 'vendor') {
    lines.push(D('liability_vendor', r.grossVendor, vendor), Cr('expense_promo', r.platformDiscount));
    lines.push(D('revenue_commission', r.commission + r.fixedFee), Cr('liability_vendor', r.commission + r.fixedFee, vendor));
  } else {
    lines.push(D('expense_refund', r.netItems));
  }
  await postTxn(c, { entryType: 'refund', orderId: ids.orderId, suborderId: ids.suborderId, refundId: ids.refundId }, lines);
}

export async function postCreditGrant(c: pg.PoolClient, userId: string, amount: Cents, memo: string, orderId?: string) {
  await postTxn(c, { entryType: 'credit_grant', orderId: orderId ?? null, memo }, [D('expense_refund', amount), Cr('liability_customer_credit', amount, { partyType: 'customer', partyId: userId })]);
}

export async function postPayout(c: pg.PoolClient, p: { payoutId: string; payeeType: 'vendor' | 'driver'; payeeId: string; amount: Cents }) {
  const acct: Account = p.payeeType === 'vendor' ? 'liability_vendor' : 'liability_driver';
  await postTxn(c, { entryType: 'payout', payoutId: p.payoutId }, [D(acct, p.amount, { partyType: p.payeeType, partyId: p.payeeId }), Cr('cash_clearing', p.amount)]);
}

/** liability balance (credits minus debits) for a vendor or driver. */
export async function partyBalance(partyType: 'vendor' | 'driver', partyId: string, db: Db = pool) {
  const acct = partyType === 'vendor' ? 'liability_vendor' : 'liability_driver';
  const r = await one<{ b: number }>(`SELECT coalesce(sum(credit - debit),0) AS b FROM ledger_entries WHERE account = $1 AND party_type = $2 AND party_id = $3`, [acct, partyType, partyId], db);
  return r!.b;
}

export async function trialBalance(db: Db = pool) {
  const rows = await query<any>(`SELECT account, sum(debit) AS debit, sum(credit) AS credit FROM ledger_entries GROUP BY account ORDER BY account`, [], db);
  const totals = rows.reduce((t, r) => ({ debit: t.debit + Number(r.debit), credit: t.credit + Number(r.credit) }), { debit: 0, credit: 0 });
  return { accounts: rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit, balance: r.credit - r.debit })), balanced: Math.abs(totals.debit - totals.credit) < 0.005, totals };
}

/** Compare the ledger against payment records. Differences point at missing postings. */
export async function reconcile(db: Db = pool) {
  const [cash, pay] = await Promise.all([
    one<any>(`SELECT coalesce(sum(debit - credit),0) AS cash_in_ledger,
              coalesce(sum(debit) FILTER (WHERE entry_type='capture'),0) AS captured,
              coalesce(sum(credit) FILTER (WHERE entry_type='refund'),0) AS refunded_to_card,
              coalesce(sum(credit) FILTER (WHERE entry_type='payout'),0) AS paid_out
              FROM ledger_entries WHERE account='cash_clearing'`, [], db),
    one<any>(`SELECT coalesce(sum(amount) FILTER (WHERE status IN ('captured','partially_refunded','refunded')),0) AS captured_payments,
              coalesce(sum(refunded_amount),0) AS refunded_payments FROM payments`, [], db),
  ]);
  const tb = await trialBalance(db);
  const diff = Math.round((Number(pay.captured_payments) - Number(cash.captured)) * 100) / 100;
  return {
    balanced: tb.balanced, trial_balance: tb,
    cash: { in_ledger: cash.cash_in_ledger, captured: cash.captured, refunded: cash.refunded_to_card, paid_out: cash.paid_out },
    payments: { captured: pay.captured_payments, refunded: pay.refunded_payments },
    capture_difference: diff, ok: tb.balanced && Math.abs(diff) < 0.01,
  };
}
