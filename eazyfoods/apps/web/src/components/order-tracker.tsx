'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './providers';
import { RouteMap } from './route-map';
import { Badge, Btn, Confirm, Empty, ErrorNote, Icon, Modal, Select, Spinner, Stars, Textarea, useToast } from './ui';
import { api, get, post } from '@/lib/api';
import { dateTime, label, money, time } from '@/lib/format';
import { useStream } from '@/hooks/useApi';
import { t } from '@/lib/i18n';

function Messages({ suborderId, channel, title }: { suborderId: string; channel: string; title: string }) {
  const [msgs, setMsgs] = useState<any[]>([]); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const toast = useToast();
  const load = useCallback(() => get(`/suborders/${suborderId}/messages?channel=${channel}`).then((d) => setMsgs(d.messages ?? [])).catch(() => {}), [suborderId, channel]);
  useEffect(() => { load(); }, [load]);
  useStream([], (type) => { if (type === 'order.message') load(); });
  return (
    <details className="card pad"><summary className="bold" style={{ cursor: 'pointer' }}>{title}</summary>
      <div className="stack" style={{ marginTop: 10, '--gap': '8px' } as any} aria-live="polite">{msgs.length ? msgs.map((m) => <div key={m.id} className="small"><b>{m.sender_role === 'customer' ? 'You' : label(m.sender_role)}</b> <span className="muted">{time(m.created_at)}</span><div>{m.body}</div></div>) : <p className="muted small">No messages yet.</p>}</div>
      <form className="row" style={{ marginTop: 10, alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await post(`/suborders/${suborderId}/messages`, { channel, body }); setBody(''); load(); } catch (x: any) { toast(x.message, 'bad'); } finally { setBusy(false); } }}>
        <div className="grow"><label className="sr-only" htmlFor={`m-${channel}-${suborderId}`}>Message</label><input id={`m-${channel}-${suborderId}`} className="input" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="Write a message" /></div><Btn type="submit" busy={busy}>Send</Btn>
      </form>
    </details>
  );
}

function ReviewModal({ order, sub, onClose, onDone }: { order: any; sub: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(5); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const [driverRating, setDriverRating] = useState(0);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await post('/reviews', { suborderId: sub.id, subjectType: 'vendor', subjectId: sub.vendor.id, rating, body: body || undefined });
      if (driverRating && sub.delivery?.driver) await post('/reviews', { suborderId: sub.id, subjectType: 'driver', rating: driverRating }).catch(() => {});
      toast('Thank you for your review'); onDone(); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const Pick = ({ v, set, name }: { v: number; set: (n: number) => void; name: string }) => (<div role="radiogroup" aria-label={name} className="row" style={{ '--gap': '4px' } as any}>{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={v === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="icon-btn" style={{ color: n <= v ? 'var(--saffron)' : 'var(--line-strong)' }} onClick={() => set(n)}><Icon name="star" size={28} /></button>)}</div>);
  return (
    <Modal title={`Review ${sub.vendor.name}`} onClose={onClose} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={submit}>Submit review</Btn></>}>
      <div className="stack"><ErrorNote error={err} /><div><div className="label">How was the food and service?</div><Pick v={rating} set={setRating} name="Store rating" /></div>
        <Textarea label="Tell others about it" value={body} onChange={setBody} optional maxLength={2000} />
        {sub.delivery?.driver && <div><div className="label">Rate your driver {sub.delivery.driver.first_name} (optional)</div><Pick v={driverRating} set={setDriverRating} name="Driver rating" /></div>}
        <p className="hint">Reviews are shown with your first name and a verified purchase badge.</p></div>
    </Modal>
  );
}

function DisputeModal({ sub, onClose, onDone }: { sub: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState('missing_items'); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  return (
    <Modal title="Report a problem" onClose={onClose} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => { setBusy(true); try { await post(`/suborders/${sub.id}/dispute`, { category, reason }); toast('Your report was sent. We will reply in the app and by email.'); onDone(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Send report</Btn></>}>
      <div className="stack"><ErrorNote error={err} /><Select label="What went wrong?" value={category} onChange={setCategory} options={[{ value: 'missing_items', label: 'Items were missing' }, { value: 'incorrect_items', label: 'Wrong items' }, { value: 'damaged', label: 'Damaged or spoiled' }, { value: 'late_delivery', label: 'Very late' }, { value: 'other', label: 'Something else' }]} />
        <Textarea label="Describe the problem" value={reason} onChange={setReason} hint="At least a few words. Include item names if you can." required /></div>
    </Modal>
  );
}

export function OrderTracker({ id }: { id: string }) {
  const sp = useSearchParams(); const router = useRouter(); const { me, ready } = useAuth(); const toast = useToast();
  const [order, setOrder] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const [review, setReview] = useState<any>(null); const [dispute, setDispute] = useState<any>(null); const [cancel, setCancel] = useState<any>(null);
  const [live, setLive] = useState<Record<string, { lat: number; lng: number }>>({});
  const load = useCallback(() => get(`/orders/${id}`).then((d) => { setOrder(d.order); setErr(null); }).catch(setErr), [id]);
  useEffect(() => { if (ready && !me?.user) router.replace(`/login?next=/orders/${id}`); else if (ready) load(); }, [ready, me?.user, id, load, router]);
  useStream([`order:${id}`], (type, d) => {
    if (type === 'driver.location') setLive((l) => ({ ...l, [d.jobId]: { lat: d.lat, lng: d.lng } }));
    else if (['order.status', 'suborder.status', 'delivery.status'].includes(type)) load();
  }, !!me?.user);
  if (err) return <div className="wrap" style={{ padding: 40 }}><ErrorNote error={err} retry={load} /></div>;
  if (!order) return <div className="wrap center" style={{ padding: 60 }}><Spinner /></div>;
  const placed = sp.get('placed');
  return (
    <div className="wrap" style={{ maxWidth: 980 }}>
      {placed && <div className="alert ok" role="status" style={{ marginTop: 18 }}><Icon name="check" /><div><b>{t('checkout.ok')}</b> We emailed you a receipt. You can follow each part of your order below.</div></div>}
      <div className="row spread wrap-row" style={{ margin: '22px 0 8px' }}>
        <div><h1 style={{ margin: 0 }}>Order {order.number}</h1><div className="muted small">Placed {dateTime(order.placed_at)} · <Badge status={order.status} /> · Payment: <Badge status={order.payment?.status} /> {order.payment?.card && <span>({order.payment.card})</span>}</div></div>
        <div className="row"><Btn variant="secondary" onClick={async () => { try { const r = await post(`/orders/${id}/reorder`); toast(`${r.added} items added to your cart`); router.push('/cart'); } catch (e: any) { toast(e.message, 'bad'); } }}>{t('order.reorder')}</Btn></div>
      </div>
      {order.status === 'pending_payment' && <div className="alert warn">This order is waiting for payment. Items are held until {time(order.payment_deadline)}. <Link href="/checkout">Return to checkout</Link></div>}
      <div className="stack">
        {order.suborders.map((s: any) => {
          const del = s.delivery; const pos = live[s.id] ?? del?.location ?? null;
          const done = ['delivered', 'completed', 'partially_refunded', 'refunded'].includes(s.status);
          return (
            <section key={s.id} className="card pad" aria-labelledby={`s-${s.id}`}>
              <div className="row spread wrap-row"><div className="row"><img src={s.vendor.logo_url ?? '/img/brand/logo-default.svg'} alt="" className="logo-sm" /><div><h2 id={`s-${s.id}`} style={{ margin: 0, fontSize: '1.2rem' }}><Link href={`/${s.vendor.seller_type === 'chef' ? 'chefs' : 'stores'}/${s.vendor.slug}`}>{s.vendor.name}</Link></h2><div className="small muted">{s.number} · {s.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}{s.promisedAt && !done && <> · expected {dateTime(s.promisedAt)}</>}</div></div></div><div><Badge status={s.status}>{s.statusLabel}</Badge></div></div>
              <div className="grid cols-2" style={{ marginTop: 16, '--gap': '24px', alignItems: 'start' } as any}>
                <div>
                  <h3>Progress</h3>
                  <ol className="timeline" aria-label={`Progress for ${s.vendor.name}`}>{s.timeline.filter((x: any) => s.fulfillment === 'pickup' ? !['driver', 'pickedup', 'approaching'].includes(x.key) : true).map((x: any) => <li key={x.key} className={x.done ? 'done' : ''}><span>{x.label}{x.done ? <span className="sr-only"> (done)</span> : <span className="sr-only"> (not yet)</span>}</span><span className="small">{x.at ? time(x.at) : ''}</span></li>)}</ol>
                  {s.cancelReason && <p className="alert bad">Cancelled: {s.cancelReason}</p>}
                </div>
                <div className="stack">
                  {s.fulfillment === 'pickup' && s.pickupCode && !done && <div><div className="label">Show this code at pickup</div><div className="pin-box">{s.pickupCode}</div></div>}
                  {del && !done && s.fulfillment !== 'pickup' && (<>
                    <RouteMap pickup={del.pickup} dropoff={del.dropoff} driver={pos} />
                    <p className="small" aria-live="polite">{del.driver ? <>Your driver <b>{del.driver.first_name}</b> ({del.driver.vehicle}){del.driver.rating ? <> · <Stars value={del.driver.rating} /></> : null}. </> : 'A driver will be assigned when your food is nearly ready. '}{del.estimatedMinutes != null && <>About {del.estimatedMinutes} minutes away.</>}</p>
                    {del.pin && <div><div className="label">{t('order.pin')}</div><div className="pin-box">{del.pin}</div><p className="hint">{t('order.pinHelp')}</p></div>}
                  </>)}
                  {del?.proof && <p className="small alert ok">Delivered {del.proof.delivered_at ? dateTime(del.proof.delivered_at) : ''}. Proof of delivery: {label(del.proof.method ?? 'recorded')}.</p>}
                  <div><h3>Items</h3>{s.items.map((i: any) => <div key={i.id} className="row spread small" style={{ padding: '4px 0' }}><span>{i.quantity} × {i.name}{i.variant_name ? ` (${i.variant_name})` : ''}{i.refunded_qty > 0 && <Badge tone="warn"> {i.refunded_qty} refunded</Badge>}</span><b>{money(i.line_subtotal)}</b></div>)}
                    <div className="row spread small muted"><span>Tax, delivery, fees</span><span>{money(s.totals.tax + s.totals.delivery + s.totals.service)}</span></div>
                    <div className="row spread bold"><span>Seller total</span><span>{money(s.totals.total)}</span></div></div>
                </div>
              </div>
              <div className="row wrap-row" style={{ marginTop: 14 }}>
                {s.cancellable && <Btn variant="danger-outline" size="sm" onClick={() => setCancel(s)}>{t('order.cancel')}</Btn>}
                {s.canReview && !s.reviewed.includes(`vendor:${s.vendor.id}`) && <Btn variant="secondary" size="sm" onClick={() => setReview(s)}>{t('order.review')}</Btn>}
                {s.reviewed.includes(`vendor:${s.vendor.id}`) && <Badge tone="ok">Reviewed</Badge>}
                {s.canDispute && <Btn variant="secondary" size="sm" onClick={() => setDispute(s)}>{t('order.report')}</Btn>}
                <Link className="btn sm ghost" href={`/account/support?order=${order.id}`}>{t('order.support')}</Link>
              </div>
              {s.dispute && <p className="alert" style={{ marginTop: 10 }}>Problem report {label(s.dispute.status)}. {s.dispute.resolution_note ?? ''}</p>}
              <div className="stack" style={{ marginTop: 12, '--gap': '8px' } as any}>
                <Messages suborderId={s.id} channel="customer_vendor" title={`Message ${s.vendor.name}`} />
                {del?.driver && !done && <Messages suborderId={s.id} channel="customer_driver" title={`Message your driver, ${del.driver.first_name}`} />}
              </div>
            </section>
          );
        })}
        <section className="card pad" aria-labelledby="tot"><h2 id="tot" style={{ fontSize: '1.15rem' }}>Payment summary</h2>
          <dl className="summary" style={{ position: 'static' }}><dl><div><dt>Items</dt><dd>{money(order.totals.subtotal)}</dd></div>{order.totals.discount > 0 && <div><dt>Discounts</dt><dd>−{money(order.totals.discount)}</dd></div>}<div><dt>Delivery</dt><dd>{money(order.totals.delivery)}</dd></div><div><dt>Service fee</dt><dd>{money(order.totals.service)}</dd></div><div><dt>Tax</dt><dd>{money(order.totals.tax)}</dd></div>{order.totals.tip > 0 && <div><dt>Tip</dt><dd>{money(order.totals.tip)}</dd></div>}<div className="total"><dt>Total charged</dt><dd>{money(order.totals.charged ?? order.totals.total)}</dd></div></dl></dl>
          {order.refunds?.length > 0 && <><h3>Refunds</h3>{order.refunds.map((r: any) => <div key={r.id} className="row spread small"><span>{r.reason ?? 'Refund'} · {dateTime(r.created_at)}</span><b>−{money(r.amount)}</b></div>)}</>}
          {order.address && <p className="small muted">Delivering to {order.address.line1}, {order.address.city} {order.address.postal_code}</p>}
        </section>
      </div>
      {review && <ReviewModal order={order} sub={review} onClose={() => setReview(null)} onDone={load} />}
      {dispute && <DisputeModal sub={dispute} onClose={() => setDispute(null)} onDone={load} />}
      {cancel && <Confirm title={`Cancel ${cancel.vendor.name}?`} danger confirmLabel="Cancel this order" onClose={() => setCancel(null)} onConfirm={async () => { await post(`/orders/${id}/cancel`, { suborderId: cancel.id }); toast('Order cancelled. Any payment is refunded to your card.'); await load(); }}>
        <p>Your payment for this part of the order will be refunded to the original card. Refunds usually appear in a few business days.</p></Confirm>}
    </div>
  );
}
void api; void Empty;
