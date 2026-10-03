'use client';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Bars, Btn, ErrorNote, HBars, KV, Modal, Select, Spinner, Stars, Stat, Table, Textarea, useToast } from '../ui';
import { useApi } from '@/hooks/useApi';
import { get, post } from '@/lib/api';
import { date, dateTime, label, money } from '@/lib/format';

export function VendorAnalytics() {
  const { vendorId } = useVendor(); const [days, setDays] = useState('30');
  const { data: d, error, reload } = useApi<any>(`/vendors/${vendorId}/analytics?days=${days}`, []);
  return (
    <>
      <PageHead title="Analytics" sub="Computed from your real orders and storefront events." actions={<div style={{ width: 160 }}><Select label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></div>} />
      <ErrorNote error={error} retry={reload} />
      {!d ? <Spinner /> : (<div className="stack" style={{ '--gap': '20px' } as any}>
        <div className="grid cols-4"><Stat label="Sales" value={money(d.sales.period)} /><Stat label="After commission" value={money(d.sales.net_after_fees)} hint={`${money(d.sales.fees)} commission`} /><Stat label="Orders" value={d.orders} /><Stat label="Average order" value={money(d.average_order_value)} /></div>
        <div className="grid cols-4"><Stat label="Cancellation rate" value={`${d.cancellation_rate}%`} /><Stat label="Refund rate" value={`${d.refund_rate}%`} /><Stat label="Views to orders" value={`${d.conversion.view_to_order_pct}%`} hint={`${d.conversion.views} views, ${d.conversion.add_to_cart} carts`} /><Stat label="Stock value" value={money(d.inventory.stock_value)} hint={`${d.inventory.low_stock} low, ${d.inventory.out_of_stock} out`} /></div>
        <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Sales per day</h2><Bars data={d.series.map((s: any) => ({ label: s.day, value: s.sales }))} format={money} /></section>
        <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Best sellers by revenue</h2><HBars data={d.best_products.map((p: any) => ({ label: `${p.name} (${p.units} sold)`, value: p.revenue }))} format={money} /></section>
      </div>)}
    </>
  );
}

export function VendorReviews() {
  const { vendorId } = useVendor(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/vendors/${vendorId}/reviews`);
  const [reply, setReply] = useState<any>(null); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHead title="Reviews" sub="Respond publicly. Customers see your reply under their review." />
      <ErrorNote error={error} retry={reload} />
      <div className="stack">{data?.reviews.map((r: any) => (
        <article key={r.id} className="card pad"><div className="row spread"><span><Stars value={r.rating} /> <Badge>{label(r.subject_type)}</Badge></span><span className="small muted">{r.customer} · {r.number} · {date(r.created_at)}</span></div>
          <p>{r.body}</p>{r.vendor_response ? <p className="small" style={{ borderLeft: '3px solid var(--line-strong)', paddingLeft: 10 }}><b>Your reply:</b> {r.vendor_response}</p> : <Btn size="sm" variant="secondary" onClick={() => { setReply(r); setText(''); }}>Reply</Btn>}</article>))}
        {data && !data.reviews.length && <p className="muted">No reviews yet.</p>}</div>
      {reply && <Modal title="Reply to review" onClose={() => setReply(null)} footer={<><Btn variant="secondary" onClick={() => setReply(null)}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => { setBusy(true); try { await post(`/vendors/${vendorId}/reviews/${reply.id}/respond`, { text }); toast('Reply posted'); setReply(null); reload(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>Post reply</Btn></>}><p className="small muted">“{reply.body}”</p><Textarea label="Your reply" value={text} onChange={setText} maxLength={1000} hint="Be polite and specific. Replies are public." /></Modal>}
    </>
  );
}

export function VendorPayouts() {
  const { vendorId } = useVendor(); const { data, error, reload } = useApi<any>(`/vendors/${vendorId}/payouts`); const [open, setOpen] = useState<any>(null);
  const show = async (id: string) => setOpen(await get(`/vendors/${vendorId}/payouts/${id}`));
  return (
    <>
      <PageHead title="Payouts" sub="Payouts are calculated from the ledger: sales minus commission, fees and refunds." />
      <ErrorNote error={error} retry={reload} />
      {data && <div className="grid cols-3" style={{ marginBottom: 18 }}><Stat label="Balance owed to you" value={money(data.ledger_balance)} hint="Paid out on the next run" /><Stat label="Your commission" value={`${data.commission.percent}%`} hint={data.commission.fixed_fee ? `Plus ${money(data.commission.fixed_fee)} per order` : 'Per order, on the item subtotal'} /><Stat label="Payouts" value={data.payouts.length} /></div>}
      <Table caption="Payouts" rows={data?.payouts ?? []} onRow={(r: any) => show(r.id)} cols={[{ key: 'period', header: 'Period', render: (r: any) => `${date(r.period_start)} to ${date(r.period_end)}` }, { key: 'gross', header: 'Gross', align: 'right', render: (r: any) => money(r.gross) }, { key: 'commission', header: 'Commission', align: 'right', render: (r: any) => `−${money(r.commission)}` }, { key: 'refunds', header: 'Refunds', align: 'right', render: (r: any) => `−${money(r.refunds)}` }, { key: 'net', header: 'Net', align: 'right', render: (r: any) => <b>{money(r.net)}</b> }, { key: 'status', header: 'Status', render: (r: any) => <><Badge status={r.status} />{r.hold_reason && <div className="tiny muted">{r.hold_reason}</div>}</> }]} />
      {open && <Modal title="Payout statement" onClose={() => setOpen(null)} wide><KV items={[['Status', label(open.payout.status)], ['Scheduled', dateTime(open.payout.scheduled_for)], ['Paid', open.payout.paid_at ? dateTime(open.payout.paid_at) : 'Not yet'], ['Gross', money(open.payout.gross)], ['Commission', money(open.payout.commission)], ['Refunds', money(open.payout.refunds)], ['Net', money(open.payout.net)]]} /><h3>Orders in this payout</h3><Table caption="Orders" rows={open.items ?? []} cols={[{ key: 'description', header: 'Order' }, { key: 'gross', header: 'Gross', align: 'right', render: (r: any) => money(r.gross) }, { key: 'commission', header: 'Commission', align: 'right', render: (r: any) => money(r.commission) }, { key: 'net', header: 'Net', align: 'right', render: (r: any) => money(r.net) }]} /></Modal>}
    </>
  );
}

export function VendorDisputes() {
  const { vendorId } = useVendor(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/vendors/${vendorId}/disputes`); const [r, setR] = useState<any>(null); const [text, setText] = useState('');
  return (
    <>
      <PageHead title="Disputes" sub="Customer reports about delivered orders. Respond with your side. Support makes the final decision." />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Disputes" rows={data?.disputes ?? []} empty="No disputes. Good work." cols={[{ key: 'number', header: 'Order' }, { key: 'category', header: 'Issue', render: (x: any) => label(x.category ?? 'other') }, { key: 'reason', header: 'Customer said', render: (x: any) => <span className="small">{x.reason}</span> }, { key: 'status', header: 'Status', render: (x: any) => <Badge status={x.status} /> }, { key: 'a', header: '', render: (x: any) => x.status === 'open' || x.status === 'waiting_vendor' ? <Btn size="sm" variant="secondary" onClick={() => { setR(x); setText(''); }}>Respond</Btn> : null }]} />
      {r && <Modal title={`Respond about ${r.number}`} onClose={() => setR(null)} footer={<><Btn variant="secondary" onClick={() => setR(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await post(`/vendors/${vendorId}/disputes/${r.id}/respond`, { text }); toast('Response sent'); setR(null); reload(); } catch (e: any) { toast(e.message, 'bad'); } }}>Send response</Btn></>}><p className="alert">{r.reason}</p><Textarea label="Your response" value={text} onChange={setText} /></Modal>}
    </>
  );
}

export function VendorTeam() {
  const { vendorId, membership } = useVendor(); const toast = useToast();
  const { data, reload } = useApi<any>(`/vendors/${vendorId}/manage`); const [email, setEmail] = useState(''); const [role, setRole] = useState('staff');
  const owner = membership.member_role === 'owner';
  return (
    <>
      <PageHead title="Team" sub="Owners manage everything. Managers run products, orders and promotions. Staff handle orders and stock." />
      <Table caption="Team" rows={data?.team ?? []} cols={[{ key: 'full_name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'member_role', header: 'Role', render: (r: any) => <Badge>{label(r.member_role)}</Badge> }, { key: 'x', header: '', render: (r: any) => owner && r.member_role !== 'owner' ? <Btn size="sm" variant="ghost" onClick={async () => { try { await fetch(`/api/vendors/${vendorId}/team/${r.user_id}`, { method: 'DELETE', credentials: 'include', headers: { 'x-requested-with': 'ezweb' } }); reload(); } catch { toast('Could not remove', 'bad'); } }}>Remove</Btn> : null }]} />
      {owner && <form className="card pad row wrap-row" style={{ marginTop: 18, alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); try { await post(`/vendors/${vendorId}/team`, { email, role }); toast('Team member added'); setEmail(''); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>
        <div className="grow" style={{ minWidth: 240 }}><label className="label" htmlFor="tm">Email of an existing EAZyfoods account</label><input id="tm" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div style={{ width: 160 }}><Select label="Role" value={role} onChange={setRole} options={['manager', 'staff']} /></div><Btn type="submit" variant="primary">Add</Btn></form>}
    </>
  );
}
