import { OrderTracker } from '@/components/order-tracker';
export const metadata = { title: 'Track your order', robots: { index: false } };
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) { return <OrderTracker id={(await params).id} />; }
