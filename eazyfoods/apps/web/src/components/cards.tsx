'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth, useCart } from './providers';
import { Badge, Btn, Icon, Stars, useToast } from './ui';
import { api } from '@/lib/api';
import { money, km } from '@/lib/format';

export function FavButton({ productId, vendorId, chef, initial = false }: { productId?: string; vendorId?: string; chef?: boolean; initial?: boolean }) {
  const { me } = useAuth();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  return (
    <button className="fav" aria-pressed={on} aria-label={on ? 'Remove from favourites' : 'Save to favourites'} onClick={async (e) => {
      e.preventDefault();
      if (!me?.user) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; return; }
      const next = !on; setOn(next);
      try { await api('/customers/me/favorites', { method: 'PUT', body: productId ? { type: 'product', id: productId, on: next } : { type: vendorId && chef ? 'chef' : 'vendor', id: vendorId, on: next } }); } catch (er: any) { setOn(!next); toast(er.message, 'bad'); }
    }}><Icon name="heart" size={18} /></button>
  );
}

export function AddToCart({ variantId, name, disabled, size }: { variantId: string; name: string; disabled?: boolean; size?: 'sm' }) {
  const { add, busy } = useCart();
  return <Btn variant="primary" size={size ?? 'sm'} disabled={disabled || busy} onClick={() => add(variantId, 1)} aria-label={`Add ${name} to cart`}><Icon name="plus" size={16} />Add</Btn>;
}

export function ProductCard({ p, sponsored }: { p: any; sponsored?: boolean }) {
  const onSale = p.compare_price && Number(p.compare_price) > Number(p.price);
  const outOfStock = p.in_stock === false;
  return (
    <article className="product-card">
      <div className="tags">{sponsored && <Badge>Sponsored</Badge>}{onSale && <Badge tone="bad">Sale</Badge>}{p.product_type === 'chef_meal' && <Badge tone="warn">Home chef</Badge>}</div>
      <FavButton productId={p.id} />
      <Link href={`/p/${p.slug}`} className="media" tabIndex={-1} aria-hidden="true"><img src={p.image_url ?? '/img/food/meal.svg'} alt="" loading="lazy" /></Link>
      <div className="body">
        <h3><Link href={`/p/${p.slug}`}>{p.name}</Link></h3>
        <div className="small muted">{p.vendor_name}{p.distance_km != null && <> · {km(p.distance_km)}</>}</div>
        <Stars value={p.rating_avg} count={p.rating_count || undefined} />
        <div className="foot">
          <div className="price">{p.variant_count > 1 && <span className="small muted" style={{ fontWeight: 500 }}>From </span>}{money(p.price)}{onSale && <span className="was">{money(p.compare_price)}</span>}</div>
          {outOfStock ? <Badge tone="bad">Sold out</Badge> : p.variant_count > 1 ? <Link className="btn sm secondary" href={`/p/${p.slug}`}>Choose</Link> : p.default_variant_id ? <AddToCart variantId={p.default_variant_id} name={p.name} /> : null}
        </div>
      </div>
    </article>
  );
}

export function StoreCard({ s }: { s: any }) {
  const chef = s.seller_type === 'chef';
  return (
    <Link href={`/${chef ? 'chefs' : 'stores'}/${s.slug}`} className="store-card">
      <div className="cover"><img src={s.cover_url ?? '/img/food/cover-market.svg'} alt="" loading="lazy" /></div>
      <div className="body">
        <img className="logo-img" src={s.logo_url ?? '/img/brand/logo-default.svg'} alt="" />
        <h3 style={{ margin: 0 }}>{chef && s.chef_name ? s.chef_name : s.trading_name}</h3>
        <div className="small muted">{chef ? 'Home chef' : s.seller_type === 'prepared' ? 'Prepared food' : s.seller_type === 'specialty' ? 'Specialty store' : 'Grocery'} · {s.city}{s.distance_km != null && <> · {km(s.distance_km)}</>}</div>
        <Stars value={s.rating_avg} count={s.rating_count || undefined} />
        <div className="small">{(s.cuisines ?? []).slice(0, 3).join(', ')}</div>
        <div className="row wrap-row" style={{ '--gap': '6px' } as any}>{s.accepts_delivery && <Badge>Delivery</Badge>}{s.accepts_pickup && <Badge>Pickup</Badge>}{s.min_order > 0 && <span className="tiny muted">Min {money(s.min_order)}</span>}</div>
      </div>
    </Link>
  );
}
