import { notFound } from 'next/navigation';
import { sget } from '@/lib/server';
import { IngredientList } from '@/components/recipe-cart';
import { date } from '@/lib/format';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = (await sget<any>(`/articles/${(await params).slug}`, { revalidate: 60 }))?.article;
  return a ? { title: a.seo_title ?? a.title, description: a.seo_description ?? a.excerpt ?? undefined, alternates: { canonical: `/articles/${a.slug}` }, openGraph: { images: [a.hero_image ?? '/img/food/platter.svg'] } } : { title: 'Not found', robots: { index: false } };
}
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const a = (await sget<any>(`/articles/${(await params).slug}`, { auth: true }))?.article;
  if (!a) notFound();
  const r = a.recipe;
  const ld = r ? { '@context': 'https://schema.org', '@type': 'Recipe', name: a.title, description: a.excerpt, image: `${SITE}${a.hero_image ?? ''}`, recipeYield: `${r.servings} servings`, prepTime: `PT${r.prep_minutes}M`, cookTime: `PT${r.cook_minutes}M`, recipeCuisine: r.cuisine, recipeIngredient: (a.ingredients ?? []).map((i: any) => i.label), recipeInstructions: (r.steps ?? []).map((s: string) => ({ '@type': 'HowToStep', text: s })) } : { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, datePublished: a.published_at, image: `${SITE}${a.hero_image ?? ''}` };
  return (
    <article className="wrap" style={{ maxWidth: 920 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <p className="eyebrow" style={{ marginTop: 28 }}>{a.kind}</p>
      <h1>{a.title}</h1>
      {a.excerpt && <p style={{ fontSize: '1.2rem' }} className="muted">{a.excerpt}</p>}
      <p className="small muted">{date(a.published_at)}</p>
      {a.hero_image && <img src={a.hero_image} alt="" style={{ width: '100%', aspectRatio: '16/7', objectFit: 'cover', borderRadius: 12 }} />}
      {r && <div className="row wrap-row" style={{ margin: '16px 0' }}>{[['Serves', r.servings], ['Prep', `${r.prep_minutes} min`], ['Cook', `${r.cook_minutes} min`], ['Cuisine', r.cuisine]].map(([k, v]) => <div key={String(k)} className="card pad" style={{ padding: '8px 14px' }}><div className="tiny muted">{k}</div><b>{v}</b></div>)}</div>}
      <div className="grid" style={{ gridTemplateColumns: r ? 'minmax(0,1.4fr) minmax(0,1fr)' : '1fr', gap: 32, alignItems: 'start' }}>
        <div>
          {a.body.split('\n\n').map((para: string, i: number) => <p key={i}>{para}</p>)}
          {r?.steps?.length > 0 && <><h2>Method</h2><ol style={{ paddingLeft: 20, display: 'grid', gap: 10 }}>{r.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>}
        </div>
        {a.ingredients?.length > 0 && <aside><IngredientList items={a.ingredients} /></aside>}
      </div>
    </article>
  );
}
