'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Bars, ErrorNote, HBars, Spinner, Stat, Table } from '../ui';
import { useApi, useStream } from '@/hooks/useApi';
import { label, money } from '@/lib/format';

export function VendorDashboard() {
  const { vendorId, base, membership, chef } = useVendor();
  const a = useApi<any>(`/vendors/${vendorId}/analytics?days=30`); const o = useApi<any>(`/vendors/${vendorId}/orders?group=new&limit=10`); const inv = useApi<any>(`/vendors/${vendorId}/inventory`);
  const [live, setLive] = useState<string | null>(null);
  useStream([`vendor:${vendorId}`], (t, d) => { if (t === 'order.new') { setLive(`New order ${d.number}`); o.reload(); a.reload(); } if (t === 'suborder.status') o.reload(); if (t === 'low_inventory') inv.reload(); });
  const d = a.data;
  const low = (inv.data?.items ?? []).filter((i: any) => i.tracks_inventory && i.available <= i.reorder_threshold).slice(0, 6);
  return (
    <>
      <PageHead title={membership.trading_name} sub={`${chef ? 'Chef' : label(membership.seller_type)} dashboard. Last 30 days.`} actions={<Link className="btn primary" href={`${base}/orders`}>Open orders</Link>} />
      {live && <div className="alert ok" role="status" style={{ marginBottom: 14 }}><b>{live}</b> <Link href={`${base}/orders`}>View</Link></div>}
      <ErrorNote error={a.error} retry={a.reload} />
      {!d ? <Spinner /> : (<>
        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <Stat label="Waiting for you" value={d.today.pending} hint={`${d.today.preparing} preparing, ${d.today.ready} ready`} />
          <Stat label="Sales today" value={money(d.today.sales)} />
          <Stat label="Sales (30 days)" value={money(d.sales.period)} hint={`${money(d.sales.net_after_fees)} after commission`} />
          <Stat label="Orders (30 days)" value={d.orders} hint={`Average ${money(d.average_order_value)}`} />
        </div>
        <section className="card pad" style={{ marginBottom: 20 }}><h2 style={{ fontSize: '1.15rem' }}>Sales per day</h2><Bars data={d.series.map((s: any) => ({ label: s.day, value: s.sales }))} format={money} /></section>
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>New orders</h2>
            <Table caption="New orders" rows={o.data?.orders ?? []} empty="No new orders right now." cols={[{ key: 'number', header: 'Order', render: (r: any) => <Link href={`${base}/orders`}>{r.number}</Link> }, { key: 'summary', header: 'Items', render: (r: any) => <span className="small">{r.summary}</span> }, { key: 'net', header: 'You earn', align: 'right', render: (r: any) => money(r.vendor_net) }]} /></section>
          <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Low stock</h2>
            {low.length ? <Table caption="Low stock" rows={low} cols={[{ key: 'product_name', header: 'Product', render: (r: any) => <Link href={`${base}/inventory`}>{r.product_name} ({r.variant_name})</Link> }, { key: 'available', header: 'Available', align: 'right' }, { key: 'reorder_threshold', header: 'Reorder at', align: 'right' }]} /> : <p className="muted">Stock levels look healthy.</p>}</section>
          <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Best sellers</h2><HBars data={d.best_products.slice(0, 6).map((p: any) => ({ label: p.name, value: p.revenue }))} format={money} /></section>
          <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Funnel</h2>
            <HBars data={[{ label: 'Product views', value: d.conversion.views }, { label: 'Added to cart', value: d.conversion.add_to_cart }, { label: 'Orders', value: d.conversion.orders }]} />
            <p className="small muted">{d.conversion.view_to_order_pct}% of views became orders. Cancellation rate {d.cancellation_rate}%, refund rate {d.refund_rate}%.</p></section>
        </div>
      </>)}
    </>
  );
}
