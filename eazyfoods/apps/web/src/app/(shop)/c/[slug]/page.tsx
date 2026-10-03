import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { SearchListing } from '@/components/search-listing';
import { sget } from '@/lib/server';

async function find(slug: string) {
  const d = await sget<{ categories: any[] }>('/categories', { revalidate: 60 });
  const walk = (cs: any[], trail: any[] = []): any => { for (const c of cs) { if (c.slug === slug) return { c, trail }; const r = walk(c.children ?? [], [...trail, c]); if (r) return r; } return null; };
  return walk(d?.categories ?? []);
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const f = await find(slug);
  return f ? { title: `${f.c.name}`, description: f.c.description ?? `Shop ${f.c.name} from local stores and chefs.`, alternates: { canonical: `/c/${slug}` } } : {};
}
export default async function Category({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const f = await find(slug);
  if (!f) notFound();
  return (
    <>
      <div className="wrap"><nav className="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span>{f.trail.map((t: any) => <span key={t.slug}><a href={`/c/${t.slug}`}>{t.name}</a> /</span>)}<span aria-current="page">{f.c.name}</span></nav>
        {f.c.children?.length > 0 && <div className="row wrap-row" style={{ '--gap': '8px' } as any}>{f.c.children.map((c: any) => <a key={c.slug} className="chip" href={`/c/${c.slug}`}>{c.name}</a>)}</div>}</div>
      <Suspense><SearchListing fixed={{ category: slug }} title={f.c.name} intro={f.c.description} /></Suspense>
    </>
  );
}
