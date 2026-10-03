'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Btn } from './ui';
import { useCart } from './providers';
import { money } from '@/lib/format';

export function IngredientList({ items }: { items: any[] }) {
  const { add, setOpen } = useCart();
  const [busy, setBusy] = useState(false);
  const buyable = items.filter((i) => i.product?.default_variant_id && i.product.in_stock !== false);
  const total = buyable.reduce((s, i) => s + Number(i.product.price) * (i.quantity ?? 1), 0);
  return (
    <div className="card pad">
      <h3>Ingredients you can order</h3>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 10 }}>
        {items.map((i, k) => (
          <li key={k} className="row spread small"><span>{i.label}{i.product && <> · <Link href={`/p/${i.product.slug}`}>{i.product.name}</Link> <span className="muted">from {i.product.vendor_name}</span></>}</span><b>{i.product ? money(i.product.price) : ''}</b></li>
        ))}
      </ul>
      {buyable.length > 0 && <Btn variant="primary" block busy={busy} onClick={async () => { setBusy(true); let ok = true; for (const i of buyable) ok = (await add(i.product.default_variant_id, i.quantity ?? 1)) && ok; setBusy(false); if (ok) setOpen(true); }}>Add all to cart · {money(total)}</Btn>}
    </div>
  );
}
