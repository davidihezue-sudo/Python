'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart } from './providers';
import { AddressModal } from './address-form';
import { Summary } from './cart-view';
import { Badge, Btn, Empty, ErrorNote, Input, Spinner, Textarea } from './ui';
import { api, get, post } from '@/lib/api';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';

const TEST_CARDS = [
  { token: 'tok_visa', label: 'Visa ending 4242', note: 'Succeeds' }, { token: 'tok_mastercard', label: 'Mastercard ending 4444', note: 'Succeeds' }, { token: 'tok_amex', label: 'Amex ending 8431', note: 'Succeeds' },
  { token: 'tok_declined', label: 'Visa ending 0002', note: 'Declined' }, { token: 'tok_insufficient_funds', label: 'Visa ending 9995', note: 'Insufficient funds' },
];

export function CheckoutFlow() {
  const router = useRouter();
  const { me, ready } = useAuth();
  const { cart, options, refresh } = useCart();
  const [cfg, setCfg] = useState<any>(null);
  const [addrs, setAddrs] = useState<any[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [token, setToken] = useState('tok_visa');
  const [contact, setContact] = useState({ name: '', phone: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const idem = useRef<string>('');
  useEffect(() => {
    try { idem.current = sessionStorage.getItem('ez_idem') ?? ''; if (!idem.current) { idem.current = crypto.randomUUID(); sessionStorage.setItem('ez_idem', idem.current); } } catch { idem.current = crypto.randomUUID(); }
    get('/config').then(setCfg).catch(() => {});
  }, []);
  useEffect(() => { if (ready && !me?.user) router.replace('/login?next=/checkout'); }, [ready, me?.user, router]);
  useEffect(() => { if (me?.user) { setContact({ name: me.user.full_name ?? '', phone: me.user.phone ?? '' }); get('/customers/me/addresses').then((d) => { setAddrs(d.addresses ?? []); }); } }, [me?.user]);
  useEffect(() => { // if no address is chosen yet, default to the saved default
    if (cart && !cart.options?.addressId && addrs.length) options({ addressId: (addrs.find((a) => a.is_default) ?? addrs[0]).id });
  }, [cart?.options?.addressId, addrs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !cart) return <div className="wrap center" style={{ padding: 60 }}><Spinner /></div>;
  const q = cart.quote;
  if (!q?.groups?.length) return <div className="wrap"><Empty title={t('cart.empty')} action={<Link className="btn primary" href="/search">Start shopping</Link>} /></div>;
  const opt = cart.options ?? {};
  const needsAddr = q.groups.some((g: any) => g.mode === 'delivery');
  const total = q.totals.amountDue ?? q.totals.total;
  const test = cfg?.payments?.mode !== 'live';

  const place = async () => {
    setBusy(true); setErr(null);
    try {
      let orderId = pendingOrder;
      if (orderId) { await post(`/orders/${orderId}/pay`, { paymentToken: token }); }
      else {
        const r = await post('/checkout', { idempotencyKey: idem.current, paymentToken: token, expectedTotal: q.totals.total, contact: { name: contact.name || undefined, phone: contact.phone || undefined }, note: note || undefined });
        orderId = r.orderId;
      }
      try { sessionStorage.removeItem('ez_idem'); } catch { /* ignore */ }
      await refresh();
      router.push(`/orders/${orderId}?placed=1`);
    } catch (e: any) {
      if (e.code === 'PAYMENT_FAILED' && e.details?.orderId) setPendingOrder(e.details.orderId);
      if (e.code === 'QUOTE_CHANGED') await refresh();
      setErr(e);
    } finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <h1 style={{ margin: '22px 0 6px' }}>{t('checkout.title')}</h1>
      <ol className="steps" aria-label="Checkout steps"><li className="done"><Link href="/cart">Cart</Link></li><li className="on" aria-current="step">Details and payment</li><li>Confirmation</li></ol>
      <div className="cart-layout">
        <div className="stack">
          {err && <div className="alert bad" role="alert"><div><b>{err.code === 'PAYMENT_FAILED' ? 'Payment did not go through' : err.code === 'QUOTE_CHANGED' ? 'Your total changed' : 'We could not place your order'}</b><div>{err.message}{err.details?.reason ? ` (${err.details.reason})` : ''}</div>{err.code === 'QUOTE_CHANGED' && <div>The new total is {money(total)}. Review it and place your order again.</div>}{err.code === 'PAYMENT_FAILED' && <div className="small">Your items are held for a short time. Choose another card and try again.</div>}</div></div>}
          {q.blockers?.length > 0 && <div className="alert bad" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{q.blockers.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul><Link href="/cart">Back to cart</Link></div>}
          {needsAddr && (
            <section className="card pad" aria-labelledby="c-addr"><div className="row spread"><h2 id="c-addr" style={{ fontSize: '1.15rem', margin: 0 }}>{t('checkout.address')}</h2><Btn size="sm" variant="secondary" onClick={() => setAddrOpen(true)}>Add new</Btn></div>
              <div className="stack" style={{ marginTop: 12, '--gap': '8px' } as any}>
                {addrs.map((a) => <label key={a.id} className="choice"><input type="radio" name="addr" checked={opt.addressId === a.id} onChange={() => options({ addressId: a.id })} /><span><b>{a.label ?? 'Address'}</b> {a.is_default && <Badge>Default</Badge>}<br /><span className="small muted">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postal_code}</span>{a.instructions && <><br /><span className="small">Note: {a.instructions}</span></>}</span></label>)}
                {!addrs.length && <p className="muted">Add a delivery address to continue.</p>}
              </div>
            </section>)}
          <section className="card pad" aria-labelledby="c-fulf"><h2 id="c-fulf" style={{ fontSize: '1.15rem' }}>{t('checkout.fulfillment')}</h2>
            <div className="stack" style={{ '--gap': '10px' } as any}>{q.groups.map((g: any) => <div key={g.vendorId} className="row spread wrap-row small"><span><b>{g.vendorName}</b> · {g.mode === 'delivery' ? 'Delivery' : 'Pickup'}</span><span className="muted">{g.scheduledFor ? `Scheduled ${new Date(g.scheduledFor).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}` : g.etaAt ? `Around ${new Date(g.etaAt).toLocaleTimeString('en-CA', { timeStyle: 'short' })}` : ''} · {money(g.customerTotal)}</span></div>)}</div>
            {q.groups.length > 1 && <p className="hint" style={{ marginTop: 10 }}>Your order is split into {q.groups.length} orders, one per seller. Each is prepared and delivered separately and you can track them together.</p>}
          </section>
          <section className="card pad" aria-labelledby="c-contact"><h2 id="c-contact" style={{ fontSize: '1.15rem' }}>Contact</h2>
            <div className="form-grid"><Input label="Name" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} autoComplete="name" /><Input label="Phone" type="tel" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} autoComplete="tel" hint="The driver or store may call if there is a problem." /><Textarea label="Note for the seller" value={note} onChange={setNote} full optional rows={2} maxLength={300} /></div>
          </section>
          <section className="card pad" aria-labelledby="c-pay"><h2 id="c-pay" style={{ fontSize: '1.15rem' }}>{t('checkout.payment')}</h2>
            {test ? (<>
              <p className="test-banner" role="note">{t('checkout.testBanner')}</p>
              <div className="stack" style={{ marginTop: 12, '--gap': '8px' } as any} role="radiogroup" aria-label="Test card">{TEST_CARDS.map((c) => <label key={c.token} className="choice"><input type="radio" name="card" checked={token === c.token} onChange={() => setToken(c.token)} /><span className="grow"><b>{c.label}</b></span><Badge tone={c.note === 'Succeeds' ? 'ok' : 'bad'}>{c.note}</Badge></label>)}</div>
            </>) : <div className="alert warn">Live card entry is provided by the payment processor&apos;s hosted fields. Configure the processor keys to enable it.</div>}
          </section>
        </div>
        <Summary q={q}>
          <Btn variant="primary" size="lg" block busy={busy} disabled={!q.canCheckout || (needsAddr && !opt.addressId)} onClick={place} style={{ marginTop: 14 }}>{busy ? t('checkout.paying') : `${t('checkout.placeOrder')} · ${money(total)}`}</Btn>
          <p className="hint">By placing your order you agree to the terms. {test ? 'No real money moves in test mode.' : ''}</p>
        </Summary>
      </div>
      {addrOpen && <AddressModal onClose={() => setAddrOpen(false)} onSaved={(a) => { setAddrs((x) => [a, ...x]); options({ addressId: a.id }); }} />}
    </div>
  );
}
void api; void ErrorNote;
