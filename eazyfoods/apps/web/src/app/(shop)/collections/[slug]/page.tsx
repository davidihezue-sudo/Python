import { notFound } from 'next/navigation';
import { sget } from '@/lib/server';
import { ProductCard } from '@/components/cards';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const d = await sget<any>(`/collections/${(await params).slug}`, { revalidate: 60 }); return d ? { title: d.collection.title, description: d.collection.description ?? undefined, alternates: { canonical: `/collections/${d.collection.slug}` } } : {}; }
export default async function Collection({ params }: { params: Promise<{ slug: string }> }) {
  const d = await sget<any>(`/collections/${(await params).slug}`, { auth: true });
  if (!d) notFound();
  return <div className="wrap"><h1 style={{ margin: '22px 0 6px' }}>{d.collection.title}</h1><p className="muted">{d.collection.description}</p><div className="grid cols-4">{d.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div></div>;
}
