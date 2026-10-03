import Link from 'next/link';
import { sget } from '@/lib/server';
import { serverLoc } from '@/lib/loc';
import { ProductCard, StoreCard } from '@/components/cards';
import { AdCard } from '@/components/ad-slot';
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'African and multicultural food delivered', description: 'Order groceries, specialty foods and meals from African, Caribbean and multicultural stores and home chefs near you.', alternates: { canonical: '/' } };

const RAIL_TITLE: Record<string, [string, string]> = {
  trending: ['Trending near you', 'What people are ordering right now.'], deals: ['Deals this week', 'Real price drops from our stores.'], prepared: ['Ready to eat', 'Hot meals from kitchens and home chefs.'],
  recommended: ['Picked for you', 'Based on what you browse and order.'], new_arrivals: ['New arrivals', 'Fresh on the shelves.'],
};

function Section({ title, subtitle, href, children }: { title: string; subtitle?: string | null; href?: string; children: React.ReactNode }) {
  return (
    <section className="section wrap" aria-label={title}>
      <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{href && <Link href={href}>{t('common.viewAll')}</Link>}</div>
      {children}
    </section>
  );
}

export default async function Home() {
  const loc = await serverLoc();
  const data = await sget<{ sections: any[] }>(`/home${loc ? `?lat=${loc.lat}&lng=${loc.lng}` : ''}`, { auth: true });
  const sections = data?.sections ?? [];
  if (!sections.length) return <div className="wrap"><div className="empty"><h1>We are getting the kitchen ready</h1><p>The catalogue could not be loaded right now. Please try again in a moment.</p></div></div>;
  const ld = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'EAZyfoods', url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000', potentialAction: { '@type': 'SearchAction', target: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {sections.map((s) => {
        const d = s.data ?? {};
        switch (s.kind) {
          case 'hero': return d.ads?.[0] ? <div className="wrap" key={s.id}><AdCard ad={d.ads[0]} hero /></div> : <div className="wrap" key={s.id}><section className="hero"><img src="/img/food/hero-lagos.svg" alt="" /><div className="copy"><span className="eyebrow">African and multicultural food</span><h1>{t('brand.tagline')}</h1></div></section></div>;
          case 'search': return (
            <section className="section wrap" key={s.id} aria-label="Search">
              <form action="/search" className="row" role="search" style={{ maxWidth: 720, margin: '0 auto' }}>
                <label htmlFor="home-q" className="sr-only">{t('nav.search')}</label>
                <input id="home-q" name="q" className="input" style={{ minHeight: 54, fontSize: '1.05rem' }} placeholder="Try egusi, injera, suya, plantain" />
                <button className="btn primary lg" type="submit">Search</button>
              </form>
            </section>);
          case 'shop_modes': return (
            <section className="section wrap" key={s.id}><h2 className="sr-only">{s.title}</h2>
              <div className="modes">
                <Link href="/search?type=dry,fresh,frozen" className="mode-card"><div style={{ padding: 20 }}><span className="eyebrow">Groceries</span><h2 style={{ margin: '4px 0' }}>{t('home.shopGroceries')}</h2><p className="muted" style={{ margin: 0 }}>{t('home.shopGroceriesSub')}</p></div><img src="/img/food/produce.svg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></Link>
                <Link href="/search?type=chef_meal,prepared" className="mode-card"><div style={{ padding: 20 }}><span className="eyebrow">Meals</span><h2 style={{ margin: '4px 0' }}>{t('home.shopMeals')}</h2><p className="muted" style={{ margin: 0 }}>{t('home.shopMealsSub')}</p></div><img src="/img/food/platter.svg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></Link>
              </div>
            </section>);
          case 'category_rail': return (
            <Section key={s.id} title={s.title ?? 'Shop by category'} href="/search">
              <div className="rail" style={{ gridAutoColumns: '130px' }}>{(d.categories ?? []).map((c: any) => <Link key={c.id} className="cat-tile" href={`/c/${c.slug}`}><img src={c.image_url ?? '/img/food/grains.svg'} alt="" loading="lazy" /><span>{c.name}</span></Link>)}</div>
            </Section>);
          case 'product_rail': {
            const [title, sub] = RAIL_TITLE[d.source] ?? [s.title ?? 'Products', s.subtitle];
            if (!d.items?.length) return null;
            return <Section key={s.id} title={s.title ?? title} subtitle={s.subtitle ?? sub} href={d.source === 'prepared' ? '/search?type=chef_meal,prepared' : '/search'}><div className="rail fit">{d.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div></Section>;
          }
          case 'chef_rail': return d.items?.length ? <Section key={s.id} title={s.title ?? 'Home chefs'} subtitle="Independent cooks, small batches." href="/chefs"><div className="rail fit">{d.items.map((c: any) => <StoreCard key={c.id} s={c} />)}</div></Section> : null;
          case 'vendor_rail': return d.items?.length ? <Section key={s.id} title={s.title ?? 'Local stores'} href="/stores"><div className="rail fit">{d.items.map((c: any) => <StoreCard key={c.id} s={c} />)}</div></Section> : null;
          case 'banner': return d.ads?.length ? <section className="section wrap" key={s.id} aria-label="Featured"><div className="modes">{d.ads.slice(0, 2).map((a: any) => <AdCard key={a.id} ad={a} />)}</div></section> : null;
          case 'collection': return d.items?.length ? <Section key={s.id} title={d.collection?.title ?? s.title ?? 'Collection'} subtitle={d.collection?.description} href={`/collections/${d.collection?.slug}`}><div className="rail fit">{d.items.slice(0, 4).map((p: any) => <ProductCard key={p.id} p={p} />)}</div></Section> : null;
          case 'cuisine_grid': case 'country_grid': return d.items?.length ? (
            <Section key={s.id} title={s.title ?? (s.kind === 'cuisine_grid' ? 'Explore cuisines' : 'Shop by country')}>
              <div className="grid cols-4" style={{ '--gap': '10px' } as any}>{d.items.map((c: any) => <Link key={c.name} className="word-tile" href={s.kind === 'cuisine_grid' ? `/cuisine/${encodeURIComponent(c.name)}` : `/search?country=${encodeURIComponent(c.name)}`}><span>{c.name}</span><span className="muted small">{c.n}</span></Link>)}</div>
            </Section>) : null;
          case 'editorial': return d.articles?.length ? (
            <Section key={s.id} title={s.title ?? 'Stories and recipes'} href="/recipes">
              <div className="grid cols-4">{d.articles.map((a: any) => <Link key={a.slug} href={`/articles/${a.slug}`} className="store-card"><div className="cover"><img src={a.hero_image ?? '/img/food/platter.svg'} alt="" loading="lazy" /></div><div className="body"><span className="eyebrow">{a.kind}</span><h3 style={{ margin: 0 }}>{a.title}</h3><p className="small muted" style={{ margin: 0 }}>{a.excerpt}</p></div></Link>)}</div>
            </Section>) : null;
          default: return null;
        }
      })}
    </>
  );
}
