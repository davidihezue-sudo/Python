'use client';
import { useState } from 'react';
import { Badge, Btn, Icon } from './ui';
import { FavButton } from './cards';
import { useCart } from './providers';
import { money } from '@/lib/format';

export function PurchasePanel({ product }: { product: any }) {
  const { add, busy, setOpen } = useCart();
  const variants: any[] = product.variants ?? [];
  const [vid, setVid] = useState(variants.find((v) => v.is_default)?.id ?? variants[0]?.id);
  const [qty, setQty] = useState(product.min_qty ?? 1);
  const v = variants.find((x) => x.id === vid);
  if (!v) return <p className="alert bad">This product is not available right now.</p>;
  const price = v.sale_price ?? v.price;
  const avail = v.available;
  const out = avail != null && avail <= 0;
  const max = Math.min(product.max_qty ?? 99, avail ?? 99);
  return (
    <div className="stack">
      <div className="row spread"><div><span className="price" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.9rem' }}>{money(price)}</span>{v.sale_price != null && <span className="muted" style={{ textDecoration: 'line-through', marginLeft: 10 }}>{money(v.price)}</span>}{v.sale_price != null && <> <Badge tone="bad">Sale</Badge></>}</div><div style={{ position: 'relative', width: 40, height: 40 }}><FavButton productId={product.id} /></div></div>
      {variants.length > 1 && (
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend className="label" style={{ padding: 0, marginBottom: 6 }}>Choose a size</legend>
          <div className="variant-pick" role="radiogroup">{variants.map((x) => <button key={x.id} role="radio" aria-checked={x.id === vid} className={x.id === vid ? 'on' : ''} disabled={x.available != null && x.available <= 0} onClick={() => setVid(x.id)}>{x.name} · {money(x.sale_price ?? x.price)}{x.available != null && x.available <= 0 ? ' (sold out)' : ''}</button>)}</div>
        </fieldset>)}
      {avail != null && avail > 0 && avail <= 5 && <p className="alert" role="status"><Icon name="alert" size={18} /> Only {avail} left in stock.</p>}
      {out ? <p className="alert bad"><Icon name="alert" size={18} /> Sold out. Check back soon or browse similar items.</p> : (
        <div className="row wrap-row">
          <div className="qty" role="group" aria-label="Quantity"><button onClick={() => setQty((q: number) => Math.max(product.min_qty ?? 1, q - 1))} aria-label="Decrease quantity">−</button><output aria-live="polite">{qty}</output><button onClick={() => setQty((q: number) => Math.min(max, q + 1))} aria-label="Increase quantity">+</button></div>
          <Btn variant="primary" size="lg" className="grow" busy={busy} onClick={async () => { if (await add(v.id, qty)) setOpen(true); }}>Add to cart · {money(price * qty)}</Btn>
        </div>)}
      <p className="small muted">Prices in CAD. Delivery fee, taxes and any discounts are calculated from your address before you pay.</p>
    </div>
  );
}
