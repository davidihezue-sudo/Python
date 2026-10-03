'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PortalShell } from '../portal';
import type { NavItem } from '../portal';
import { get } from '@/lib/api';
import { useDebounced } from '@/hooks/useApi';

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Command centre', perm: 'orders.read' },
  { href: '/admin/orders', label: 'Orders', section: 'Operations', perm: 'orders.read' }, { href: '/admin/dispatch', label: 'Dispatch and drivers online', section: 'Operations', perm: 'dispatch.manage' },
  { href: '/admin/support', label: 'Support and disputes', section: 'Operations', perm: 'support.read' }, { href: '/admin/risk', label: 'Risk signals', section: 'Operations', perm: 'fraud.read' },
  { href: '/admin/vendors', label: 'Vendors and chefs', section: 'Partners', perm: 'vendors.read' }, { href: '/admin/drivers', label: 'Drivers', section: 'Partners', perm: 'drivers.read' },
  { href: '/admin/documents', label: 'Document review', section: 'Partners', perm: 'compliance.read' }, { href: '/admin/customers', label: 'Customers', section: 'Partners', perm: 'customers.read' },
  { href: '/admin/catalog', label: 'Catalogue and reviews', section: 'Catalogue', perm: 'catalog.manage' },
  { href: '/admin/finance', label: 'Finance and payouts', section: 'Finance', perm: 'ledger.read' }, { href: '/admin/analytics', label: 'Analytics', section: 'Finance', perm: 'analytics.read' },
  { href: '/admin/settings', label: 'Settings, fees and zones', section: 'Platform', perm: 'settings.read' }, { href: '/admin/compliance', label: 'Compliance rules', section: 'Platform', perm: 'compliance.read' },
  { href: '/admin/staff', label: 'Staff and roles', section: 'Platform', perm: 'users.read' }, { href: '/admin/audit', label: 'Audit log', section: 'Platform', perm: 'audit.read' }, { href: '/admin/outbox', label: 'Message outbox', section: 'Platform', perm: 'settings.read' },
];

function GlobalSearch() {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [res, setRes] = useState<any>(null); const router = useRouter(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (dq.trim().length < 2) { setRes(null); return; } get(`/admin/search?q=${encodeURIComponent(dq)}`).then((d) => setRes(d.results)).catch(() => setRes(null)); }, [dq]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setRes(null); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const href = (k: string, r: any) => ({ customers: `/admin/customers?open=${r.id}`, orders: `/admin/orders?open=${r.id}`, vendors: `/admin/vendors?open=${r.id}`, drivers: `/admin/drivers?open=${r.id}`, tickets: `/admin/support?open=${r.id}` } as any)[k] ?? '/admin';
  return (
    <div ref={ref} style={{ position: 'relative', margin: '0 10px 14px' }} role="search">
      <label htmlFor="gs" className="sr-only">Search orders, customers, vendors, drivers, tickets</label>
      <input id="gs" className="input" placeholder="Search everything" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" style={{ minHeight: 38 }} />
      {res && (
        <div className="suggest" style={{ minWidth: 300, color: 'var(--ink)' }}>
          {Object.entries(res).filter(([, v]: any) => v.length).map(([k, v]: any) => (
            <div key={k}><div className="tiny bold muted" style={{ padding: '6px 14px', textTransform: 'uppercase' }}>{k}</div>{v.slice(0, 5).map((r: any) => <div key={r.id} role="option" aria-selected={false} onMouseDown={() => { setRes(null); setQ(''); router.push(href(k, r)); }}><span>{r.title}</span><span className="muted small">{r.subtitle}</span></div>)}</div>))}
          {!Object.values(res).some((v: any) => v.length) && <div style={{ padding: 14 }} className="muted small">No matches.</div>}
        </div>)}
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell name="Operations portal" sub="Admin" nav={ADMIN_NAV} allow={(me) => (me.roles ?? []).some((r: string) => !['customer', 'driver', 'vendor', 'chef'].includes(r)) || (me.permissions ?? []).length > 0} extra={<div style={{ marginTop: 10 }}><GlobalSearch /></div>}>
      {children}
    </PortalShell>
  );
}
void Link;
