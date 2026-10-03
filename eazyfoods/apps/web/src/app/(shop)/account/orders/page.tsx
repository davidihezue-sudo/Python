'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorNote, Pager, Spinner } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { dateTime, money, plural } from '@/lib/format';

export default function Orders() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/orders?page=${page}&limit=15`);
  if (loading && !data) return <Spinner />;
  return (
    <div><h2>Orders</h2><ErrorNote error={error} retry={reload} />
      {data && !data.orders.length && <Empty title="No orders yet" action={<Link className="btn primary" href="/search">Start shopping</Link>} />}
      <div className="stack" style={{ '--gap': '10px' } as any}>
        {data?.orders.map((o: any) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="card pad" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div className="row spread wrap-row"><div><b>{o.number}</b> <Badge status={o.status} /><div className="small muted">{dateTime(o.placed_at)} · {plural(o.item_count, 'item')} · {o.suborders?.map((s: any) => s.vendor).join(', ')}</div></div><b>{money(o.total)}</b></div>
          </Link>))}
      </div>
      <Pager page={page} pages={data?.orders.length === 15 ? page + 1 : page} onPage={setPage} />
    </div>
  );
}
