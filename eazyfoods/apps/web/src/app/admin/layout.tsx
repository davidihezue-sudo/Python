import { AdminShell } from '@/components/admin/shell';
export const metadata = { title: 'Operations portal', robots: { index: false } };
export default function L({ children }: { children: React.ReactNode }) { return <AdminShell>{children}</AdminShell>; }
