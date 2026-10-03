'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Btn, Check, ErrorNote, Input, Select, Textarea, useToast } from './ui';
import { useAuth } from './providers';
import { post } from '@/lib/api';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const fieldErr = (e: any, k: string) => e?.details?.fieldErrors?.[k]?.[0] ?? e?.details?.[k] ?? null;

// Where each kind of user lands after signing in.
function landing(me: any, next: string) {
  if (next !== '/') return next;
  const roles: string[] = me?.roles ?? [];
  if (roles.some((r) => !['customer', 'driver'].includes(r))) return '/admin';
  if (me?.memberships?.length) return me.memberships[0].seller_type === 'chef' ? '/chef' : '/vendor';
  if (me?.driver) return '/driver';
  return '/';
}

export function LoginForm({ portal }: { portal?: string }) {
  const sp = useSearchParams(); const router = useRouter(); const { refresh } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await post('/auth/login', { email, password }); const me = await refresh(); router.push(landing(me, safeNext(sp.get('next')))); router.refresh(); } catch (x) { setErr(x); } finally { setBusy(false); }
    }}>
      <ErrorNote error={err} />
      <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
      <Input label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
      <Btn type="submit" variant="primary" size="lg" block busy={busy}>{portal ? `Sign in to ${portal}` : 'Sign in'}</Btn>
      <p className="small"><Link href="/forgot-password">Forgot your password?</Link></p>
    </form>
  );
}

export function RegisterForm() {
  const sp = useSearchParams(); const router = useRouter(); const { refresh } = useAuth();
  const [f, setF] = useState({ full_name: '', email: '', password: '', phone: '', referral_code: sp.get('ref') ?? '' });
  const [mk, setMk] = useState(false); const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const s = (k: string) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await post('/auth/register', { ...f, phone: f.phone || undefined, referral_code: f.referral_code || undefined, marketing_opt_in: mk }); await refresh(); router.push(safeNext(sp.get('next'))); router.refresh(); } catch (x) { setErr(x); } finally { setBusy(false); }
    }}>
      <ErrorNote error={err} />
      <Input label="Full name" value={f.full_name} onChange={s('full_name')} autoComplete="name" required error={fieldErr(err, 'full_name')} />
      <Input label="Email" type="email" value={f.email} onChange={s('email')} autoComplete="email" required error={fieldErr(err, 'email')} />
      <Input label="Password" type="password" value={f.password} onChange={s('password')} autoComplete="new-password" hint="At least 10 characters. A passphrase works well." required error={fieldErr(err, 'password')} />
      <Input label="Phone" type="tel" value={f.phone} onChange={s('phone')} autoComplete="tel" optional hint="Used only for delivery updates." />
      <Input label="Referral code" value={f.referral_code} onChange={s('referral_code')} optional />
      <Check label="Email me offers and new stores" checked={mk} onChange={setMk} hint="Optional. You can change this any time." />
      <Check label={<>I agree to the terms and the privacy policy</>} checked={terms} onChange={setTerms} />
      <Btn type="submit" variant="primary" size="lg" block busy={busy} disabled={!terms}>Create account</Btn>
    </form>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  if (done) return <div className="alert ok" role="status">If an account exists for {email}, we sent a reset link. It expires in one hour.</div>;
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await post('/auth/password/forgot', { email }); setDone(true); } catch (x) { setErr(x); } finally { setBusy(false); } }}>
      <ErrorNote error={err} /><Input label="Email" type="email" value={email} onChange={setEmail} required /><Btn type="submit" variant="primary" busy={busy}>Send reset link</Btn>
    </form>
  );
}
export function ResetForm() {
  const sp = useSearchParams(); const router = useRouter(); const toast = useToast();
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await post('/auth/password/reset', { token: sp.get('token') ?? '', password: pw }); toast('Password updated. Please sign in.'); router.push('/login'); } catch (x) { setErr(x); } finally { setBusy(false); } }}>
      <ErrorNote error={err} /><Input label="New password" type="password" value={pw} onChange={setPw} autoComplete="new-password" hint="At least 10 characters." required /><Btn type="submit" variant="primary" busy={busy}>Set new password</Btn>
    </form>
  );
}

/* ---------- seller / chef / driver applications ---------- */
export function ApplyForm({ kind }: { kind: 'vendor' | 'chef' | 'driver' }) {
  const router = useRouter(); const { me, refresh } = useAuth(); const toast = useToast();
  const [a, setA] = useState({ full_name: '', email: '', password: '', phone: '' });
  const [b, setB] = useState<any>({ seller_type: kind === 'chef' ? 'chef' : 'grocery', legal_name: '', trading_name: '', description: '', line1: '', city: '', region: 'ON', postal_code: '', cuisines: '', tax_number: '', display_name: '', bio: '', specialties: '', daily_capacity: '20', accepts_delivery: true, accepts_pickup: true });
  const [d, setD] = useState<any>({ legal_name: '', phone: '', city: '', region: 'ON', postal_code: '', licence_number: '', vehicle_type: 'car', make: '', model: '', plate: '', has_cold_storage: false });
  const [terms, setTerms] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null); const [done, setDone] = useState(false);
  const sa = (k: string) => (v: string) => setA((o) => ({ ...o, [k]: v })); const sb = (k: string) => (v: any) => setB((o: any) => ({ ...o, [k]: v })); const sd = (k: string) => (v: any) => setD((o: any) => ({ ...o, [k]: v }));
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const business = () => ({ seller_type: b.seller_type, legal_name: b.legal_name, trading_name: b.trading_name, description: b.description || undefined, line1: b.line1, city: b.city, region: b.region, postal_code: b.postal_code, tax_number: b.tax_number || undefined, phone: a.phone || undefined, cuisines: list(b.cuisines), accepts_delivery: b.accepts_delivery, accepts_pickup: b.accepts_pickup, ...(kind === 'chef' ? { chef: { display_name: b.display_name || undefined, bio: b.bio || undefined, specialties: list(b.specialties), daily_capacity: Number(b.daily_capacity) || 20 } } : {}) });
  const driver = () => ({ legal_name: d.legal_name || a.full_name, phone: d.phone || a.phone, city: d.city, region: d.region, postal_code: d.postal_code, licence_number: d.licence_number || undefined, vehicle: { vehicle_type: d.vehicle_type, make: d.make || undefined, model: d.model || undefined, plate: d.plate || undefined, has_cold_storage: d.has_cold_storage } });
  if (done) return (<div className="alert ok" role="status"><div><h3>Application received</h3><p>Thank you. Our team reviews every application. {kind === 'driver' ? 'Upload your licence, insurance and background check in the driver app so we can approve you.' : 'Next, sign in to the portal to add your documents (business licence, food handler certificate, insurance) and your first products.'}</p><Btn variant="primary" onClick={() => router.push(kind === 'driver' ? '/driver' : kind === 'chef' ? '/chef' : '/vendor')}>Open my portal</Btn></div></div>);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try {
        if (me?.user) await post(kind === 'driver' ? '/auth/apply/driver' : '/auth/apply/vendor', kind === 'driver' ? driver() : business());
        else await post(`/auth/register/${kind}`, { account: { ...a, phone: a.phone || undefined }, ...(kind === 'driver' ? { driver: driver() } : { business: kind === 'chef' ? (({ seller_type, ...r }) => r)(business() as any) : business() }) });
        await refresh(); setDone(true); toast('Application submitted');
      } catch (x) { setErr(x); } finally { setBusy(false); }
    }}>
      <ErrorNote error={err} />
      {!me?.user && <fieldset><legend>Your account</legend><div className="form-grid">
        <Input label="Full name" value={a.full_name} onChange={sa('full_name')} required autoComplete="name" /><Input label="Phone" type="tel" value={a.phone} onChange={sa('phone')} required autoComplete="tel" />
        <Input label="Email" type="email" value={a.email} onChange={sa('email')} required autoComplete="email" /><Input label="Password" type="password" value={a.password} onChange={sa('password')} required autoComplete="new-password" hint="At least 10 characters." />
      </div></fieldset>}
      {me?.user && <p className="alert">Applying as {me.user.email}.</p>}
      {kind !== 'driver' ? (
        <fieldset><legend>{kind === 'chef' ? 'Your kitchen' : 'Your business'}</legend><div className="form-grid">
          {kind === 'vendor' && <Select label="Type of seller" value={b.seller_type} onChange={sb('seller_type')} options={[{ value: 'grocery', label: 'Grocery store' }, { value: 'specialty', label: 'Specialty food store' }, { value: 'prepared', label: 'Restaurant or prepared food' }]} />}
          <Input label="Legal name" value={b.legal_name} onChange={sb('legal_name')} required /><Input label="Trading name (shown to customers)" value={b.trading_name} onChange={sb('trading_name')} required />
          <Input label="Street address" value={b.line1} onChange={sb('line1')} required /><Input label="City" value={b.city} onChange={sb('city')} required />
          <Input label="Province" value={b.region} onChange={sb('region')} required maxLength={3} /><Input label="Postal code" value={b.postal_code} onChange={sb('postal_code')} required />
          <Input label="Cuisines" value={b.cuisines} onChange={sb('cuisines')} hint="Comma separated, for example Nigerian, Ghanaian" full />
          <Input label="Business or tax number" value={b.tax_number} onChange={sb('tax_number')} optional />
          {kind === 'chef' && <><Input label="Display name" value={b.display_name} onChange={sb('display_name')} optional /><Input label="Specialties" value={b.specialties} onChange={sb('specialties')} hint="Comma separated" optional /><Input label="Portions you can cook per day" type="number" min={1} value={b.daily_capacity} onChange={sb('daily_capacity')} /><Textarea label="About you" value={b.bio} onChange={sb('bio')} full optional /></>}
          <Textarea label="Description" value={b.description} onChange={sb('description')} full optional />
          <Check label="We can deliver" checked={b.accepts_delivery} onChange={sb('accepts_delivery')} /><Check label="Customers can pick up" checked={b.accepts_pickup} onChange={sb('accepts_pickup')} />
        </div></fieldset>
      ) : (
        <fieldset><legend>Driver details</legend><div className="form-grid">
          <Input label="Legal name" value={d.legal_name} onChange={sd('legal_name')} placeholder={a.full_name} /><Input label="Phone" type="tel" value={d.phone} onChange={sd('phone')} placeholder={a.phone} />
          <Input label="City" value={d.city} onChange={sd('city')} required /><Input label="Postal code" value={d.postal_code} onChange={sd('postal_code')} required />
          <Input label="Driver licence number" value={d.licence_number} onChange={sd('licence_number')} optional hint="Not needed for bicycles." />
          <Select label="Vehicle" value={d.vehicle_type} onChange={sd('vehicle_type')} options={['car', 'van', 'scooter', 'ebike', 'bike']} />
          <Input label="Make" value={d.make} onChange={sd('make')} optional /><Input label="Model" value={d.model} onChange={sd('model')} optional /><Input label="Plate" value={d.plate} onChange={sd('plate')} optional />
          <Check label="My vehicle has cold storage" checked={d.has_cold_storage} onChange={sd('has_cold_storage')} />
        </div></fieldset>)}
      <Check label="I agree to the terms and confirm the information is accurate" checked={terms} onChange={setTerms} />
      <Btn type="submit" variant="primary" size="lg" busy={busy} disabled={!terms}>Submit application</Btn>
    </form>
  );
}
