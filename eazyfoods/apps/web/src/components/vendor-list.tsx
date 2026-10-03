'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StoreCard } from './cards';
import { Empty, ErrorNote, Pager, Select, Input } from './ui';
import { get, qs } from '@/lib/api';
import { useLoc } from './providers';

export function VendorList({ kind }: { kind: 'stores' | 'chefs' }) {
  const sp = useSearchParams(); const router = useRouter(); const pathname = usePathname(); const { loc } = useLoc();
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const p: Record<string, string> = { ...Object.fromEntries(sp.entries()) };
  if (loc) { p.lat = String(loc.lat); p.lng = String(loc.lng); }
  const key = JSON.stringify(p);
  useEffect(() => { let live = true; get(`/${kind}${qs({ ...p, limit: 24 })}`).then((r) => live && (setRes(r), setErr(null))).catch((e) => live && setErr(e)); return () => { live = false; }; }, [key, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp.toString()); if (v) n.set(k, v); else n.delete(k); n.delete('page'); router.push(`${pathname}${n.toString() ? `?${n}` : ''}`); };
  return (
    <div className="wrap">
      <h1 style={{ margin: '22px 0 6px' }}>{kind === 'chefs' ? 'Home chefs' : 'Stores near you'}</h1>
      <p className="muted">{kind === 'chefs' ? 'Independent cooks making food to order. Each chef sets how many portions they can cook each day.' : 'African, Caribbean and multicultural grocers, specialty shops and kitchens.'}</p>
      <form className="row wrap-row" style={{ alignItems: 'flex-end', margin: '14px 0' }} onSubmit={(e) => { e.preventDefault(); set('q', q.trim() || null); }}>
        <div style={{ minWidth: 240 }}><Input label="Search by name or cuisine" value={q} onChange={setQ} /></div>
        <div style={{ minWidth: 180 }}><Select label="Sort" value={sp.get('sort') ?? ''} onChange={(v) => set('sort', v || null)} options={[{ value: '', label: 'Recommended' }, { value: 'rating', label: 'Top rated' }, ...(loc ? [{ value: 'distance', label: 'Nearest' }] : [])]} /></div>
        {loc && <label className="check"><input type="checkbox" checked={sp.get('deliverable') === 'true'} onChange={(e) => set('deliverable', e.target.checked ? 'true' : null)} /><span>Delivers to {loc.label}</span></label>}
        <button className="btn" type="submit">Search</button>
      </form>
      <ErrorNote error={err} />
      {!res ? <div className="grid cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}</div> : !res.items.length ? <Empty title="No matches">Try clearing your filters{loc ? ' or removing the delivery filter' : ''}.</Empty> : <div className="grid cols-3">{res.items.map((s: any) => <StoreCard key={s.id} s={s} />)}</div>}
      {res && <Pager page={Number(sp.get('page') ?? 1)} pages={Math.ceil(res.total / 24)} onPage={(n) => { const q2 = new URLSearchParams(sp.toString()); q2.set('page', String(n)); router.push(`${pathname}?${q2}`); }} />}
    </div>
  );
}
