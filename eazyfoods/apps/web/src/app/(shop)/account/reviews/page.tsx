'use client';
import { Badge, Empty, Spinner, Stars } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { date } from '@/lib/format';
export default function Reviews() {
  const { data, loading } = useApi<any>('/customers/me/reviews');
  if (loading && !data) return <Spinner />;
  return (<div><h2>My reviews</h2>{!data?.reviews.length ? <Empty title="No reviews yet">After an order is delivered, you can review the store and your driver from the order page.</Empty> : <div className="stack">{data.reviews.map((r: any) => <article key={r.id} className="card pad"><div className="row spread"><Stars value={r.rating} /><span className="small muted">{date(r.created_at)} · <Badge status={r.status} /></span></div><p>{r.body}</p>{r.vendor_response && <p className="small"><b>Seller reply:</b> {r.vendor_response}</p>}</article>)}</div>}</div>);
}
