'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { LoginForm } from '../auth-forms';
import { useAuth } from '../providers';
import { DocumentUploader } from '../vendor/onboarding';
import { Badge, Btn, ErrorNote, Icon, Input, Modal, Select, Spinner, Table, Textarea, useToast } from '../ui';
import { RouteMap } from '../route-map';
import { api, get, post } from '@/lib/api';
import { useApi, useStream } from '@/hooks/useApi';
import { dateTime, label, money, time } from '@/lib/format';

const area = (a: any) => (typeof a === 'string' ? a : a?.label ?? a?.area ?? a?.name ?? 'Nearby');
const directions = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

function Countdown({ to }: { to: string }) {
  const [s, setS] = useState(Math.max(0, Math.round((new Date(to).getTime() - Date.now()) / 1000)));
  useEffect(() => { const t = setInterval(() => setS(Math.max(0, Math.round((new Date(to).getTime() - Date.now()) / 1000))), 500); return () => clearInterval(t); }, [to]);
  return <span role="timer" aria-live="off" className="mono bold">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

function Chat({ jobId }: { jobId: string }) {
  const [ch, setCh] = useState('customer_driver'); const [msgs, setMsgs] = useState<any[]>([]); const [body, setBody] = useState(''); const toast = useToast();
  const load = useCallback(() => get(`/drivers/me/jobs/${jobId}/messages?channel=${ch}`).then((d) => setMsgs(d.messages ?? [])).catch(() => {}), [jobId, ch]);
  useEffect(() => { load(); }, [load]);
  useStream([], (t) => { if (t === 'order.message') load(); });
  return (
    <details className="card pad"><summary className="bold" style={{ cursor: 'pointer' }}>Messages (no phone numbers are shared)</summary>
      <div className="row" style={{ margin: '8px 0' }}><button className={`chip ${ch === 'customer_driver' ? 'on' : ''}`} onClick={() => setCh('customer_driver')}>Customer</button><button className={`chip ${ch === 'vendor_driver' ? 'on' : ''}`} onClick={() => setCh('vendor_driver')}>Store</button></div>
      <div className="stack small" style={{ '--gap': '6px' } as any} aria-live="polite">{msgs.map((m) => <div key={m.id}><b>{m.sender_role === 'driver' ? 'You' : label(m.sender_role)}:</b> {m.body}</div>)}{!msgs.length && <span className="muted">No messages.</span>}</div>
      <form className="row" style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; try { await post(`/drivers/me/jobs/${jobId}/messages`, { channel: ch, body }); setBody(''); load(); } catch (x: any) { toast(x.message, 'bad'); } }}><label className="sr-only" htmlFor="dchat">Message</label><input id="dchat" className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" maxLength={1000} /><Btn type="submit">Send</Btn></form>
    </details>
  );
}

function Active({ job, onChange, pos }: { job: any; onChange: () => void; pos: { lat: number; lng: number } | null }) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [pin, setPin] = useState(''); const [issue, setIssue] = useState(false); const [kind, setKind] = useState('customer_unavailable'); const [notes, setNotes] = useState('');
  const step = async (path: string, body: any = {}, msg?: string) => { setBusy(true); try { await post(`/drivers/me/jobs/${job.id}/${path}`, body); if (msg) toast(msg); onChange(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const st = job.status; const toStore = ['assigned', 'at_pickup'].includes(st); const target = toStore ? job.pickup : job.dropoff;
  return (
    <section className="card pad stack" aria-label={`Delivery ${job.orderNumber}`}>
      <div className="row spread"><div><b>{job.orderNumber}</b><div className="small muted">{job.store}</div></div><Badge status={st} /></div>
      <RouteMap pickup={job.pickup} dropoff={job.dropoff} driver={pos} label="Route between store and customer" />
      <div className="grid cols-2" style={{ '--gap': '10px' } as any}><div className="card pad" style={{ padding: 10 }}><div className="tiny muted">Pay</div><b>{money(job.pay)}</b>{job.tip > 0 && <div className="tiny">+ {money(job.tip)} tip</div>}</div><div className="card pad" style={{ padding: 10 }}><div className="tiny muted">Distance</div><b>{job.distanceKm} km</b><div className="tiny">about {job.estMinutes} min</div></div></div>
      {job.needsCold && <Badge tone="info">Keep cold</Badge>}
      <div><h3 style={{ marginBottom: 4 }}>{toStore ? 'Pick up from' : 'Deliver to'}</h3><b>{target?.name}</b><div className="small">{target?.address}</div>{!toStore && job.dropoff?.instructions && <div className="alert" style={{ marginTop: 6 }}>{job.dropoff.instructions}</div>}
        {target?.lat != null && <a className="btn secondary sm" style={{ marginTop: 8 }} href={directions(target.lat, target.lng)} target="_blank" rel="noopener noreferrer">Open directions</a>}</div>
      <div className="small"><b>Items:</b> {job.items}</div>
      {st === 'assigned' && <Btn variant="primary" size="lg" block busy={busy} onClick={() => step('arrived', {}, 'Store notified')}>I have arrived at the store</Btn>}
      {st === 'at_pickup' && <Btn variant="primary" size="lg" block busy={busy} onClick={() => step('pickup', {}, 'Pickup confirmed')}>I have the order</Btn>}
      {st === 'picked_up' && <Btn variant="primary" size="lg" block busy={busy} onClick={() => step('start', {}, 'Heading to the customer')}>Start delivery</Btn>}
      {st === 'in_transit' && (<form className="stack" onSubmit={(e) => { e.preventDefault(); step('deliver', { pin: pin || undefined, lat: pos?.lat, lng: pos?.lng }, 'Delivered. Nice work.'); }}>
        {job.proofRequired?.includes('pin') && <Input label="Customer delivery PIN" value={pin} onChange={setPin} inputMode="numeric" maxLength={8} hint="Ask the customer for the 4 digit code shown in their app." />}
        <Btn type="submit" variant="leaf" size="lg" block busy={busy}>Confirm delivery</Btn></form>)}
      <Btn variant="ghost" onClick={() => setIssue(true)}>Report a problem</Btn>
      <Chat jobId={job.id} />
      {issue && <Modal title="Report a problem" onClose={() => setIssue(false)} footer={<><Btn variant="secondary" onClick={() => setIssue(false)}>Cancel</Btn><Btn variant="primary" onClick={async () => { await step('issue', { kind, notes: notes || undefined }, 'Support has been told'); setIssue(false); }}>Send</Btn></>}>
        <div className="stack"><Select label="What happened?" value={kind} onChange={setKind} options={['vendor_not_ready', 'vendor_closed', 'customer_unavailable', 'incorrect_address', 'damaged_order', 'vehicle_problem', 'accident', 'other']} /><Textarea label="Details" value={notes} onChange={setNotes} optional /></div></Modal>}
    </section>
  );
}

function Onboarding({ me, reload }: { me: any; reload: () => void }) {
  const toast = useToast(); const [v, setV] = useState({ vehicle_type: 'car', make: '', model: '', plate: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const p = me.profile;
  return (
    <div className="stack">
      <div className="alert warn"><div><b>Your driver account is {label(p.verification_status)}.</b> {p.verification_note} Upload your documents and submit for review to start receiving offers.</div></div>
      <section className="card pad stack"><h2 style={{ fontSize: '1.1rem' }}>Documents</h2>
        <Table caption="Documents" rows={me.documents} empty="Nothing uploaded yet." cols={[{ key: 'doc_type', header: 'Document', render: (r: any) => label(r.doc_type) }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }]} />
        <DocumentUploader owner="driver" requirements={me.requirements} onDone={reload} post={(b) => post('/drivers/me/documents', b)} /></section>
      {!me.vehicles.length && <section className="card pad stack"><h2 style={{ fontSize: '1.1rem' }}>Vehicle</h2><ErrorNote error={err} /><Select label="Type" value={v.vehicle_type} onChange={(x) => setV({ ...v, vehicle_type: x })} options={['car', 'van', 'scooter', 'ebike', 'bike']} /><Input label="Make" value={v.make} onChange={(x) => setV({ ...v, make: x })} optional /><Input label="Model" value={v.model} onChange={(x) => setV({ ...v, model: x })} optional /><Input label="Plate" value={v.plate} onChange={(x) => setV({ ...v, plate: x })} optional /><Btn variant="secondary" onClick={async () => { try { await post('/drivers/me/vehicles', v); reload(); } catch (e) { setErr(e); } }}>Save vehicle</Btn></section>}
      <Btn variant="primary" size="lg" block busy={busy} disabled={!['draft', 'rejected', 'needs_changes'].includes(p.verification_status)} onClick={async () => { setBusy(true); try { await post('/drivers/me/submit'); toast('Submitted for review'); reload(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>Submit for review</Btn>
    </div>
  );
}

function Earnings() {
  const { data, error } = useApi<any>('/drivers/me/earnings'); const hist = useApi<any>('/drivers/me/jobs?scope=history&limit=20');
  if (!data) return error ? <ErrorNote error={error} /> : <Spinner />;
  const e = data.earnings;
  return (
    <div className="stack">
      <div className="grid cols-2" style={{ '--gap': '10px' } as any}>{[['Today', e.today], ['This week', e.week], ['This month', e.month], ['Pending payout', e.pending]].map(([l, v]) => <div key={String(l)} className="card stat"><div className="l">{l}</div><div className="v">{money(v as number)}</div></div>)}</div>
      <div className="card pad small">{e.deliveries} deliveries · {money(e.tips)} in tips · rating {data.performance.rating} ({data.performance.ratingCount}) · acceptance {data.performance.acceptanceRate}% · {data.performance.totalKm} km</div>
      <h2 style={{ fontSize: '1.1rem' }}>Recent deliveries</h2>
      <div className="stack" style={{ '--gap': '8px' } as any}>{data.recent.map((r: any) => (
        <details key={r.id} className="card pad"><summary className="row spread" style={{ cursor: 'pointer' }}><span><b>{r.number ?? label(r.kind)}</b> <span className="small muted">{dateTime(r.created_at)}</span></span><b>{money(r.total)}</b></summary>
          <dl className="facts small" style={{ marginTop: 8 }}>{[['Base', r.base], ['Distance', r.distance_pay], ['Time', r.time_pay], ['Peak', r.peak_bonus], ['Surge', r.surge], ['Guarantee top-up', r.guarantee_topup], ['Multi-order bonus', r.multi_order_bonus], ['Promotion', r.promo_bonus], ['Tip', r.tip]].filter(([, v]) => Number(v) > 0).map(([k, v]) => <div key={String(k)}><dt>{k}</dt><dd>{money(v as number)}</dd></div>)}</dl></details>))}</div>
      {data.payouts?.length > 0 && <><h2 style={{ fontSize: '1.1rem' }}>Payouts</h2>{data.payouts.map((p: any) => <div key={p.id} className="row spread card pad small"><span>{dateTime(p.created_at)} <Badge status={p.status} /></span><b>{money(p.net)}</b></div>)}</>}
      <span className="sr-only">{hist.data?.jobs?.length}</span>
    </div>
  );
}

export function DriverApp() {
  const { me, ready, logout } = useAuth(); const toast = useToast();
  const prof = useApi<any>(me?.user && me.driver ? '/drivers/me' : null); const offers = useApi<any>(prof.data?.profile?.verification_status === 'approved' ? '/drivers/me/offers' : null); const jobs = useApi<any>(prof.data?.profile?.verification_status === 'approved' ? '/drivers/me/jobs' : null);
  const [tab, setTab] = useState('work'); const [online, setOnline] = useState(false); const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null); const [geoMsg, setGeoMsg] = useState('');
  const watch = useRef<number | null>(null); const lastSent = useRef(0);
  useEffect(() => { if (prof.data) setOnline(prof.data.profile.availability === 'online' || prof.data.profile.availability === 'busy'); }, [prof.data]);
  const refresh = useCallback(() => { offers.reload(); jobs.reload(); prof.reload(); }, [offers, jobs, prof]);
  useStream([me?.user ? `driver:${me.user.id}` : ''].filter(Boolean), (t) => { if (['offer', 'job.assigned', 'job.cancelled', 'job.completed'].includes(t)) { offers.reload(); jobs.reload(); if (t === 'offer') toast('New delivery offer'); } }, !!me?.driver);
  useEffect(() => { if (!online || !offers.data) return; const t = setInterval(() => { offers.reload(); jobs.reload(); }, 20000); return () => clearInterval(t); }, [online, offers.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Share the real device location while online. Nothing is sent unless the browser grants permission.
  useEffect(() => {
    if (!online || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    watch.current = navigator.geolocation.watchPosition((p) => {
      const l = { lat: p.coords.latitude, lng: p.coords.longitude }; setPos(l); setGeoMsg('');
      if (Date.now() - lastSent.current > 10000) { lastSent.current = Date.now(); post('/drivers/me/location', { ...l, heading: p.coords.heading ?? undefined, speed_kmh: p.coords.speed != null ? p.coords.speed * 3.6 : undefined }).catch(() => {}); }
    }, () => setGeoMsg('Location is off, so the customer cannot see you on the route. Allow location in your browser.'), { enableHighAccuracy: true, maximumAge: 5000 });
    return () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); };
  }, [online]);

  if (!ready) return <div className="center" style={{ padding: 80 }}><Spinner /></div>;
  if (!me?.user) return <div className="driver-app" style={{ padding: 20 }}><p className="eyebrow">Drivers</p><h1>EAZyfoods Driver</h1><div className="card pad"><Suspense><LoginForm portal="Driver app" /></Suspense></div><p className="small">New driver? <Link href="/sell#drivers">Apply to drive</Link>.</p></div>;
  if (!me.driver) return <div className="driver-app" style={{ padding: 20 }}><h1>No driver profile</h1><p>This account is not registered as a driver. <Link href="/sell#drivers">Apply to drive</Link>.</p><Btn onClick={logout}>Sign out</Btn></div>;
  const p = prof.data?.profile; const approved = p?.verification_status === 'approved';
  const active = jobs.data?.jobs ?? []; const offerList = offers.data?.offers ?? [];
  return (
    <div className="driver-app">
      <header className="bar"><b>EAZyfoods Driver</b><span className="small">{me.user.full_name}</span></header>
      <div style={{ padding: 16, flex: 1, paddingBottom: 90 }} className="stack">
        {!prof.data ? <Spinner /> : !approved ? <Onboarding me={prof.data} reload={prof.reload} /> : (<>
          <div className={`big-switch ${online ? 'on' : ''}`}><div><b style={{ fontSize: '1.1rem' }}>{online ? 'You are online' : 'You are offline'}</b><div className="small muted">{online ? 'You can receive offers.' : 'Go online to receive offers.'}</div></div>
            <label className="check"><span className="sr-only">Online</span><input type="checkbox" role="switch" checked={online} style={{ width: 28, height: 28 }} onChange={async (e) => { const v = e.target.checked; setOnline(v); try { await post('/drivers/me/availability', { online: v }); refresh(); } catch (x: any) { setOnline(!v); toast(x.message, 'bad'); } }} /></label></div>
          {geoMsg && <p className="alert warn" role="status">{geoMsg}</p>}
          {tab === 'work' && (<>
            {active.map((j: any) => <Active key={j.id} job={j} onChange={refresh} pos={pos} />)}
            {online && offerList.map((o: any) => (
              <section key={o.offerId} className="offer" aria-label="Delivery offer">
                <div className="row spread"><span className="pay">{money(o.estPay)}</span><span className="small">Expires in <Countdown to={o.expiresAt} /></span></div>
                <div className="small"><b>{o.job.store}</b> · {o.job.itemCount} items · {o.job.distanceKm} km · about {o.job.estMinutes} min{o.isBatch && <> · <Badge tone="info">Batch</Badge></>}</div>
                <div className="small">Pickup near {area(o.job.pickupArea)} · {o.pickupDistanceKm} km away<br />Drop off near {area(o.job.dropoffArea)}</div>
                {o.job.needsCold && <Badge tone="info">Keep cold</Badge>}
                <div className="row"><Btn variant="secondary" className="grow" onClick={async () => { await post(`/drivers/me/offers/${o.job.id}/reject`); offers.reload(); }}>Decline</Btn><Btn variant="leaf" className="grow" onClick={async () => { try { await post(`/drivers/me/offers/${o.job.id}/accept`); toast('Accepted'); refresh(); } catch (x: any) { toast(x.message, 'bad'); offers.reload(); } }}>Accept</Btn></div>
              </section>))}
            {!active.length && !offerList.length && <div className="empty"><h3>{online ? 'Waiting for offers' : 'Go online to start'}</h3><p>{online ? 'Offers appear here the moment a store has an order ready near you.' : 'Switch on the toggle above when you are ready to deliver.'}</p></div>}
          </>)}
          {tab === 'earnings' && <Earnings />}
          {tab === 'account' && (<div className="stack"><section className="card pad"><h2 style={{ fontSize: '1.1rem' }}>{p.legal_name}</h2><div className="small">Status <Badge status={p.verification_status} /> · rating {p.rating_avg ?? 'n/a'} · {p.jobs_completed} deliveries</div><div className="small">{prof.data.vehicles.map((v: any) => `${label(v.vehicle_type)} ${v.make ?? ''} ${v.model ?? ''} ${v.plate ?? ''}`).join(', ')}</div></section>
            <section className="card pad"><h3>Documents</h3><Table caption="Documents" rows={prof.data.documents} cols={[{ key: 'doc_type', header: 'Document', render: (r: any) => label(r.doc_type) }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'expiry_date', header: 'Expires', render: (r: any) => (r.expiry_date ? r.expiry_date.slice(0, 10) : '') }]} /></section>
            <Btn variant="secondary" onClick={logout}>Sign out</Btn></div>)}
        </>)}
      </div>
      {approved && <nav className="driver-nav" aria-label="Driver navigation">{[['work', 'Deliveries', 'truck'], ['earnings', 'Earnings', 'bag'], ['account', 'Account', 'user']].map(([k, l, i]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined} style={{ border: 0, background: 'none' }} className={tab === k ? 'on' : ''}><Icon name={i} size={22} />{l}</button>)}</nav>}
    </div>
  );
}
void api; void time;
