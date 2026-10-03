'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { Badge, Btn, Check, Empty, Spinner } from '@/components/ui';
import { useApi, useStream } from '@/hooks/useApi';
import { post, put } from '@/lib/api';
import { relative } from '@/lib/format';

const KINDS = [['order_updates', 'Order updates'], ['promotions', 'Offers and promotions'], ['account', 'Account and security']];
export default function Notifications() {
  const { refresh, me } = useAuth();
  const n = useApi<any>('/notifications?limit=50'); const p = useApi<any>('/notifications/preferences');
  useStream([], (t) => { if (t === 'notification') { n.reload(); refresh(); } }, !!me?.user);
  useEffect(() => { /* opening the page does not mark everything read automatically */ }, []);
  if (n.loading && !n.data) return <Spinner />;
  const pref = (k: string) => p.data?.preferences.find((x: any) => x.kind === k) ?? { kind: k, email: true, sms: false, push: true };
  const setPref = async (k: string, patch: any) => { await put('/notifications/preferences', { ...pref(k), ...patch }); p.reload(); };
  return (
    <div className="stack" style={{ '--gap': '20px' } as any}>
      <div className="row spread"><h2 style={{ margin: 0 }}>Notifications {n.data?.unread > 0 && <Badge tone="warn">{n.data.unread} new</Badge>}</h2><Btn variant="secondary" size="sm" disabled={!n.data?.unread} onClick={async () => { await post('/notifications/read', {}); n.reload(); refresh(); }}>Mark all read</Btn></div>
      {!n.data?.notifications.length ? <Empty title="You are all caught up" /> : <div className="stack" style={{ '--gap': '8px' } as any}>{n.data.notifications.map((x: any) => <div key={x.id} className={`card pad ${x.read_at ? '' : 'ticket new'}`}><div className="row spread"><b>{x.title}</b><span className="small muted">{relative(x.created_at)}</span></div><p style={{ margin: '4px 0 0' }}>{x.body}</p>{x.data?.orderId && <Link href={`/orders/${x.data.orderId}`} className="small">View order</Link>}</div>)}</div>}
      <section className="card pad"><h3>How should we reach you?</h3>
        <div className="table-wrap"><table className="tbl"><thead><tr><th scope="col">Type</th><th scope="col">Email</th><th scope="col">Text message</th><th scope="col">Push</th></tr></thead><tbody>{KINDS.map(([k, l]) => <tr key={k}><th scope="row">{l}</th>{(['email', 'sms', 'push'] as const).map((ch) => <td key={ch}><Check label={<span className="sr-only">{l} by {ch}</span>} checked={!!pref(k)[ch]} onChange={(v) => setPref(k, { [ch]: v })} /></td>)}</tr>)}</tbody></table></div>
        <p className="hint">Security and payment receipts are always sent by email.</p></section>
    </div>
  );
}
