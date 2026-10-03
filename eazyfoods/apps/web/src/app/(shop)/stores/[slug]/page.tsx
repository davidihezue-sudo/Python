import { Storefront, storefrontMeta } from '@/components/storefront';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return storefrontMeta((await params).slug, false); }
export default async function Store({ params }: { params: Promise<{ slug: string }> }) { return <Storefront slug={(await params).slug} chef={false} />; }
