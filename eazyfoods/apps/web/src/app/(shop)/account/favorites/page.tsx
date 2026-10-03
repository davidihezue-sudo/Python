'use client';
import { useState } from 'react';
import { ProductCard, StoreCard } from '@/components/cards';
import { Btn, Empty, ErrorNote, Input, Spinner, Tabs, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { del, post } from '@/lib/api';

export default function Favorites() {
  const [tab, setTab] = useState('products'); const toast = useToast();
  const fav = useApi<any>('/customers/me/favorites'); const wl = useApi<any>('/customers/me/wishlists'); const rv = useApi<any>('/customers/me/recently-viewed');
  const [name, setName] = useState('');
  if (fav.loading && !fav.data) return <Spinner />;
  const asCard = (s: any) => ({ ...s, trading_name: s.trading_name, cuisines: [], accepts_delivery: false });
  return (
    <div><h2>Favourites and lists</h2><ErrorNote error={fav.error} retry={fav.reload} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'products', label: 'Products', count: fav.data?.products.length }, { key: 'stores', label: 'Stores and chefs', count: (fav.data?.stores.length ?? 0) + (fav.data?.chefs.length ?? 0) }, { key: 'lists', label: 'Lists', count: wl.data?.wishlists.length }, { key: 'recent', label: 'Recently viewed' }]} />
      {tab === 'products' && (fav.data?.products.length ? <div className="grid cols-3">{fav.data.products.map((p: any) => <ProductCard key={p.id} p={p} />)}</div> : <Empty title="No favourite products yet">Tap the heart on any product to save it here.</Empty>)}
      {tab === 'stores' && ([...(fav.data?.stores ?? []), ...(fav.data?.chefs ?? [])].length ? <div className="grid cols-3">{[...fav.data.stores, ...fav.data.chefs].map((s: any) => <StoreCard key={s.id} s={asCard(s)} />)}</div> : <Empty title="No favourite stores yet" />)}
      {tab === 'lists' && (<div className="stack">
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; try { await post('/customers/me/wishlists', { name }); setName(''); wl.reload(); } catch (x: any) { toast(x.message, 'bad'); } }}><div className="grow"><Input label="New list name" value={name} onChange={setName} maxLength={60} /></div><Btn type="submit">Create list</Btn></form>
        {wl.data?.wishlists.map((l: any) => <section key={l.id} className="card pad"><div className="row spread"><h3 style={{ margin: 0 }}>{l.name}</h3><Btn size="sm" variant="ghost" onClick={async () => { await del(`/customers/me/wishlists/${l.id}`); wl.reload(); }}>Delete list</Btn></div>{l.items.length ? <div className="grid cols-3" style={{ marginTop: 12 }}>{l.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div> : <p className="muted small">Empty. Add products from their pages.</p>}</section>)}
      </div>)}
      {tab === 'recent' && (rv.data?.items?.length ? <div className="grid cols-3">{rv.data.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div> : <Empty title="Nothing viewed yet" />)}
    </div>
  );
}
