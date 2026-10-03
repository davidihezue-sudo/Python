'use client';
import { useEffect, useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Check, ErrorNote, Input, Select, Spinner, Table, Tabs, Textarea, useToast } from '../ui';
import { del, patch, post, put, upload } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { label } from '@/lib/format';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function VendorSettings() {
  const { vendorId, chef } = useVendor(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/vendors/${vendorId}/manage`);
  const [tab, setTab] = useState('profile'); const [v, setV] = useState<any>(null); const [hours, setHours] = useState<any[]>([]); const [c, setC] = useState<any>(null);
  const [hol, setHol] = useState({ day: '', note: '' }); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  useEffect(() => {
    if (!data) return;
    const x = data.vendor; setV({ ...x, cuisines: (x.cuisines ?? []).join(', '), description: x.description ?? '', website: x.website ?? '', min_order: x.min_order ?? 0 });
    setHours(Array.from({ length: 7 }, (_, i) => data.hours.find((h: any) => h.weekday === i) ?? { weekday: i, opens: '09:00', closes: '18:00', is_closed: true }));
    if (data.chef) setC({ ...data.chef, specialties: (data.chef.specialties ?? []).join(', ') });
  }, [data]);
  if (!v) return error ? <ErrorNote error={error} retry={reload} /> : <Spinner />;
  const sv = (k: string) => (x: any) => setV((o: any) => ({ ...o, [k]: x }));
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); setErr(null); try { await fn(); toast(ok); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const pic = async (k: 'logo_url' | 'cover_url', f?: File | null) => { if (!f) return; try { const r = await upload(f, k === 'logo_url' ? 'logo' : 'cover'); sv(k)(r.url); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Profile and hours" sub="What customers see, when you are open, and how you receive orders." actions={<label className="check"><input type="checkbox" checked={!!v.accepting_orders} onChange={(e) => { sv('accepting_orders')(e.target.checked); run(() => patch(`/vendors/${vendorId}/manage`, { accepting_orders: e.target.checked }), e.target.checked ? 'You are accepting orders' : 'Orders paused'); }} /><span><b>Accepting orders</b></span></label>} />
      <ErrorNote error={err} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'profile', label: 'Profile' }, { key: 'hours', label: 'Opening hours' }, { key: 'fulfil', label: 'Orders and delivery' }, ...(chef ? [{ key: 'chef', label: 'Chef profile' }] : [])]} />
      {tab === 'profile' && <div className="card pad"><div className="form-grid">
        <Input label="Trading name" value={v.trading_name} onChange={sv('trading_name')} /><Input label="Legal name" value={v.legal_name} onChange={sv('legal_name')} />
        <Textarea label="Description" value={v.description} onChange={sv('description')} full /><Input label="Email" type="email" value={v.email} onChange={sv('email')} /><Input label="Phone" value={v.phone} onChange={sv('phone')} />
        <Input label="Address" value={v.line1} onChange={sv('line1')} /><Input label="City" value={v.city} onChange={sv('city')} /><Input label="Province" value={v.region} onChange={sv('region')} /><Input label="Postal code" value={v.postal_code} onChange={sv('postal_code')} />
        <Input label="Cuisines" value={v.cuisines} onChange={sv('cuisines')} hint="Comma separated" full /><Input label="Tax number" value={v.tax_number} onChange={sv('tax_number')} optional /><Input label="Website" value={v.website} onChange={sv('website')} optional />
        <div><div className="label">Logo</div>{v.logo_url && <img src={v.logo_url} alt="" width={64} height={64} style={{ borderRadius: 10 }} />}<input aria-label="Upload logo" type="file" accept="image/*" onChange={(e) => pic('logo_url', e.target.files?.[0])} /></div>
        <div><div className="label">Cover image</div>{v.cover_url && <img src={v.cover_url} alt="" style={{ height: 64, borderRadius: 10 }} />}<input aria-label="Upload cover" type="file" accept="image/*" onChange={(e) => pic('cover_url', e.target.files?.[0])} /></div>
        <div className="full"><Btn variant="primary" busy={busy} onClick={() => run(() => patch(`/vendors/${vendorId}/manage`, { trading_name: v.trading_name, legal_name: v.legal_name, description: v.description || null, email: v.email, phone: v.phone, line1: v.line1, city: v.city, region: v.region, postal_code: v.postal_code, cuisines: String(v.cuisines).split(',').map((x) => x.trim()).filter(Boolean), tax_number: v.tax_number || undefined, website: v.website || null, logo_url: v.logo_url, cover_url: v.cover_url }), 'Profile saved')}>Save profile</Btn></div>
      </div></div>}
      {tab === 'hours' && <div className="card pad"><div className="stack" style={{ '--gap': '10px' } as any}>{hours.map((h, i) => (
        <div key={h.weekday} className="row wrap-row" style={{ alignItems: 'center' }}><b style={{ width: 100 }}>{DAYS[h.weekday]}</b><Check label="Closed" checked={!!h.is_closed} onChange={(x) => setHours((a) => a.map((y, j) => (j === i ? { ...y, is_closed: x } : y)))} />
          {!h.is_closed && <><label className="sr-only" htmlFor={`o${i}`}>Opens</label><input id={`o${i}`} className="input" style={{ width: 130 }} type="time" value={h.opens ?? ''} onChange={(e) => setHours((a) => a.map((y, j) => (j === i ? { ...y, opens: e.target.value } : y)))} /><span>to</span><label className="sr-only" htmlFor={`c${i}`}>Closes</label><input id={`c${i}`} className="input" style={{ width: 130 }} type="time" value={h.closes ?? ''} onChange={(e) => setHours((a) => a.map((y, j) => (j === i ? { ...y, closes: e.target.value } : y)))} /></>}</div>))}
        <Btn variant="primary" busy={busy} onClick={() => run(() => put(`/vendors/${vendorId}/hours`, { hours: hours.map((h) => ({ weekday: h.weekday, opens: h.is_closed ? null : h.opens, closes: h.is_closed ? null : h.closes, is_closed: !!h.is_closed })) }), 'Hours saved')}>Save hours</Btn></div>
        <h3 style={{ marginTop: 24 }}>Days closed</h3>
        <Table caption="Holidays" rows={data.holidays} empty="No upcoming closures." cols={[{ key: 'day', header: 'Date' }, { key: 'note', header: 'Note' }, { key: 'x', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={() => run(() => del(`/vendors/${vendorId}/holidays/${r.day}`), 'Removed')}>Remove</Btn> }]} />
        <form className="row wrap-row" style={{ alignItems: 'flex-end', marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => post(`/vendors/${vendorId}/holidays`, hol), 'Closure added'); }}><Input label="Date" type="date" value={hol.day} onChange={(x) => setHol({ ...hol, day: x })} required /><Input label="Note" value={hol.note} onChange={(x) => setHol({ ...hol, note: x })} optional /><Btn type="submit">Add closure</Btn></form></div>}
      {tab === 'fulfil' && <div className="card pad"><div className="form-grid">
        <Check label="Offer delivery" checked={!!v.accepts_delivery} onChange={sv('accepts_delivery')} /><Check label="Offer customer pickup" checked={!!v.accepts_pickup} onChange={sv('accepts_pickup')} />
        <Check label="Deliver with my own drivers or staff" checked={!!v.uses_own_drivers} onChange={sv('uses_own_drivers')} hint="Set your own delivery zones and fees under Delivery zones." />
        <Input label="Typical preparation time (minutes)" type="number" min={1} value={v.default_prep_minutes} onChange={sv('default_prep_minutes')} /><Input label="Minimum order (CAD)" type="number" min={0} step="0.01" value={v.min_order} onChange={sv('min_order')} />
        <Input label="Bank account (last 4 digits shown on payouts)" value={v.bank_account_last4 ?? ''} onChange={sv('bank_account_last4')} maxLength={4} optional hint="Full bank details are collected securely during payout setup." />
        <div className="full"><Btn variant="primary" busy={busy} onClick={() => run(() => patch(`/vendors/${vendorId}/manage`, { accepts_delivery: !!v.accepts_delivery, accepts_pickup: !!v.accepts_pickup, uses_own_drivers: !!v.uses_own_drivers, default_prep_minutes: Number(v.default_prep_minutes), min_order: Number(v.min_order), ...(v.bank_account_last4 ? { bank_account_last4: v.bank_account_last4 } : {}) }), 'Saved')}>Save</Btn></div>
      </div></div>}
      {tab === 'chef' && c && <div className="card pad"><div className="form-grid">
        <Input label="Display name" value={c.display_name} onChange={(x) => setC({ ...c, display_name: x })} /><Input label="Specialties" value={c.specialties} onChange={(x) => setC({ ...c, specialties: x })} hint="Comma separated" />
        <Textarea label="About you" value={c.bio ?? ''} onChange={(x) => setC({ ...c, bio: x })} full rows={5} />
        <fieldset className="full"><legend>Days you cook</legend><div className="row wrap-row">{DAYS.map((d, i) => <Check key={d} label={d} checked={(c.operating_days ?? []).includes(i)} onChange={(x) => setC({ ...c, operating_days: x ? [...(c.operating_days ?? []), i] : (c.operating_days ?? []).filter((y: number) => y !== i) })} />)}</div></fieldset>
        <Input label="Portions per day" type="number" min={1} value={c.daily_capacity ?? ''} onChange={(x) => setC({ ...c, daily_capacity: x })} /><Input label="Portions per hour" type="number" min={1} value={c.hourly_capacity ?? ''} onChange={(x) => setC({ ...c, hourly_capacity: x })} optional />
        <Check label="Accepting portions right now" checked={!!c.portions_accepting} onChange={(x) => setC({ ...c, portions_accepting: x })} />
        <div className="full"><Btn variant="primary" busy={busy} onClick={() => run(() => put(`/vendors/${vendorId}/chef`, { display_name: c.display_name, bio: c.bio, specialties: String(c.specialties).split(',').map((x) => x.trim()).filter(Boolean), operating_days: c.operating_days, daily_capacity: c.daily_capacity ? Number(c.daily_capacity) : null, hourly_capacity: c.hourly_capacity ? Number(c.hourly_capacity) : null, portions_accepting: !!c.portions_accepting }), 'Chef profile saved')}>Save chef profile</Btn></div>
      </div></div>}
    </>
  );
}
void Badge; void label; void Select;
