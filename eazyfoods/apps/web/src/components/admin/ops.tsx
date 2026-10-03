'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PageHead } from '../portal';
import { Badge, Btn, Check, Confirm, ErrorNote, Input, KV, Modal, Pager, Select, Spinner, Stat, Table, Tabs, Textarea, useToast } from '../ui';
import { get, post } from '@/lib/api';
import { useApi, useStream } from '@/hooks/useApi';
import { useAuth } from '../providers';
import { dateTime, label, money, relative, time } from '@/lib/format';

/* ---------------- command centre ---------------- */
export function CommandCentre() {
  const { data, error, reload } = useApi<any>('/admin/command-centre'); const alerts = useApi<any>('/admin/alerts'); const online = useApi<any>('/admin/drivers/online'); const toast = useToast();
  const [feed, setFeed] = useState<string[]>([]);
  useStream(['admin'], (t, d) => { if (t === 'order.new') setFeed((f) => [`New order ${d.number}`, ...f].slice(0, 6)); if (['order.new', 'suborder.status', 'delivery.status', 'refund.issued', 'ticket.new'].includes(t)) { reload(); if (t === 'delivery.status') online.reload(); } });
  const k = data?.kpis; const att = data?.attention ?? {};
  const List = ({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => React.ReactNode }) => rows?.length ? <section className="card pad"><h3>{title} <Badge tone="warn">{rows.length}</Badge></h3><ul style={{ margin: 0, paddingLeft: 18 }} className="small">{rows.slice(0, 6).map((r) => <li key={r.id}>{render(r)}</li>)}</ul></section> : null;
  return (
    <>
      <PageHead title="Command centre" sub={data ? `Updated ${time(data.generated_at)}. Live: refreshes when orders and deliveries change.` : ''} actions={<Btn variant="secondary" onClick={reload}>Refresh</Btn>} />
      <ErrorNote error={error} retry={reload} />
      {feed.length > 0 && <div className="alert ok" role="status" style={{ marginBottom: 12 }}>{feed.join(' · ')}</div>}
      {!k ? <Spinner /> : (<div className="stack" style={{ '--gap': '20px' } as any}>
        <div className="grid cols-4"><Stat label="Orders today" value={k.orders_today} hint={`${money(k.gmv_today)} GMV`} /><Stat label="Drivers online" value={k.drivers_online} hint={`${k.drivers_available} available`} /><Stat label="Deliveries in progress" value={k.deliveries_in_progress} /><Stat label="Active sellers" value={k.active_vendors + k.active_chefs} hint={`${k.active_vendors} stores, ${k.active_chefs} chefs`} /></div>
        <div className="grid cols-4"><Stat label="Open disputes" value={k.open_disputes} /><Stat label="Support tickets open" value={k.support_open} /><Stat label="Risk signals" value={k.risk_open} /><Stat label="Active customers" value={k.active_customers} /></div>
        {alerts.data?.alerts.length > 0 && <section className="card pad"><h3>Operational alerts</h3>{alerts.data.alerts.map((a: any) => <div key={a.id} className="row spread small"><span><Badge tone={a.severity === 'high' ? 'bad' : 'warn'}>{a.severity}</Badge> {a.message}</span><Btn size="sm" variant="ghost" onClick={async () => { await post(`/admin/alerts/${a.id}/resolve`); toast('Resolved'); alerts.reload(); }}>Resolve</Btn></div>)}</section>}
        <div className="grid cols-3" style={{ alignItems: 'start' }}>
          <List title="Seller has not responded" rows={att.vendor_not_responding} render={(r) => <><Link href={`/admin/orders`}>{r.number}</Link> at {r.vendor}, {relative(r.created_at)}</>} />
          <List title="Preparation is late" rows={att.delayed_preparation} render={(r) => <>{r.number} at {r.vendor}, ready was due {relative(r.estimated_ready_at)}</>} />
          <List title="Ready, no driver yet" rows={att.no_driver_assigned} render={(r) => <><Link href="/admin/dispatch">{r.number}</Link> from {r.vendor}</>} />
          <List title="Sellers offline" rows={att.vendors_offline} render={(r) => <>{r.trading_name ?? r.name}</>} />
        </div>
        <section className="card pad"><h3>Drivers online</h3><Table caption="Drivers online" rows={online.data?.drivers ?? []} empty="No drivers online." cols={[{ key: 'name', header: 'Driver' }, { key: 'active_jobs', header: 'Active jobs', align: 'right' }, { key: 'location_updated_at', header: 'Location updated', render: (r: any) => (r.location_updated_at ? relative(r.location_updated_at) : 'Never') }]} /></section>
      </div>)}
    </>
  );
}

/* ---------------- orders ---------------- */
function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/admin/orders/${id}`);
  const [sub, setSub] = useState<any>(null); const [mode, setMode] = useState<null | 'cancel' | 'refund' | 'status' | 'note'>(null);
  const [reason, setReason] = useState(''); const [amount, setAmount] = useState(''); const [full, setFull] = useState(true); const [delivery, setDelivery] = useState(false); const [bearer, setBearer] = useState('platform'); const [status, setStatus] = useState('preparing'); const [busy, setBusy] = useState(false);
  const o = data?.order;
  const run = async (path: string, body: any, msg: string) => { setBusy(true); try { await post(path, body); toast(msg); setMode(null); setReason(''); reload(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <Modal title={o ? `Order ${o.number}` : 'Order'} onClose={onClose} wide>
      <ErrorNote error={error} />
      {!o ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={o.status} /><Badge status={o.payment?.status}>Payment {o.payment?.status}</Badge><span className="small muted">{dateTime(o.placed_at)} · {o.customer?.full_name} · {o.customer?.email} · {o.customer?.phone}</span></div>
        {o.suborders.map((s: any) => (
          <section key={s.id} className="card pad"><div className="row spread wrap-row"><div><b>{s.number}</b> · {s.vendor.name} <Badge status={s.status} /> <span className="small muted">{label(s.fulfillment)}</span></div>
            <div className="row">{can('orders.manage') && <Btn size="sm" variant="secondary" onClick={() => { setSub(s); setMode('status'); }}>Change status</Btn>}{can('refunds.issue') && <Btn size="sm" variant="secondary" onClick={() => { setSub(s); setMode('refund'); }}>Refund</Btn>}{can('orders.cancel') && !['cancelled', 'delivered', 'completed', 'refunded'].includes(s.status) && <Btn size="sm" variant="danger-outline" onClick={() => { setSub(s); setMode('cancel'); }}>Cancel</Btn>}</div></div>
            <Table caption={`Items in ${s.number}`} rows={s.items ?? []} cols={[{ key: 'name', header: 'Item', render: (i: any) => `${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}` }, { key: 'quantity', header: 'Qty', align: 'right' }, { key: 'refunded_qty', header: 'Refunded', align: 'right' }, { key: 'line_subtotal', header: 'Amount', align: 'right', render: (i: any) => money(i.line_subtotal) }]} />
            <KV items={[['Items', money(s.totals.items)], ['Delivery', money(s.totals.delivery)], ['Tax', money(s.totals.tax)], ['Customer total', money(s.totals.total)], ['Refunded', money(s.totals.refunded)], ['Commission', `${money(s.financials?.commission)} (${s.financials?.commission_rate}%)`], ['Vendor net', money(s.financials?.vendor_net)], ['Driver', s.delivery?.driver?.first_name ?? (s.fulfillment === 'pickup' ? 'Pickup' : 'None yet')]]} />
            {s.dispute && <p className="alert">Dispute {label(s.dispute.status)}: {s.dispute.reason}</p>}
          </section>))}
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <section className="card pad"><h3>Payment and refunds</h3><div className="small">{o.payment?.provider} · {o.payment?.card} · <Badge status={o.payment?.status} />{o.payment?.refunded > 0 && <> refunded {money(o.payment.refunded)}</>}</div>{(o.refunds ?? []).map((r: any) => <div key={r.id} className="small">Refund {money(r.amount)} ({r.bearer}) {r.reason}</div>)}<h3 style={{ marginTop: 12 }}>Internal notes</h3>{(o.internal_notes ?? []).map((n: any, i: number) => <div key={i} className="small">{dateTime(n.created_at)} {n.actor}: {n.changes?.note ?? n.note}</div>)}{!(o.internal_notes ?? []).length && <p className="muted small">None.</p>}</section>
          <section className="card pad"><h3>Activity</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(o.audit ?? []).slice(0, 14).map((h: any, i: number) => <li key={i}>{dateTime(h.created_at)}: {h.action} by {h.actor ?? 'system'}</li>)}</ul></section>
        </div>
        {can('orders.manage') && <div><Btn variant="secondary" onClick={() => setMode('note')}>Add internal note</Btn></div>}
      </div>)}
      {mode && (
        <Modal title={mode === 'cancel' ? `Cancel ${sub?.number}` : mode === 'refund' ? `Refund ${sub?.number}` : mode === 'status' ? `Change status of ${sub?.number}` : 'Internal note'} onClose={() => setMode(null)}
          footer={<><Btn variant="secondary" onClick={() => setMode(null)}>Back</Btn><Btn variant={mode === 'cancel' ? 'danger' : 'primary'} busy={busy} disabled={reason.trim().length < 3 && mode !== 'refund'} onClick={() => {
            if (mode === 'cancel') run(`/admin/suborders/${sub.id}/cancel`, { reason }, 'Cancelled and refunded');
            else if (mode === 'refund') run(`/admin/suborders/${sub.id}/refund`, { ...(full ? { fullItems: true } : { amount: Number(amount) }), includeDelivery: delivery, bearer, reason: reason || 'Staff refund' }, 'Refund issued');
            else if (mode === 'status') run(`/admin/suborders/${sub.id}/status`, { status, note: reason }, 'Status updated');
            else run(`/admin/orders/${id}/notes`, { note: reason }, 'Note saved');
          }}>Confirm</Btn></>}>
          <div className="stack">
            {mode === 'refund' && <><Check label="Refund all items" checked={full} onChange={setFull} />{!full && <Input label="Amount (CAD)" type="number" step="0.01" min={0.01} value={amount} onChange={setAmount} />}<Check label="Include delivery fee" checked={delivery} onChange={setDelivery} /><Select label="Who bears the cost?" value={bearer} onChange={setBearer} options={[{ value: 'platform', label: 'Platform' }, { value: 'vendor', label: 'Seller (deducted from payout)' }]} /></>}
            {mode === 'status' && <Select label="New status" value={status} onChange={setStatus} options={['vendor_accepted', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered']} />}
            <Textarea label={mode === 'note' ? 'Note' : 'Reason (recorded in the audit log)'} value={reason} onChange={setReason} />
          </div>
        </Modal>)}
    </Modal>
  );
}

function OrdersInner() {
  const sp = useSearchParams(); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(sp.get('open'));
  const { data, error, loading, reload } = useApi<any>(`/admin/orders?page=${page}&limit=30${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  useStream(['admin'], (t) => { if (t === 'order.new' || t === 'order.status') reload(); });
  return (
    <>
      <PageHead title="Orders" />
      <div className="row wrap-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}><div style={{ minWidth: 240 }}><Input label="Search number, name or email" value={q} onChange={(v) => { setQ(v); setPage(1); }} /></div><div style={{ width: 200 }}><Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled', 'disputed', 'partially_refunded', 'refunded']} placeholder="All" /></div></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Orders" rows={data?.orders ?? []} onRow={(r: any) => setOpen(r.id)} cols={[{ key: 'number', header: 'Order', render: (r: any) => <b>{r.number}</b> }, { key: 'placed_at', header: 'Placed', render: (r: any) => dateTime(r.placed_at) }, { key: 'contact_name', header: 'Customer', render: (r: any) => <span>{r.contact_name}<div className="tiny muted">{r.contact_email}</div></span> }, { key: 'vendors', header: 'Sellers', render: (r: any) => <span className="small">{r.vendors}</span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'payment_status', header: 'Payment', render: (r: any) => <Badge status={r.payment_status} /> }, { key: 'total', header: 'Total', align: 'right', render: (r: any) => money(r.total) }]} />}
      <Pager page={page} pages={data?.orders?.length === 30 ? page + 1 : page} onPage={setPage} />
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
export function AdminOrders() { return <Suspense><OrdersInner /></Suspense>; }

/* ---------------- dispatch ---------------- */
export function AdminDispatch() {
  const toast = useToast(); const [status, setStatus] = useState('active');
  const dels = useApi<any>(`/admin/deliveries${status === 'active' ? '?status=waiting_for_ready,searching,offered,assigned,at_pickup,picked_up,in_transit,unassigned' : status === 'done' ? '?status=delivered,cancelled,failed' : ''}`, [status]); const online = useApi<any>('/admin/drivers/online');
  const [open, setOpen] = useState<any>(null); const [pick, setPick] = useState('');
  useStream(['admin'], (t) => { if (t === 'delivery.status' || t === 'driver.availability') { dels.reload(); online.reload(); } });
  const show = async (id: string) => setOpen(await get(`/admin/deliveries/${id}`));
  const reassign = async (driverId: string | null) => { try { await post(`/admin/deliveries/${open.job.id}/reassign`, { driverId }); toast(driverId ? 'Driver assigned' : 'Sent back to dispatch'); setOpen(null); dels.reload(); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Dispatch" sub="Deliveries, driver offers and manual assignment." />
      <Tabs value={status} onChange={setStatus} tabs={[{ key: 'active', label: 'Active' }, { key: 'done', label: 'Finished' }, { key: 'all', label: 'All' }]} />
      <ErrorNote error={dels.error} retry={dels.reload} />
      <Table caption="Deliveries" rows={dels.data?.deliveries ?? []} onRow={(r: any) => show(r.id)} cols={[{ key: 'number', header: 'Order', render: (r: any) => <b>{r.number}</b> }, { key: 'vendor', header: 'Store' }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'driver', header: 'Driver', render: (r: any) => r.driver ?? <span className="muted">Unassigned</span> }, { key: 'distance_km', header: 'km', align: 'right' }, { key: 'customer_fee', header: 'Customer fee', align: 'right', render: (r: any) => money(r.customer_fee) }, { key: 'driver_pay', header: 'Driver pay', align: 'right', render: (r: any) => money(r.driver_pay) }, { key: 'dispatch_attempts', header: 'Attempts', align: 'right' }]} />
      {open && <Modal title={`Delivery ${open.job.number}`} onClose={() => setOpen(null)} wide footer={<><Btn variant="secondary" onClick={() => reassign(null)}>Return to dispatch</Btn><Btn variant="primary" disabled={!pick} onClick={() => reassign(pick)}>Assign selected driver</Btn></>}>
        <div className="stack"><KV items={[['Status', label(open.job.status)], ['Driver', open.job.driver ?? 'None'], ['Distance', `${open.job.distance_km} km`], ['Driver pay', money(open.job.driver_pay)], ['Customer fee', money(open.job.customer_fee)], ['Margin', money(open.job.platform_margin)]]} />
          <Select label="Assign to driver" value={pick} onChange={setPick} options={(online.data?.drivers ?? []).map((d: any) => ({ value: d.id, label: `${d.name} (${d.active_jobs} active)` }))} placeholder="Choose an online driver" />
          <h3>Offers</h3><Table caption="Offers" rows={open.offers} empty="No offers sent yet." cols={[{ key: 'driver', header: 'Driver' }, { key: 'status', header: 'Result', render: (r: any) => <Badge status={r.status} /> }, { key: 'est_pay', header: 'Pay', align: 'right', render: (r: any) => money(r.est_pay) }, { key: 'offered_at', header: 'Sent', render: (r: any) => time(r.offered_at) }]} />
          {open.issues.length > 0 && <><h3>Driver issues</h3>{open.issues.map((i: any) => <p key={i.id} className="alert">{label(i.kind)}: {i.notes}</p>)}</>}
          <h3>History</h3><ul className="small">{open.history.map((h: any) => <li key={h.id}>{dateTime(h.at)}: {label(h.to_status)}</li>)}</ul></div></Modal>}
    </>
  );
}
