import { MarketingShell } from '@/components/marketing/shell';
export const metadata = { title: 'Marketing portal', robots: { index: false } };
export default function L({ children }: { children: React.ReactNode }) { return <MarketingShell>{children}</MarketingShell>; }
