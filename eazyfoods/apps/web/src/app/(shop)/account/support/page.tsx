'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Btn, Empty, ErrorNote, Input, Modal, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { useApi, useStream } from '@/hooks/useApi';
import { get, post } from '@/lib/api';
import { dateTime, label } from '@/lib/format';

const CATS = [{ value: 'missing_items', label: 'Missing items' }, { value: 'incorrect_items', label: 'Wrong items' }, { value: 'late_delivery', label: 'Late delivery' }, { value: 'damaged', label: 'Damaged or spoiled' }, { value: 'payment_issue', label: 'Payment issue' }, { value: 'refund_request', label: 'Refund request' }, { value: 'vendor_complaint', label: 'Complaint about a seller' }, { value: 'driver_complaint', label: 'Complaint about a driver' }, { value: 'other', label: 'Something else' }];

function Thread({ id, onClose }: { id: string; onClose: () => void }) {
  const [t, setT] = useState<any>(null); const [body, setBody] = useState(''); const toast = useToast(); const [busy, setBusy] = useState(false);
  const load = () => get(`/tickets/${id}`).then((d) => setT({ ...d.ticket, messages: d.messages })).catch(() => {});
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useStream([], (type) => { if (type === 'ticket.message') load(); });
  return (
    <Modal title={t ? `${t.number}: ${t.subject}` : 'Loading'} onClose={onClose} wide footer={t && t.status !== 'closed' ? <form className="row" style={{ width: '100%', alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await post(`/tickets/${id}/messages`, { body }); setBody(''); load(); } catch (x: any) { toast(x.message, 'bad'); } finally { setBusy(false); } }}><div className="grow"><Textarea label="Reply" value={body} onChange={setBody} rows={2} /></div><Btn type="submit" variant="primary" busy={busy}>Send</Btn></form> : undefined}>
      {!t ? <Spinner /> : <div className="stack"><div className="row"><Badge status={t.status} /><Badge>{label(t.category)}</Badge></div>{t.messages?.filter((m: any) => !m.is_internal).map((m: any) => <div key={m.id} className="card pad" style={{ background: m.sender_role === 'customer' ? 'var(--paper-2)' : undefined }}><div className="small muted">{m.sender_role === 'customer' ? 'You' : 'EAZyfoods support'} · {dateTime(m.created_at)}</div><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}</div>}
    </Modal>
  );
}

function Inner() {
  const sp = useSearchParams(); const toast = useToast();
  const { data, error, loading, reload } = useApi<any>('/tickets');
  const [open, setOpen] = useState<string | null>(null); const [nw, setNw] = useState(!!sp.get('order'));
  const [f, setF] = useState({ category: 'other', subject: '', body: '' }); const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  if (loading && !data) return <Spinner />;
  return (
    <div><div className="row spread"><h2 style={{ margin: 0 }}>Help and support</h2><Btn variant="primary" onClick={() => setNw(true)}>New request</Btn></div>
      <p className="muted">Looking for quick answers? Read the <a href="/faq">FAQ</a>. For a problem with a delivered order, use “Report a problem” on the order page.</p>
      <ErrorNote error={error} retry={reload} />
      {data && !data.tickets.length && <Empty title="No support requests" />}
      <div className="stack" style={{ '--gap': '8px' } as any}>{data?.tickets.map((t: any) => <button key={t.id} className="card pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(t.id)}><div className="row spread wrap-row"><div><b>{t.number}</b> {t.subject}<div className="small muted">{dateTime(t.updated_at)}{t.order_number && <> · Order {t.order_number}</>}</div></div><Badge status={t.status} /></div></button>)}</div>
      {open && <Thread id={open} onClose={() => { setOpen(null); reload(); }} />}
      {nw && <Modal title="Contact support" onClose={() => setNw(false)} footer={<><Btn variant="secondary" onClick={() => setNw(false)}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => { setBusy(true); setErr(null); try { await post('/tickets', { ...f, orderId: sp.get('order') || undefined }); toast('Request sent. We reply in the app and by email.'); setNw(false); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Send</Btn></>}>
        <div className="stack"><ErrorNote error={err} />{sp.get('order') && <p className="alert">This request will be linked to your order.</p>}<Select label="Topic" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={CATS} /><Input label="Subject" value={f.subject} onChange={(v) => setF({ ...f, subject: v })} /><Textarea label="Message" value={f.body} onChange={(v) => setF({ ...f, body: v })} /></div></Modal>}
    </div>
  );
}
export default function Support() { return <Suspense><Inner /></Suspense>; }
