'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth, useCart } from './providers';
import { Badge, Btn, Empty, Icon, Input, Select, Spinner } from './ui';
import { get } from '@/lib/api';
import { money, dateTime } from '@/lib/format';
import { t } from '@/lib/i18n';

export function Summary({ q, children }: { q: any; children?: React.ReactNode }) {
  const tot = q.totals;
  return (
    <aside className="card pad summary" aria-label="Order summary">
      <h2 style={{ fontSize: '1.2rem' }}>Order summary</h2>
      <dl>
        <div><dt>{t('common.subtotal')}</dt><dd>{money(tot.subtotal)}</dd></div>
        {tot.discount > 0 && <div><dt>{t('common.discount')}</dt><dd style={{ color: 'var(--ok)' }}>−{money(tot.discount)}</dd></div>}
        <div><dt>{t('common.delivery')}</dt><dd>{tot.deliveryFee > 0 ? money(tot.deliveryFee) : q.groups.some((g: any) => g.mode === 'delivery' && g.delivery?.available) ? t('common.free') : '–'}</dd></div>
        {tot.serviceFee > 0 && <div><dt>{t('common.serviceFee')}</dt><dd>{money(tot.serviceFee)}</dd></div>}
        <div><dt>{t('common.tax')}</dt><dd>{money(tot.tax)}</dd></div>
        {tot.tip > 0 && <div><dt>{t('common.tip')}</dt><dd>{money(tot.tip)}</dd></div>}
        {tot.creditApplied > 0 && <div><dt>Store credit</dt><dd>−{money(tot.creditApplied)}</dd></div>}
        <div className="total"><dt>{tot.creditApplied > 0 ? 'To pay' : t('common.total')}</dt><dd>{money(tot.amountDue ?? tot.total)}</dd></div>
      </dl>
      <p className="hint" style={{ marginTop: 10 }}>{t('checkout.noHiddenFees')}</p>
      {children}
    </aside>
  );
}

export function CartView() {
  const { cart, setQty, options, busy, refresh } = useCart();
  const { me } = useAuth();
  const [addrs, setAddrs] = useState<any[]>([]);
  const [coupon, setCoupon] = useState('');
  const [credit, setCredit] = useState<any>(null);
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (me?.user) { get('/customers/me/addresses').then((d) => setAddrs(d.addresses ?? [])).catch(() => {}); get('/customers/me/loyalty').then(setCredit).catch(() => {}); } }, [me?.user]);
  if (!cart) return <div className="wrap center" style={{ padding: 60 }}><Spinner /></div>;
  const q = cart.quote;
  if (!q || !q.groups?.length) return <div className="wrap"><Empty title={t('cart.empty')} action={<Link className="btn primary" href="/search">Start shopping</Link>}>{t('cart.emptySub')}</Empty></div>;
  const opt = cart.options ?? {};
  const setFulfil = (vendorId: string, patch: any) => options({ fulfillment: { ...(opt.fulfillment ?? {}), [vendorId]: { mode: 'delivery', ...(opt.fulfillment?.[vendorId] ?? {}), ...patch } } });
  const hasDelivery = q.groups.some((g: any) => g.mode === 'delivery');
  return (
    <div className="wrap">
      <h1 style={{ margin: '22px 0 16px' }}>{t('cart.title')}</h1>
      <div className="cart-layout">
        <div className="stack">
          {q.blockers?.length > 0 && <div className="alert bad" role="alert"><Icon name="alert" /><ul style={{ margin: 0, paddingLeft: 18 }}>{q.blockers.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul></div>}
          {q.warnings?.length > 0 && <div className="alert" role="status"><Icon name="info" /><ul style={{ margin: 0, paddingLeft: 18 }}>{q.warnings.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul></div>}
          {q.groups.map((g: any) => (
            <section key={g.vendorId} className="card cart-group" aria-label={g.vendorName}>
              <header>
                <div><Link href={`/stores/${g.vendorSlug}`} className="bold">{g.vendorName}</Link><div className="small muted">Ready in about {g.prepMinutes} min{g.etaAt && <> · {g.mode === 'delivery' ? 'arrives' : 'ready'} around {new Date(g.etaAt).toLocaleTimeString('en-CA', { timeStyle: 'short' })}</>}</div></div>
                <div className="row" role="radiogroup" aria-label={`${g.vendorName} fulfilment`}>
                  {(['delivery', 'pickup'] as const).map((m) => <button key={m} role="radio" aria-checked={g.mode === m} className={`chip ${g.mode === m ? 'on' : ''}`} onClick={() => setFulfil(g.vendorId, { mode: m })}>{m === 'delivery' ? t('common.delivery') : t('common.pickup')}</button>)}
                </div>
              </header>
              {g.lines.map((l: any) => (
                <div key={l.variantId} className="line-item">
                  <img src={l.imageUrl ?? '/img/food/meal.svg'} alt="" />
                  <div><span className="bold">{l.name}</span><div className="small muted">{l.variantName}</div>{l.listPrice > l.unitPrice && <div className="small" style={{ color: 'var(--ok)' }}>Sale price applied</div>}{l.available != null && l.available < l.qty && <div className="error-text">Only {l.available} available</div>}</div>
                  <div className="right"><div className="qty" role="group" aria-label={`Quantity for ${l.name}`}><button disabled={busy} onClick={() => setQty(l.variantId, l.qty - 1)} aria-label="Decrease">−</button><output>{l.qty}</output><button disabled={busy} onClick={() => setQty(l.variantId, l.qty + 1)} aria-label="Increase">+</button></div><div className="bold" style={{ marginTop: 6 }}>{money(l.lineSubtotal)}</div><button className="btn sm ghost" onClick={() => setQty(l.variantId, 0)}>Remove</button></div>
                </div>
              ))}
              <div style={{ padding: '12px 18px', display: 'grid', gap: 8, background: 'var(--paper)' }}>
                <div className="row spread small"><span>Items</span><b>{money(g.itemsSubtotal)}</b></div>
                {g.mode === 'delivery' && <div className="row spread small"><span>{g.delivery?.available ? `Delivery${g.delivery.zoneName ? ` (${g.delivery.zoneName})` : ''}` : 'Delivery'}</span><b>{g.delivery?.available ? (g.deliveryFee > 0 ? money(g.deliveryFee) : t('common.free')) : <span className="muted" style={{ fontWeight: 400 }}>{g.delivery?.reason}</span>}</b></div>}
                {g.minOrderShortfall > 0 && <p className="error-text" style={{ margin: 0 }}>Add {money(g.minOrderShortfall)} more to reach this store&apos;s minimum order.</p>}
                <details><summary className="small bold" style={{ cursor: 'pointer' }}>Schedule for later{g.scheduledFor ? `: ${dateTime(g.scheduledFor)}` : ''}</summary>
                  <div className="row wrap-row" style={{ marginTop: 8, alignItems: 'flex-end' }}><Input label="Date and time" type="datetime-local" value={opt.fulfillment?.[g.vendorId]?.scheduledFor ? new Date(new Date(opt.fulfillment[g.vendorId].scheduledFor).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(v) => setFulfil(g.vendorId, { scheduledFor: v ? new Date(v).toISOString() : null })} />{g.scheduledFor && <Btn size="sm" variant="ghost" onClick={() => setFulfil(g.vendorId, { scheduledFor: null })}>Order now instead</Btn>}</div>
                </details>
              </div>
            </section>))}
          {hasDelivery && (
            <section className="card pad" aria-labelledby="addr"><h2 id="addr" style={{ fontSize: '1.15rem' }}>Delivery address</h2>
              {!me?.user ? <p>Sign in to choose an address and see exact delivery fees. <Link href="/login?next=/cart">Sign in</Link> or <Link href="/register?next=/cart">create an account</Link>.</p> : addrs.length ? (
                <div className="stack" style={{ '--gap': '8px' } as any}>{addrs.map((a) => <label key={a.id} className="choice"><input type="radio" name="addr" checked={opt.addressId === a.id} onChange={() => options({ addressId: a.id })} /><span><b>{a.label ?? 'Address'}</b><br /><span className="small muted">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postal_code}</span></span></label>)}</div>
              ) : <p>You have no saved addresses. <Link href="/account/addresses?next=/cart">Add one</Link> to see delivery options.</p>}
              {me?.user && <p className="small"><Link href="/account/addresses?next=/cart">Manage addresses</Link></p>}
            </section>)}
        </div>
        <div className="stack">
          <Summary q={q}>
            <div className="stack" style={{ marginTop: 14 }}>
              <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); if (coupon.trim()) { options({ couponCodes: [...(opt.couponCodes ?? []), coupon.trim().toUpperCase()] }); setCoupon(''); } }}>
                <div className="grow"><Input label={t('cart.promo')} value={coupon} onChange={setCoupon} placeholder="WELCOME10" /></div><Btn type="submit" variant="secondary">{t('cart.applyCode')}</Btn>
              </form>
              {(opt.couponCodes ?? []).map((c: string) => <div key={c} className="row spread small"><Badge tone="ok">{c}</Badge><button className="btn sm ghost" onClick={() => options({ couponCodes: opt.couponCodes.filter((x: string) => x !== c) })}>Remove</button></div>)}
              {q.rejectedCoupons?.map((r: any, i: number) => <p key={i} className="error-text" style={{ margin: 0 }}>{r.code}: {r.reason}</p>)}
              {q.appliedPromotions?.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{q.appliedPromotions.map((p: any, i: number) => <li key={i}>{p.name}: −{money(p.amount)}</li>)}</ul>}
              {hasDelivery && <fieldset><legend>{t('common.tip')} for your driver</legend><div className="row wrap-row" style={{ '--gap': '6px' } as any}>{[0, 2, 4, 6].map((v) => <button key={v} className={`chip ${Number(opt.tip ?? 0) === v ? 'on' : ''}`} aria-pressed={Number(opt.tip ?? 0) === v} onClick={() => options({ tip: v })}>{v === 0 ? 'No tip' : money(v)}</button>)}</div><p className="hint">100% of the tip goes to the driver.</p></fieldset>}
              {credit && Number(credit.status?.storeCredit ?? 0) > 0 && <label className="check"><input type="checkbox" checked={!!opt.useCredit} onChange={(e) => options({ useCredit: e.target.checked })} /><span>Use store credit ({money(credit.status.storeCredit)} available)</span></label>}
              {me?.user ? <Link className={`btn primary lg block ${q.canCheckout ? '' : ''}`} aria-disabled={!q.canCheckout} href={q.canCheckout ? '/checkout' : '#'} onClick={(e) => { if (!q.canCheckout) e.preventDefault(); }}>{t('cart.checkout')}</Link> : <Link className="btn primary lg block" href="/login?next=/checkout">Sign in to check out</Link>}
              {!q.canCheckout && <p className="hint">Resolve the items above to continue.</p>}
            </div>
          </Summary>
        </div>
      </div>
    </div>
  );
}
