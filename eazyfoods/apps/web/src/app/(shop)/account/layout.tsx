'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { Spinner } from '@/components/ui';

const NAV = [['/account', 'Profile and security'], ['/account/orders', 'Orders'], ['/account/addresses', 'Addresses'], ['/account/favorites', 'Favourites and lists'], ['/account/reviews', 'My reviews'], ['/account/loyalty', 'Rewards, credit and referrals'], ['/account/notifications', 'Notifications'], ['/account/support', 'Help and support']];
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { me, ready } = useAuth(); const router = useRouter(); const path = usePathname();
  useEffect(() => { if (ready && !me?.user) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [ready, me?.user, router, path]);
  if (!ready || !me?.user) return <div className="wrap center" style={{ padding: 60 }}><Spinner /></div>;
  return (
    <div className="wrap" style={{ paddingTop: 22 }}>
      <h1>Your account</h1>
      <div className="layout-sidebar">
        <aside><nav aria-label="Account"><ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 2 }}>{NAV.map(([h, l]) => <li key={h}><Link href={h} aria-current={path === h ? 'page' : undefined} className="word-tile" style={path === h ? { borderColor: 'var(--ink)', background: 'var(--paper-2)' } : undefined}>{l}</Link></li>)}</ul></nav></aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
