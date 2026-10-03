import { Suspense } from 'react';
import { VendorList } from '@/components/vendor-list';
export const metadata = { title: 'Home chefs cooking African and multicultural food', description: 'Order home cooked meals from independent chefs near you. Fresh, made to order, delivered or ready for pickup.', alternates: { canonical: '/chefs' } };
export default function Chefs() { return <Suspense><VendorList kind="chefs" /></Suspense>; }
