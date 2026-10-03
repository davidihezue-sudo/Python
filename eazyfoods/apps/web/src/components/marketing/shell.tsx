'use client';
import { PortalShell } from '../portal';
import type { NavItem } from '../portal';

const NAV: NavItem[] = [
  { href: '/marketing', label: 'Overview' },
  { href: '/marketing/homepage', label: 'Homepage', section: 'Storefront' }, { href: '/marketing/collections', label: 'Collections', section: 'Storefront' }, { href: '/marketing/content', label: 'Blog, recipes and FAQ', section: 'Storefront' }, { href: '/marketing/search', label: 'Search synonyms', section: 'Storefront' },
  { href: '/marketing/promotions', label: 'Promotions and coupons', section: 'Grow' }, { href: '/marketing/campaigns', label: 'Campaigns', section: 'Grow' }, { href: '/marketing/ads', label: 'Ads and banners', section: 'Grow' }, { href: '/marketing/segments', label: 'Customer segments', section: 'Grow' }, { href: '/marketing/settings', label: 'Loyalty and guard rails', section: 'Grow' },
];
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return <PortalShell name="Marketing portal" sub="Marketing" nav={NAV} allow={(me) => (me.permissions ?? []).some((p: string) => ['marketing.manage', 'promotions.manage', 'content.manage', 'ads.manage'].includes(p))}>{children}</PortalShell>;
}
