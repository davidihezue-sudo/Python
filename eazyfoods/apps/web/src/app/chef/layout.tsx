import { VendorShell } from '@/components/vendor/shell';
export const metadata = { title: 'Chef portal', robots: { index: false } };
export default function L({ children }: { children: React.ReactNode }) { return <VendorShell base="/chef" chef>{children}</VendorShell>; }
