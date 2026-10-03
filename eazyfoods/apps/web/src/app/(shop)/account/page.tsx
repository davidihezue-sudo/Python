'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { Btn, Check, Confirm, ErrorNote, Input, Table, useToast } from '@/components/ui';
import { api, del, get, patch, post } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function Profile() {
  const { me, refresh, logout } = useAuth(); const toast = useToast();
  const [f, setF] = useState({ full_name: me?.user.full_name ?? '', phone: me?.user.phone ?? '', marketing_opt_in: !!me?.user.marketing_opt_in });
  const [pw, setPw] = useState({ current_password: '', new_password: '' }); const [err, setErr] = useState<any>(null); const [perr, setPerr] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]); const [close, setClose] = useState(false);
  const load = () => get('/auth/sessions').then((d) => setSessions(d.sessions ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="stack" style={{ '--gap': '24px' } as any}>
      <section className="card pad"><h2 style={{ fontSize: '1.2rem' }}>Profile</h2>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await patch('/auth/me', { full_name: f.full_name, phone: f.phone || null, marketing_opt_in: f.marketing_opt_in }); await refresh(); toast('Profile saved'); } catch (x) { setErr(x); } }}>
          <div className="full"><ErrorNote error={err} /></div>
          <Input label="Full name" value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} required /><Input label="Email" value={me?.user.email} onChange={() => {}} disabled hint="Contact support to change your email." />
          <Input label="Phone" type="tel" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} optional /><div />
          <div className="full"><Check label="Send me offers and news by email" checked={f.marketing_opt_in} onChange={(v) => setF({ ...f, marketing_opt_in: v })} hint="Order updates are always sent." /></div>
          <div className="full"><Btn type="submit" variant="primary">Save profile</Btn></div>
        </form>
      </section>
      <section className="card pad"><h2 style={{ fontSize: '1.2rem' }}>Change password</h2>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setPerr(null); try { await post('/auth/password/change', pw); setPw({ current_password: '', new_password: '' }); toast('Password changed. Other devices were signed out.'); load(); } catch (x) { setPerr(x); } }}>
          <div className="full"><ErrorNote error={perr} /></div>
          <Input label="Current password" type="password" value={pw.current_password} onChange={(v) => setPw({ ...pw, current_password: v })} autoComplete="current-password" required /><Input label="New password" type="password" value={pw.new_password} onChange={(v) => setPw({ ...pw, new_password: v })} autoComplete="new-password" hint="At least 10 characters." required />
          <div className="full"><Btn type="submit" variant="secondary">Change password</Btn></div>
        </form>
      </section>
      <section className="card pad"><h2 style={{ fontSize: '1.2rem' }}>Signed in devices</h2>
        <Table caption="Active sessions" rows={sessions} cols={[{ key: 'ua', header: 'Device', render: (s: any) => <span className="small">{(s.user_agent ?? 'Unknown').slice(0, 60)}{s.current && <b> (this device)</b>}</span> }, { key: 'last', header: 'Last active', render: (s: any) => dateTime(s.last_seen_at ?? s.created_at) }, { key: 'x', header: '', render: (s: any) => s.current ? null : <Btn size="sm" variant="ghost" onClick={async () => { await del(`/auth/sessions/${s.id}`); load(); }}>Sign out</Btn> }]} />
        <div className="row" style={{ marginTop: 12 }}><Btn variant="secondary" onClick={logout}>Sign out of this device</Btn></div>
      </section>
      <section className="card pad"><h2 style={{ fontSize: '1.2rem' }}>Close account</h2><p className="muted">Closing your account removes your personal details. Order records are kept for tax and refund purposes with your name removed.</p><Btn variant="danger-outline" onClick={() => setClose(true)}>Close my account</Btn></section>
      {close && <Confirm title="Close your account?" danger confirmLabel="Close account" onClose={() => setClose(false)} onConfirm={async () => { await api('/auth/me', { method: 'DELETE' }); window.location.href = '/'; }}><p>This cannot be undone. Active orders must be completed first.</p></Confirm>}
    </div>
  );
}
