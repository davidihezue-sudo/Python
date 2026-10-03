import { Suspense } from 'react';
import { VendorList } from '@/components/vendor-list';
export const metadata = { title: 'African and Caribbean grocery stores', description: 'Browse local African, Caribbean and multicultural grocers and specialty food stores that deliver.', alternates: { canonical: '/stores' } };
export default function Stores() { return <Suspense><VendorList kind="stores" /></Suspense>; }
