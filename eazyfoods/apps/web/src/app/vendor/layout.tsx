import { VendorShell } from '@/components/vendor/shell';
export const metadata = { title: 'Vendor portal', robots: { index: false } };
export default function L({ children }: { children: React.ReactNode }) { return <VendorShell base="/vendor" chef={false}>{children}</VendorShell>; }
