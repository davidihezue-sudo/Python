'use client';
import { useState } from 'react';
import { useAuth } from '@/components/providers';
import { Badge, Btn, Spinner, Table, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { post } from '@/lib/api';
import { dateTime, label, money } from '@/lib/format';

export default function Loyalty() {
  const { me } = useAuth(); const toast = useToast();
  const l = useApi<any>('/customers/me/loyalty'); const c = useApi<any>('/customers/me/coupons');
  const [busy, setBusy] = useState(false);
  if (l.loading && !l.data) return <Spinner />;
  const s = l.data?.status;
  const link = typeof window !== 'undefined' ? `${window.location.origin}/register?ref=${me?.user.referral_code ?? ''}` : '';
  return (
    <div className="stack" style={{ '--gap': '20px' } as any}>
      <h2 style={{ margin: 0 }}>Rewards, credit and referrals</h2>
      {s && <div className="grid cols-3">
        <div className="card stat"><div className="l">Points</div><div className="v">{s.balance}</div><div className="d"><Badge tone="warn">{label(s.tier)}</Badge> {s.nextTier && <span className="small muted">{s.nextTier.pointsNeeded} to {label(s.nextTier.key)}</span>}</div></div>
        <div className="card stat"><div className="l">Store credit</div><div className="v">{money(s.storeCredit)}</div><div className="hint">Applied at checkout when you choose it.</div></div>
        <div className="card stat"><div className="l">Redeem</div><div className="hint">{s.redeemUnit.points} points = {money(s.redeemUnit.value)} of credit.</div><Btn size="sm" variant="primary" busy={busy} disabled={s.balance < s.redeemUnit.points} onClick={async () => { setBusy(true); try { await post('/customers/me/loyalty/redeem', { points: Math.floor(s.balance / s.redeemUnit.points) * s.redeemUnit.points }); toast('Points converted to store credit'); l.reload(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>Convert all points</Btn></div>
      </div>}
      <section className="card pad"><h3>Refer a friend</h3><p>Share your link. When a friend places their first order, you both get a reward. Referrals between accounts at the same address or device do not qualify.</p>
        <div className="row wrap-row"><code className="json grow" style={{ padding: '10px 12px' }}>{link}</code><Btn variant="secondary" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copied'); }}>Copy link</Btn></div>
        <p className="small muted">Your code: <b>{me?.user.referral_code}</b></p></section>
      <section><h3>Offers you can use</h3>{c.data?.coupons.length ? <div className="grid cols-2">{c.data.coupons.map((p: any) => <div key={p.id} className="card pad"><b>{p.name}</b><div className="small muted">Code <b>{p.code}</b>{p.min_order > 0 && <> · min {money(p.min_order)}</>}{p.ends_at && <> · ends {dateTime(p.ends_at)}</>}</div></div>)}</div> : <p className="muted">No public offers right now.</p>}</section>
      <section><h3>Points history</h3><Table caption="Points history" rows={l.data?.history ?? []} cols={[{ key: 'created_at', header: 'Date', render: (r: any) => dateTime(r.created_at) }, { key: 'reason', header: 'Reason', render: (r: any) => label(r.reason) }, { key: 'points', header: 'Points', align: 'right', render: (r: any) => (r.points > 0 ? `+${r.points}` : r.points) }]} /></section>
    </div>
  );
}
