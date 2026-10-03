import { Suspense } from 'react';
import { SearchListing } from '@/components/search-listing';
export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) { const { name } = await params; const n = decodeURIComponent(name); return { title: `${n} food`, description: `Shop ${n} ingredients and meals from local stores and home chefs.`, alternates: { canonical: `/cuisine/${name}` } }; }
export default async function Cuisine({ params }: { params: Promise<{ name: string }> }) { const { name } = await params; const n = decodeURIComponent(name); return <Suspense><SearchListing fixed={{ cuisine: n }} title={`${n} food`} intro={`Ingredients, snacks and meals in the ${n} tradition.`} /></Suspense>; }
