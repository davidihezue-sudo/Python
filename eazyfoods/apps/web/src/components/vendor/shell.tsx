'use client';
import { PortalShell, VendorProvider } from '../portal';
import type { NavItem } from '../portal';

export function VendorShell({ base, chef, children }: { base: '/vendor' | '/chef'; chef: boolean; children: React.ReactNode }) {
  const nav: NavItem[] = [
    { href: base, label: 'Dashboard' }, { href: `${base}/orders`, label: chef ? 'Orders and tickets' : 'Orders', section: 'Sell' },
    { href: `${base}/products`, label: chef ? 'Menu' : 'Products', section: 'Sell' }, { href: `${base}/inventory`, label: 'Inventory and barcodes', section: 'Sell' },
    ...(chef ? [{ href: `${base}/kitchen`, label: 'Kitchen, recipes and capacity', section: 'Sell' }] : []),
    { href: `${base}/promotions`, label: 'Promotions', section: 'Grow' }, { href: `${base}/reviews`, label: 'Reviews', section: 'Grow' }, { href: `${base}/analytics`, label: 'Analytics', section: 'Grow' },
    { href: `${base}/payouts`, label: 'Payouts', section: 'Business' }, { href: `${base}/zones`, label: 'Delivery zones', section: 'Business' }, { href: `${base}/settings`, label: 'Profile and hours', section: 'Business' },
    { href: `${base}/disputes`, label: 'Disputes', section: 'Business' }, { href: `${base}/team`, label: 'Team', section: 'Business' }, { href: `${base}/onboarding`, label: 'Onboarding and documents', section: 'Business' },
  ];
  return (
    <PortalShell name={chef ? 'Chef portal' : 'Vendor portal'} sub={chef ? 'Chef' : 'Vendor'} nav={nav} allow={(me) => (me.memberships ?? []).some((m: any) => chef ? m.seller_type === 'chef' : true)}>
      <VendorProvider base={base}>{children}</VendorProvider>
    </PortalShell>
  );
}
