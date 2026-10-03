import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { sget } from '@/lib/server';
import { SearchListing } from './search-listing';
import { FavButton } from './cards';
import { Badge, Stars, KV } from './ui';
import { date, money } from '@/lib/format';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function storefrontMeta(slug: string, chef: boolean) {
  const d = await sget<any>(`/${chef ? 'chefs' : 'stores'}/${slug}`, { revalidate: 30 });
  const s = d?.store ?? d?.chef;
  if (!s) return { title: 'Not found', robots: { index: false } };
  return { title: s.trading_name, description: (s.description ?? '').slice(0, 155), alternates: { canonical: `/${chef ? 'chefs' : 'stores'}/${slug}` }, openGraph: { images: [s.cover_url ?? '/img/food/cover-market.svg'] } };
}

export async function Storefront({ slug, chef }: { slug: string; chef: boolean }) {
  const d = await sget<any>(`/${chef ? 'chefs' : 'stores'}/${slug}`, { auth: true });
  const s = d?.store ?? d?.chef;
  if (!s) notFound();
  const ld = { '@context': 'https://schema.org', '@type': chef ? 'Person' : 'GroceryStore', name: s.trading_name, description: s.description, image: `${SITE}${s.cover_url ?? ''}`, address: { '@type': 'PostalAddress', addressLocality: s.city, addressRegion: s.region, addressCountry: 'CA' }, ...(s.rating_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.rating_avg, reviewCount: s.rating_count } } : {}) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="wrap" style={{ marginTop: 18 }}>
        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--card)' }}>
          <img src={s.cover_url ?? '/img/food/cover-market.svg'} alt="" style={{ width: '100%', height: 200, objectFit: 'cover' }} />
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 18, alignItems: 'center' }}>
            <img src={s.logo_url ?? '/img/brand/logo-default.svg'} alt="" width={72} height={72} style={{ borderRadius: 14, width: 72, height: 72 }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 'clamp(1.5rem,1rem+2vw,2.2rem)' }}>{s.trading_name}</h1>
              <div className="row wrap-row small" style={{ '--gap': '8px' } as any}><Stars value={s.rating_avg} count={s.rating_count || undefined} /><span className="muted">{s.city}, {s.region}</span>{s.open_now ? <Badge tone="ok">Open now</Badge> : <Badge tone="warn">Closed: {s.open_reason}</Badge>}{!s.accepting_orders && <Badge tone="bad">Not taking orders</Badge>}</div>
            </div>
            <div style={{ position: 'relative', width: 40, height: 40 }}><FavButton vendorId={s.id} chef={chef} /></div>
          </div>
        </div>
        <div className="grid cols-3" style={{ marginTop: 18, alignItems: 'start' }}>
          <div className="card pad" style={{ gridColumn: 'span 2' }}>
            <h2 style={{ fontSize: '1.2rem' }}>About</h2>
            <p>{s.description}</p>
            {chef && s.chef && <><p>{s.chef.bio}</p>{s.chef.specialties?.length > 0 && <p><b>Specialties:</b> {s.chef.specialties.join(', ')}</p>}<p className="small muted">Cooks {s.chef.operating_days?.map((n: number) => DAYS[n].slice(0, 3)).join(', ')}. Up to {s.chef.daily_capacity} portions a day{s.chef.portions_accepting ? '' : '. Not accepting portions right now'}.</p></>}
            <div className="row wrap-row" style={{ '--gap': '8px' } as any}>{(s.cuisines ?? []).map((c: string) => <Badge key={c}>{c}</Badge>)}{s.accepts_delivery && <Badge tone="ok">Delivery</Badge>}{s.accepts_pickup && <Badge tone="ok">Pickup</Badge>}</div>
            {s.promotions?.length > 0 && <div className="stack" style={{ marginTop: 14, '--gap': '8px' } as any}>{s.promotions.map((p: any, i: number) => <div key={i} className="alert"><b>{p.name}</b> {p.description}</div>)}</div>}
          </div>
          <div className="card pad">
            <h2 style={{ fontSize: '1.2rem' }}>Delivery and hours</h2>
            <KV items={[['Minimum order', s.min_order > 0 ? money(s.min_order) : 'None'], ['Prep time', `About ${s.default_prep_minutes} minutes`], ['Address', s.accepts_pickup ? `${s.line1}, ${s.city} ${s.postal_code}` : null], ['Phone', s.phone]]} />
            {s.zones?.length > 0 && <><h3 style={{ marginTop: 12 }}>Delivery areas</h3><ul className="small" style={{ paddingLeft: 18 }}>{s.zones.map((z: any, i: number) => <li key={i}>{z.name}: {z.fee_model === 'flat' ? `${money(z.base_fee)} flat` : `${money(z.base_fee)} + ${money(z.per_km_fee)}/km`}{z.free_over ? `, free over ${money(z.free_over)}` : ''}</li>)}</ul></>}
            <details style={{ marginTop: 10 }}><summary className="bold small" style={{ cursor: 'pointer' }}>Opening hours</summary><ul className="small" style={{ paddingLeft: 18 }}>{(s.hours ?? []).map((h: any) => <li key={h.weekday}>{DAYS[h.weekday]}: {h.is_closed ? 'Closed' : `${h.opens} to ${h.closes}`}</li>)}</ul></details>
          </div>
        </div>
      </div>
      <Suspense><SearchListing fixed={{ vendor: s.slug }} title={chef ? 'On the menu' : 'Shop this store'} /></Suspense>
      <section className="wrap section" aria-labelledby="sr"><h2 id="sr">Reviews</h2>
        {s.reviews?.length ? <div className="grid cols-2">{s.reviews.slice(0, 6).map((r: any) => <article key={r.id} className="card pad"><div className="row spread"><Stars value={r.rating} /><span className="tiny muted">{date(r.created_at)}</span></div><p style={{ margin: '8px 0' }}>{r.body}</p><div className="small muted">{r.full_name}</div>{r.vendor_response && <p className="small" style={{ borderLeft: '3px solid var(--line-strong)', paddingLeft: 10 }}><b>Reply:</b> {r.vendor_response}</p>}</article>)}</div> : <p className="muted">No reviews yet.</p>}
      </section>
    </>
  );
}
