'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LoginForm } from './auth-forms';
import { useAuth } from './providers';
import { Spinner } from './ui';

export type NavItem = { href: string; label: string; section?: string; perm?: string };

// Shared shell for every back office surface: sign in, authorisation check, sidebar navigation.
export function PortalShell({ name, sub, nav, allow, children, extra }: { name: string; sub: string; nav: NavItem[]; allow: (me: any) => boolean; children: ReactNode; extra?: ReactNode }) {
  const { me, ready, logout } = useAuth();
  const path = usePathname();
  if (!ready) return <div className="center" style={{ padding: 80 }}><Spinner /></div>;
  if (!me?.user) return (
    <div className="wrap" style={{ maxWidth: 440, padding: '60px 16px' }}>
      <p className="eyebrow">{sub}</p><h1>{name}</h1>
      <div className="card pad"><Suspense><LoginForm portal={name} /></Suspense></div>
      <p className="small muted" style={{ marginTop: 12 }}><Link href="/">Back to EAZyfoods</Link></p>
    </div>
  );
  if (!allow(me)) return (
    <div className="wrap" style={{ maxWidth: 560, padding: '60px 16px' }}>
      <h1>No access to {name}</h1><p>Your account ({me.user.email}) is not set up for this area. If you expected access, ask an administrator to add the right role, or sign in with a different account.</p>
      <div className="row"><Link className="btn primary" href="/">Back to the shop</Link><button className="btn secondary" onClick={logout}>Sign out</button></div>
    </div>
  );
  const sections = [...new Set(nav.map((n) => n.section ?? ''))];
  const visible = nav.filter((n) => !n.perm || me.permissions.includes(n.perm) || me.permissions.includes('*'));
  return (
    <div className="portal">
      <aside aria-label={`${name} navigation`}>
        <Link href={nav[0].href} className="brand"><span>EAZy<b style={{ color: "#f0824f" }}>foods</b></span><small>{sub}</small></Link>
        <nav className="side-nav">
          {sections.map((s) => (
            <div key={s} style={{ display: 'contents' }}>
              {s && visible.some((n) => (n.section ?? '') === s) && <h5>{s}</h5>}
              {visible.filter((n) => (n.section ?? '') === s).map((n) => <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== nav[0].href && path.startsWith(n.href)) ? 'page' : undefined}>{n.label}</Link>)}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: 24, padding: '0 10px' }} className="small">
          <div style={{ opacity: 0.8 }}>{me.user.full_name}</div>{extra}
          <button className="btn sm secondary" style={{ marginTop: 8, color: '#eadfc8', borderColor: '#5a5144' }} onClick={logout}>Sign out</button>
          <div style={{ marginTop: 8 }}><Link href="/" style={{ color: '#eadfc8' }}>View shop</Link></div>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>{children}</main>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return <div className="topbar"><div><h1>{title}</h1>{sub && <p className="muted" style={{ margin: '4px 0 0' }}>{sub}</p>}</div><div className="row wrap-row">{actions}</div></div>;
}

/* ---------- vendor context ---------- */
type VCtx = { vendorId: string; membership: any; base: string; chef: boolean };
const V = createContext<VCtx | null>(null);
export const useVendor = () => useContext(V)!;
export function VendorProvider({ base, children }: { base: string; children: ReactNode }) {
  const { me } = useAuth();
  const ms: any[] = me?.memberships ?? [];
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { try { setSel(localStorage.getItem('ez_vendor')); } catch { /* ignore */ } }, []);
  const m = ms.find((x) => x.vendor_id === sel) ?? ms[0];
  if (!m) return null;
  return (
    <V.Provider value={{ vendorId: m.vendor_id, membership: m, base, chef: m.seller_type === 'chef' }}>
      {ms.length > 1 && <div className="no-print" style={{ marginBottom: 12 }}><label className="small bold" htmlFor="vsel">Business </label><select id="vsel" className="select" style={{ width: 'auto' }} value={m.vendor_id} onChange={(e) => { setSel(e.target.value); try { localStorage.setItem('ez_vendor', e.target.value); } catch { /* ignore */ } }}>{ms.map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.trading_name}</option>)}</select></div>}
      {m.verification_status !== 'approved' && <div className="alert warn no-print" style={{ marginBottom: 16 }}><div><b>Your account is {m.verification_status}.</b> Customers cannot see your products until you are approved. Finish <Link href={`${base}/onboarding`}>onboarding</Link>: complete your profile, upload documents and submit for review.</div></div>}
      {children}
    </V.Provider>
  );
}
