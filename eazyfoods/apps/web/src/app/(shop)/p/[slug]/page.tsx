import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sget } from '@/lib/server';
import { PurchasePanel } from '@/components/purchase-panel';
import { ProductCard } from '@/components/cards';
import { Badge, KV, Stars } from '@/components/ui';
import { date, label, money } from '@/lib/format';
import { t } from '@/lib/i18n';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const d = await sget<{ product: any }>(`/products/${slug}`, { revalidate: 30 });
  const p = d?.product;
  if (!p) return { title: 'Product not found', robots: { index: false } };
  return {
    title: p.seo_title ?? `${p.name} from ${p.vendor_name}`,
    description: p.seo_description ?? p.short_description ?? `Order ${p.name} from ${p.vendor_name} on EAZyfoods.`,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: p.name, description: p.short_description ?? undefined, images: [p.images?.[0]?.url ?? '/img/food/meal.svg'] },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const d = await sget<{ product: any }>(`/products/${slug}`, { auth: true });
  if (!d?.product) notFound();
  const p = d.product;
  const rec = await sget<{ bought_together: any[]; similar: any[] }>(`/products/${slug}/recommendations`, { auth: true });
  const img = p.images?.[0]?.url ?? '/img/food/meal.svg';
  const minPrice = Math.min(...p.variants.map((v: any) => v.sale_price ?? v.price));
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.short_description ?? p.description, image: `${SITE}${img}`, sku: p.variants[0]?.sku, category: p.category_name,
    brand: p.brand_name ? { '@type': 'Brand', name: p.brand_name } : undefined,
    ...(p.rating_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating_avg, reviewCount: p.rating_count } } : {}),
    offers: { '@type': 'Offer', priceCurrency: 'CAD', price: minPrice, availability: p.variants.some((v: any) => v.available == null || v.available > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', seller: { '@type': 'Organization', name: p.vendor_name }, url: `${SITE}/p/${p.slug}` },
  };
  const crumbs = [{ n: 'Home', u: '/' }, { n: p.category_name, u: `/c/${p.category_slug}` }, { n: p.name, u: `/p/${p.slug}` }];
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.n, item: `${SITE}${c.u}` })) };
  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([ld, bc]) }} />
      <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href={`/c/${p.category_slug}`}>{p.category_name}</Link><span>/</span><span aria-current="page">{p.name}</span></nav>
      <div className="pdp">
        <div className="gallery"><img src={img} alt={p.images?.[0]?.alt ?? p.name} /></div>
        <div className="stack">
          <div>
            <div className="row wrap-row" style={{ '--gap': '6px' } as any}>{p.cuisine && <Badge>{p.cuisine}</Badge>}{p.product_type === 'chef_meal' && <Badge tone="warn">Home chef</Badge>}{(p.dietary ?? []).map((x: string) => <Badge key={x} tone="ok">{x}{p.dietary_verified?.includes(x) ? ' (verified)' : ''}</Badge>)}</div>
            <h1 style={{ margin: '10px 0 6px' }}>{p.name}</h1>
            <div className="row wrap-row small"><Stars value={p.rating_avg} count={p.rating_count || undefined} /><span className="muted">{t('product.soldBy')} <Link href={`/${p.seller_type === 'chef' ? 'chefs' : 'stores'}/${p.vendor_slug}`}>{p.vendor_name}</Link>, {p.vendor_city}</span></div>
          </div>
          {p.short_description && <p style={{ fontSize: '1.1rem' }}>{p.short_description}</p>}
          <PurchasePanel product={p} />
          {(p.dietary?.length > 0) && !p.dietary_verified?.length && <p className="small muted">{t('product.dietaryNote')}</p>}
          {p.allergens?.length > 0 && <div className="alert"><b>Allergens:</b> {p.allergens.map(label).join(', ')}</div>}
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 36, '--gap': '36px', alignItems: 'start' } as any}>
        <section aria-labelledby="det"><h2 id="det">Details</h2>
          {p.description && p.description !== p.short_description && <p>{p.description}</p>}
          <KV items={[['Origin', p.country_of_origin], ['Cuisine', p.cuisine], ['Unit', p.unit], ['Ingredients', p.ingredients_text], ['Storage', p.storage_instructions], ['Shelf life', p.shelf_life_days ? `${p.shelf_life_days} days` : null], ['Preparation time', p.prep_time_minutes ? `${p.prep_time_minutes} minutes` : null], ['Brand', p.brand_name]]} />
          {p.nutrition && <><h3>Nutrition</h3><KV items={Object.entries(p.nutrition).map(([k, v]) => [label(k), String(v)] as [string, string])} /></>}
          {p.recipes?.length > 0 && <><h3>Cook with this</h3><ul>{p.recipes.map((r: any) => <li key={r.slug}><Link href={`/articles/${r.slug}`}>{r.title}</Link></li>)}</ul></>}
        </section>
        <section aria-labelledby="rev"><h2 id="rev">Reviews</h2>
          {p.reviews?.length ? <div className="stack">{p.reviews.map((r: any) => <article key={r.id} className="card pad"><div className="row spread"><Stars value={r.rating} /><span className="tiny muted">{date(r.created_at)}</span></div>{r.title && <h4 style={{ marginTop: 8 }}>{r.title}</h4>}<p style={{ margin: '6px 0' }}>{r.body}</p><div className="small muted">{r.full_name}<Badge tone="ok"> Verified purchase</Badge></div>{r.vendor_response && <p className="small" style={{ borderLeft: '3px solid var(--line-strong)', paddingLeft: 10 }}><b>Response from {p.vendor_name}:</b> {r.vendor_response}</p>}</article>)}</div> : <p className="muted">No reviews yet. Reviews can only be left by customers who received this item.</p>}
        </section>
      </div>
      {rec?.bought_together?.length ? <section className="section" aria-label="Often bought together"><div className="section-head"><h2>{t('product.boughtTogether')}</h2></div><div className="rail fit">{rec.bought_together.slice(0, 4).map((x) => <ProductCard key={x.id} p={x} />)}</div></section> : null}
      {rec?.similar?.length ? <section className="section" aria-label="Similar items"><div className="section-head"><h2>Similar items</h2></div><div className="rail fit">{rec.similar.slice(0, 4).map((x) => <ProductCard key={x.id} p={x} />)}</div></section> : null}
    </div>
  );
}
void money;
