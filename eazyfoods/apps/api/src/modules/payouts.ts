// Vendor and driver payouts, built from the ledger. A payout sweeps unsettled ledger entries so nothing is paid twice.
import type pg from 'pg';
import { query, one, tx, pool } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { getSetting } from '../lib/settings.js';
import { fromCents, toCents } from '../money.js';
import { notify, notifyVendor } from '../lib/notifications.js';
import { audit, type Actor } from '../lib/audit.js';
import { getProvider } from '../payments/providers.js';
import { postPayout, postTxn } from './ledger.js';

type C = pg.PoolClient;

/** Create a pending payout for one vendor from all eligible unsettled entries. Returns null if nothing is due. */
export async function createVendorPayout(c: C, vendorId: string, actor: Actor, opts: { force?: boolean; now?: Date } = {}) {
  const cfg = await getSetting('payouts', c as any);
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - cfg.hold_days * 86400000);
  const rows = await query<any>(
    `SELECT e.id, e.suborder_id, e.entry_type, e.debit, e.credit, s.number, s.status, coalesce(s.completed_at, s.delivered_at, s.cancelled_at) AS done_at
       FROM ledger_entries e
       JOIN suborders s ON s.id = e.suborder_id
      WHERE e.account = 'liability_vendor' AND e.party_type = 'vendor' AND e.party_id = $1
        AND e.entry_type NOT IN ('payout','payout_reversal')
        AND NOT EXISTS (SELECT 1 FROM payout_ledger_links l WHERE l.ledger_entry_id = e.id)
        AND s.status IN ('completed','refunded','partially_refunded','cancelled')
        AND (s.status = 'cancelled' OR coalesce(s.completed_at, s.delivered_at) <= $2)
      ORDER BY e.id FOR UPDATE OF e SKIP LOCKED`, [vendorId, cutoff], c);
  if (!rows.length) return null;
  const bySub = new Map<string, any>();
  for (const r of rows) {
    const it = bySub.get(r.suborder_id) ?? { suborder_id: r.suborder_id, number: r.number, gross: 0, commission: 0, fees: 0, refunds: 0, net: 0 };
    const d = toCents(r.debit), cr = toCents(r.credit);
    if (r.entry_type === 'capture') { it.gross += cr; it.fees += d; }
    else if (r.entry_type === 'commission') it.commission += d;
    else if (r.entry_type === 'refund') { it.refunds += d; it.commission -= cr; }
    it.net += cr - d;
    bySub.set(r.suborder_id, it);
  }
  const items = [...bySub.values()];
  const net = items.reduce((s, i) => s + i.net, 0);
  if (net <= 0) return null;                                   // clawbacks carry forward to the next cycle
  if (!opts.force && net < toCents(cfg.min_amount)) return null;
  const tot = (k: string) => items.reduce((s, i) => s + i[k], 0);
  const payout = (await one<any>(
    `INSERT INTO payouts(payee_type, payee_id, period_start, period_end, gross, commission, fees, refunds, net, statement)
     VALUES ('vendor',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [vendorId, new Date(Math.min(...rows.map((r) => new Date(r.done_at ?? now).getTime()))), now, fromCents(tot('gross')), fromCents(tot('commission')), fromCents(tot('fees')), fromCents(tot('refunds')), fromCents(net),
      JSON.stringify({ suborders: items.length })], c))!;
  for (const i of items) {
    await query(`INSERT INTO payout_items(payout_id, suborder_id, description, gross, commission, fees, refunds, net) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [payout.id, i.suborder_id, `Order ${i.number}`, fromCents(i.gross), fromCents(i.commission), fromCents(i.fees), fromCents(i.refunds), fromCents(i.net)], c);
  }
  for (const r of rows) await query('INSERT INTO payout_ledger_links(ledger_entry_id, payout_id) VALUES ($1,$2)', [r.id, payout.id], c);
  await audit(actor, 'payout.created', 'payout', payout.id, { vendorId, net: fromCents(net) }, c);
  return payout;
}

export async function createDriverPayout(c: C, driverId: string, actor: Actor, opts: { force?: boolean } = {}) {
  const cfg = await getSetting('payouts', c as any);
  const rows = await query<any>(
    `SELECT e.id, e.delivery_job_id, e.entry_type, e.debit, e.credit FROM ledger_entries e
      WHERE e.account = 'liability_driver' AND e.party_type = 'driver' AND e.party_id = $1 AND e.entry_type NOT IN ('payout','payout_reversal')
        AND NOT EXISTS (SELECT 1 FROM payout_ledger_links l WHERE l.ledger_entry_id = e.id) ORDER BY e.id FOR UPDATE OF e SKIP LOCKED`, [driverId], c);
  if (!rows.length) return null;
  const net = rows.reduce((s, r) => s + toCents(r.credit) - toCents(r.debit), 0);
  if (net <= 0 || (!opts.force && net < toCents(cfg.min_amount))) return null;
  const jobs = new Set(rows.map((r) => r.delivery_job_id).filter(Boolean));
  const payout = (await one<any>(
    `INSERT INTO payouts(payee_type, payee_id, period_start, period_end, gross, net, statement) VALUES ('driver',$1,now() - interval '7 days',now(),$2,$2,$3) RETURNING *`,
    [driverId, fromCents(net), JSON.stringify({ deliveries: jobs.size })], c))!;
  await query(`INSERT INTO payout_items(payout_id, description, gross, net) VALUES ($1,$2,$3,$3)`, [payout.id, `${jobs.size} deliveries including tips`, fromCents(net)], c);
  for (const r of rows) await query('INSERT INTO payout_ledger_links(ledger_entry_id, payout_id) VALUES ($1,$2)', [r.id, payout.id], c);
  await query("UPDATE driver_earnings SET status = 'paid' WHERE driver_id = $1 AND status = 'pending'", [driverId], c);
  await audit(actor, 'payout.created', 'payout', payout.id, { driverId, net: fromCents(net) }, c);
  return payout;
}

/** Send a pending payout to the provider. */
export async function processPayout(payoutId: string, actor: Actor) {
  const claimed = await tx(async (c) => {
    const p = await one<any>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!p) throw notFound('That payout');
    if (!['pending', 'failed'].includes(p.status)) throw conflict('PAYOUT_STATE', `This payout is ${p.status} and can not be processed.`);
    await query("UPDATE payouts SET status = 'processing' WHERE id = $1", [payoutId], c);
    return p;
  });
  const dest = claimed.payee_type === 'vendor'
    ? (await one<any>('SELECT payout_account_ref FROM vendors WHERE id = $1', [claimed.payee_id]))?.payout_account_ref
    : (await one<any>('SELECT payout_account_ref FROM driver_profiles WHERE user_id = $1', [claimed.payee_id]))?.payout_account_ref;
  const res = await getProvider().transfer(dest ?? null, toCents(claimed.net), `EAZyfoods payout ${payoutId}`, `payout:${payoutId}`);
  // A failed transfer must be recorded and committed, so the failure is returned and thrown after the transaction.
  const outcome = await tx(async (c) => {
    if (!res.ok) {
      await query("UPDATE payouts SET status = 'failed', failure_reason = $2 WHERE id = $1", [payoutId, res.failureInternal ?? 'Transfer failed'], c);
      await audit(actor, 'payout.failed', 'payout', payoutId, { reason: res.failureInternal }, c);
      if (claimed.payee_type === 'vendor') await notifyVendor(claimed.payee_id, { kind: 'payout', title: 'Payout could not be sent', body: 'We could not send your payout. Please check your payout account details or contact support.', data: { payoutId } }, c);
      return { failed: true as const };
    }
    await query("UPDATE payouts SET status = 'paid', paid_at = now(), provider_ref = $2, failure_reason = NULL WHERE id = $1", [payoutId, res.ref], c);
    await postPayout(c, { payoutId, payeeType: claimed.payee_type, payeeId: claimed.payee_id, amount: toCents(claimed.net) });
    await audit(actor, 'payout.paid', 'payout', payoutId, { net: Number(claimed.net) }, c);
    const body = `A payout of $${Number(claimed.net).toFixed(2)} was sent.`;
    if (claimed.payee_type === 'vendor') await notifyVendor(claimed.payee_id, { kind: 'payout', title: 'Payout sent', body, data: { payoutId } }, c);
    else await notify({ userId: claimed.payee_id, kind: 'payout', title: 'Payout sent', body, data: { payoutId } }, c);
    return { failed: false as const, payout: await one('SELECT * FROM payouts WHERE id = $1', [payoutId], c) };
  });
  if (outcome.failed) throw new AppError('PAYOUT_FAILED', 502, 'The payout could not be sent. It was marked failed so it can be retried.', undefined, res.failureInternal);
  return outcome.payout;
}

export async function holdPayout(payoutId: string, reason: string, actor: Actor) {
  return tx(async (c) => {
    const p = await one<any>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!p) throw notFound('That payout');
    if (!['pending', 'failed'].includes(p.status)) throw conflict('PAYOUT_STATE', 'Only pending payouts can be held.');
    await query("UPDATE payouts SET status = 'held', hold_reason = $2 WHERE id = $1", [payoutId, reason], c);
    await audit(actor, 'payout.held', 'payout', payoutId, { reason }, c);
  });
}
export async function releasePayout(payoutId: string, actor: Actor) {
  return tx(async (c) => {
    const p = await one<any>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!p || p.status !== 'held') throw conflict('PAYOUT_STATE', 'This payout is not on hold.');
    await query("UPDATE payouts SET status = 'pending', hold_reason = NULL WHERE id = $1", [payoutId], c);
    await audit(actor, 'payout.released', 'payout', payoutId, null, c);
  });
}
export async function reversePayout(payoutId: string, reason: string, actor: Actor) {
  return tx(async (c) => {
    const p = await one<any>('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payoutId], c);
    if (!p || p.status !== 'paid') throw conflict('PAYOUT_STATE', 'Only paid payouts can be reversed.');
    const acct = p.payee_type === 'vendor' ? 'liability_vendor' : 'liability_driver';
    await postTxn(c, { entryType: 'payout_reversal', payoutId }, [
      { account: 'cash_clearing', side: 'debit', amount: toCents(p.net) },
      { account: acct, side: 'credit', amount: toCents(p.net), partyType: p.payee_type, partyId: p.payee_id },
    ]);
    await query('DELETE FROM payout_ledger_links WHERE payout_id = $1', [payoutId], c);   // entries become payable again
    await query("UPDATE payouts SET status = 'reversed', failure_reason = $2 WHERE id = $1", [payoutId, reason], c);
    await audit(actor, 'payout.reversed', 'payout', payoutId, { reason }, c);
  });
}

/** Scheduled run: create and process payouts for everyone with money due. */
export async function runPayoutCycle(actor: Actor, opts: { process?: boolean; force?: boolean } = {}) {
  const cfg = await getSetting('payouts');
  const vendors = await query<{ id: string }>(
    `SELECT v.id FROM vendors v WHERE v.verification_status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM payouts p WHERE p.payee_type = 'vendor' AND p.payee_id = v.id AND p.created_at > now() - ($1 || ' days')::interval AND p.status <> 'reversed')`, [opts.force ? '0' : String(cfg.frequency_days)]);
  const created: any[] = [];
  for (const v of vendors) {
    const p = await tx((c) => createVendorPayout(c, v.id, actor, { force: opts.force }));
    if (p) created.push(p);
  }
  const drivers = await query<{ user_id: string }>("SELECT user_id FROM driver_profiles WHERE verification_status = 'approved'");
  for (const d of drivers) {
    const p = await tx((c) => createDriverPayout(c, d.user_id, actor, { force: opts.force }));
    if (p) created.push(p);
  }
  if (opts.process) for (const p of created) await processPayout(p.id, actor).catch(() => {});
  return created.length;
}

export async function payoutStatement(payoutId: string) {
  const p = await one<any>('SELECT * FROM payouts WHERE id = $1', [payoutId]);
  if (!p) throw notFound('That payout');
  const items = await query<any>('SELECT * FROM payout_items WHERE payout_id = $1 ORDER BY id', [payoutId]);
  const name = p.payee_type === 'vendor'
    ? (await one<any>('SELECT trading_name AS n FROM vendors WHERE id = $1', [p.payee_id]))?.n
    : (await one<any>('SELECT full_name AS n FROM users WHERE id = $1', [p.payee_id]))?.n;
  return { payout: p, payee: name, items };
}
