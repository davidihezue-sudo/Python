'use client';
import { useEffect, useRef, useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Confirm, ErrorNote, Icon, Input, Modal, Spinner, Tabs, Textarea, useToast } from '../ui';
import { get, post } from '@/lib/api';
import { useApi, useStream } from '@/hooks/useApi';
import { dateTime, label, money, time } from '@/lib/format';

const COLS: [string, string][] = [['new', 'New'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready']];

function beep() {
  try { const c = new (window.AudioContext || (window as any).webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); setTimeout(() => { o.stop(); c.close(); }, 250); } catch { /* sound is optional */ }
}

function Ticket({ order, vendor }: { order: any; vendor: string }) {
  return (
    <div className="print-only print-area" style={{ fontFamily: 'monospace', width: '80mm', padding: 8, color: '#000' }}>
      <h2 style={{ margin: 0 }}>{vendor}</h2><div>Order {order.number}</div><div>{dateTime(order.placed_at)}</div><div>{order.fulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY'} · {order.customer.first_name}</div>
      {order.requested_for && <div><b>For: {dateTime(order.requested_for)}</b></div>}<hr />
      {order.items.map((i: any) => <div key={i.id} style={{ margin: '4px 0' }}><b>{i.quantity} x {i.name}</b> {i.variant_name && `(${i.variant_name})`}{i.note && <div>Note: {i.note}</div>}</div>)}
      {order.customer.note && <><hr /><div>Customer note: {order.customer.note}</div></>}
    </div>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { vendorId, membership } = useVendor(); const toast = useToast();
  const [o, setO] = useState<any>(null); const [err, setErr] = useState<any>(null); const [code, setCode] = useState(''); const [reason, setReason] = useState(''); const [prep, setPrep] = useState(''); const [mode, setMode] = useState<null | 'reject' | 'cancel'>(null); const [busy, setBusy] = useState(false);
  const load = () => get(`/vendors/${vendorId}/orders/${id}`).then((d) => { setO(d.order); setPrep(String(d.order.prep_minutes)); }).catch(setErr);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (path: string, body: any = {}, msg?: string) => { setBusy(true); try { await post(`/vendors/${vendorId}/orders/${id}/${path}`, body); if (msg) toast(msg); await load(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const st = o?.status;
  return (
    <Modal title={o ? `Order ${o.number}` : 'Order'} onClose={onClose} wide footer={o && <div className="no-print row wrap-row" style={{ width: '100%', justifyContent: 'space-between' }}>
      <Btn variant="secondary" onClick={() => window.print()}><Icon name="print" size={16} /> Print ticket</Btn>
      <div className="row wrap-row">
        {st === 'confirmed' && <><Btn variant="danger-outline" onClick={() => setMode('reject')}>Reject</Btn><Btn variant="primary" busy={busy} onClick={() => act('accept', { prepMinutes: Number(prep) || undefined }, 'Order accepted')}>Accept order</Btn></>}
        {st === 'vendor_accepted' && <Btn variant="primary" busy={busy} onClick={() => act('prepare', {}, 'Marked as preparing')}>Start preparing</Btn>}
        {st === 'preparing' && <Btn variant="primary" busy={busy} onClick={() => act('ready', {}, 'Marked ready')}>Mark ready</Btn>}
        {['vendor_accepted', 'preparing'].includes(st) && <Btn variant="danger-outline" onClick={() => setMode('cancel')}>Cancel order</Btn>}
      </div></div>}>
      <ErrorNote error={err} />
      {!o ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={st} /><Badge>{o.fulfillment === 'pickup' ? 'Customer pickup' : o.fulfillment === 'delivery_vendor' ? 'Your own delivery' : 'Platform driver'}</Badge>{o.requested_for && <Badge tone="warn">Scheduled {dateTime(o.requested_for)}</Badge>}<span className="small muted">Placed {dateTime(o.placed_at)}</span></div>
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div><h3>Items</h3>{o.items.map((i: any) => <div key={i.id} className="row spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><span><b>{i.quantity} ×</b> {i.name}{i.variant_name ? ` (${i.variant_name})` : ''}{i.note && <div className="small muted">Note: {i.note}</div>}</span><span>{money(i.line_subtotal)}</span></div>)}
            <div className="row spread small" style={{ marginTop: 8 }}><span>Commission</span><span>−{money(o.totals.commission)}</span></div><div className="row spread bold"><span>You earn</span><span>{money(o.totals.net)}</span></div></div>
          <div><h3>Customer</h3><p style={{ margin: 0 }}>{o.customer.first_name} · {o.customer.area}</p>{o.customer.note && <p className="alert">Note: {o.customer.note}</p>}
            {o.driver && <><h3>Driver</h3><p style={{ margin: 0 }}>{o.driver.first_name} ({o.driver.vehicle}) {o.driver.status && <Badge status={o.driver.status} />}</p></>}
            {st === 'confirmed' && <Input label="Preparation time (minutes)" type="number" min={1} value={prep} onChange={setPrep} hint="Tell the customer how long this will take." />}
            {o.pickup_code_required && ['ready_for_pickup', 'driver_assigned', 'driver_arriving'].includes(st) && o.fulfillment === 'pickup' && <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); act('collect', { code }, 'Pickup confirmed'); }}><div className="grow"><Input label="Customer pickup code" value={code} onChange={setCode} maxLength={8} /></div><Btn type="submit" busy={busy}>Hand over</Btn></form>}
            {o.fulfillment === 'delivery_vendor' && ['ready_for_pickup', 'picked_up', 'in_transit'].includes(st) && <div className="row" style={{ marginTop: 8 }}>{st === 'ready_for_pickup' && <Btn onClick={() => act('delivery', { step: 'out' }, 'Out for delivery')}>Out for delivery</Btn>}{['picked_up', 'in_transit'].includes(st) && <Btn variant="leaf" onClick={() => act('delivery', { step: 'delivered' }, 'Marked delivered')}>Mark delivered</Btn>}</div>}
          </div>
        </div>
        <Ticket order={o} vendor={membership.trading_name} />
      </div>)}
      {mode && <Modal title={mode === 'reject' ? 'Reject this order?' : 'Cancel this order?'} onClose={() => setMode(null)} footer={<><Btn variant="secondary" onClick={() => setMode(null)}>Back</Btn><Btn variant="danger" disabled={reason.trim().length < 2} busy={busy} onClick={async () => { await act(mode, { reason }, 'Order updated'); setMode(null); }}>Confirm</Btn></>}><Textarea label="Reason shown to the customer" value={reason} onChange={setReason} required /><p className="hint">The customer is refunded in full. Frequent cancellations lower your search ranking.</p></Modal>}
    </Modal>
  );
}

export function VendorOrders() {
  const { vendorId, chef } = useVendor(); const toast = useToast();
  const [tab, setTab] = useState('board'); const [sound, setSound] = useState(true); const soundRef = useRef(true); soundRef.current = sound;
  const [open, setOpen] = useState<string | null>(null);
  const cols = COLS.map(([k]) => useApi<any>(`/vendors/${vendorId}/orders?group=${k}&limit=50`));
  const hist = useApi<any>(tab === 'history' ? `/vendors/${vendorId}/orders?group=completed&limit=50` : null);
  const canc = useApi<any>(tab === 'history' ? `/vendors/${vendorId}/orders?group=cancelled&limit=20` : null);
  const reloadAll = () => cols.forEach((c) => c.reload());
  useStream([`vendor:${vendorId}`], (t, d) => { if (t === 'order.new') { toast(`New order ${d.number}`); if (soundRef.current) beep(); } if (t === 'order.new' || t === 'suborder.status') reloadAll(); });
  return (
    <>
      <PageHead title="Orders" sub={chef ? 'Accept, cook and hand over. Print kitchen tickets for each order.' : 'Accept, prepare and hand over. New orders appear here instantly.'} actions={<label className="check"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /><span>Sound for new orders</span></label>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'board', label: 'Live board' }, { key: 'history', label: 'Completed and cancelled' }]} />
      {tab === 'board' ? (
        <div className="kanban">{COLS.map(([k, l], i) => (
          <section key={k} className="col" aria-label={l}><h2 style={{ fontSize: '1rem', margin: '2px 4px' }}>{l} <Badge>{cols[i].data?.orders.length ?? 0}</Badge></h2>
            {cols[i].data?.orders.map((r: any) => (
              <button key={r.id} className={`card ticket ${k === 'new' ? 'new' : ''}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(r.id)}>
                <div className="row spread"><b>{r.number}</b><span className="small muted">{time(r.created_at)}</span></div>
                <div className="small">{r.summary}</div>
                <div className="row spread small"><span>{r.customer_first_name} · {r.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'}</span><b>{money(r.vendor_net)}</b></div>
                {r.requested_for && <Badge tone="warn">Scheduled {dateTime(r.requested_for)}</Badge>}
              </button>))}
            {cols[i].data && !cols[i].data.orders.length && <p className="muted small" style={{ padding: 8 }}>Nothing here.</p>}
          </section>))}</div>
      ) : (<div className="stack">{[...(hist.data?.orders ?? []), ...(canc.data?.orders ?? [])].map((r: any) => <button key={r.id} className="card pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(r.id)}><div className="row spread"><span><b>{r.number}</b> <Badge status={r.status} /> <span className="small muted">{dateTime(r.created_at)}</span></span><b>{money(r.vendor_net)}</b></div><div className="small muted">{r.summary}</div></button>)}</div>)}
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </>
  );
}
void label; void Confirm;
