import { Suspense } from 'react';
import { SearchListing } from '@/components/search-listing';
export const metadata = { title: 'Shop African and multicultural food', description: 'Search groceries, spices, fresh produce and prepared meals from local African, Caribbean and multicultural stores and chefs.', alternates: { canonical: '/search' } };
export default function Search() { return <Suspense><SearchListing /></Suspense>; }
