'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PageHead } from '../portal';
import { useAuth } from '../providers';
import { Badge, Btn, Check, ErrorNote, Input, KV, Modal, Select, Spinner, Table, Tabs, Textarea, useToast } from '../ui';
import { get, patch, post } from '@/lib/api';
import { useApi, useStream } from '@/hooks/useApi';
import { dateTime, label, money, relative } from '@/lib/format';

function Ticket({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const { me } = useAuth(); const [d, setD] = useState<any>(null); const [body, setBody] = useState(''); const [internal, setInternal] = useState(false); const [busy, setBusy] = useState(false);
  const load = () => get(`/tickets/${id}`).then(setD).catch(() => {}); const agents = useApi<any>('/support/agents');
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useStream(['admin'], (t) => { if (t === 'ticket.message') load(); });
  const t = d?.ticket;
  const upd = async (b: any) => { try { await patch(`/tickets/${id}`, b); toast('Updated'); load(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <Modal title={t ? `${t.number}: ${t.subject}` : 'Ticket'} onClose={onClose} wide footer={t && t.status !== 'closed' ? <form className="stack" style={{ width: '100%' }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); try { await post(`/tickets/${id}/messages`, { body, internal }); setBody(''); load(); onChanged(); } catch (x: any) { toast(x.message, 'bad'); } finally { setBusy(false); } }}><Textarea label={internal ? 'Internal note (customer cannot see this)' : 'Reply to customer'} value={body} onChange={setBody} rows={3} /><div className="row spread"><Check label="Internal note" checked={internal} onChange={setInternal} /><Btn type="submit" variant="primary" busy={busy}>{internal ? 'Save note' : 'Send reply'}</Btn></div></form> : undefined}>
      {!t ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={t.status} /><Badge>{label(t.category)}</Badge><Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'bad' : ''}>{label(t.priority)}</Badge><span className="small muted">From {t.requester_name}{t.order_number && <> · Order <a href={`/admin/orders`}>{t.order_number}</a></>}</span></div>
        <div className="row wrap-row" style={{ alignItems: 'flex-end' }}><div style={{ width: 180 }}><Select label="Status" value={t.status} onChange={(v) => upd({ status: v })} options={['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'resolved', 'closed']} /></div><div style={{ width: 150 }}><Select label="Priority" value={t.priority} onChange={(v) => upd({ priority: v })} options={['low', 'normal', 'high', 'urgent']} /></div><div style={{ width: 220 }}><Select label="Assigned to" value={t.assigned_to ?? ''} onChange={(v) => upd({ assigned_to: v || null })} options={(agents.data?.agents ?? []).map((a: any) => ({ value: a.id, label: a.full_name }))} placeholder="Unassigned" /></div><Btn variant="ghost" onClick={() => upd({ assigned_to: me?.user.id })}>Assign to me</Btn></div>
        {d.messages.map((m: any) => <div key={m.id} className="card pad" style={{ background: m.is_internal ? 'var(--saffron-soft)' : m.sender_role === 'customer' ? 'var(--paper-2)' : undefined }}><div className="small muted">{m.sender_name ?? label(m.sender_role)} · {dateTime(m.created_at)}{m.is_internal && ' · internal'}</div><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}
      </div>)}
    </Modal>
  );
}

function Dispute({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const { can } = useAuth(); const { data, reload } = useApi<any>(`/disputes/${id}`);
  const [resolution, setResolution] = useState('partial_refund'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [bearer, setBearer] = useState('platform'); const [delivery, setDelivery] = useState(false); const [busy, setBusy] = useState(false);
  const d = data?.dispute;
  return (
    <Modal title={d ? `Dispute on ${data.suborder.number}` : 'Dispute'} onClose={onClose} wide>
      {!d ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={d.status} /><Badge>{label(d.category ?? 'other')}</Badge><span className="small muted">Opened {dateTime(d.created_at)} · {data.suborder.vendor}</span></div>
        <p className="alert"><b>Customer:</b> {d.reason}</p>{d.vendor_response && <p className="alert"><b>Seller response:</b> {d.vendor_response}</p>}
        <KV items={[['Delivery', data.delivery ? `${label(data.delivery.status)}${data.delivery.proof ? ', proof recorded' : ''}` : 'No delivery job'], ['Customer total', money(data.suborder.customer_total)], ['Claimed amount', d.claimed_amount ? money(d.claimed_amount) : '']]} />
        <Table caption="Items" rows={data.items} cols={[{ key: 'name', header: 'Item' }, { key: 'quantity', header: 'Qty', align: 'right' }, { key: 'refunded_qty', header: 'Refunded', align: 'right' }, { key: 'line_subtotal', header: 'Amount', align: 'right', render: (i: any) => money(i.line_subtotal) }]} />
        {data.refunds.length > 0 && <p className="small">Already refunded: {data.refunds.map((r: any) => `${money(r.amount)} (${r.bearer})`).join(', ')}</p>}
        {['open', 'waiting_vendor', 'under_review'].includes(d.status) && can('disputes.resolve') && <section className="card pad stack"><h3>Resolve</h3>
          <div className="form-grid"><Select label="Resolution" value={resolution} onChange={setResolution} options={[{ value: 'full_refund', label: 'Full refund' }, { value: 'partial_refund', label: 'Partial refund' }, { value: 'replacement', label: 'Replacement' }, { value: 'vendor_credit', label: 'Store credit funded by seller' }, { value: 'customer_credit', label: 'Goodwill store credit' }, { value: 'no_refund', label: 'No refund' }]} />
            {['partial_refund', 'vendor_credit', 'customer_credit'].includes(resolution) && <Input label="Amount (CAD)" type="number" step="0.01" min={0.01} value={amount} onChange={setAmount} />}
            {['full_refund', 'partial_refund'].includes(resolution) && <Select label="Who bears the cost?" value={bearer} onChange={setBearer} options={[{ value: 'platform', label: 'Platform' }, { value: 'vendor', label: 'Seller' }]} />}
            {resolution === 'full_refund' && <Check label="Include delivery fee" checked={delivery} onChange={setDelivery} />}
            <Textarea label="Decision and reason (the customer sees this)" value={reason} onChange={setReason} full /></div>
          <Btn variant="primary" busy={busy} disabled={reason.trim().length < 3} onClick={async () => { setBusy(true); try { await post(`/disputes/${id}/resolve`, { resolution, reason, ...(amount ? { amount: Number(amount) } : {}), ...(['full_refund', 'partial_refund'].includes(resolution) ? { bearer } : {}), includeDelivery: delivery }); toast('Dispute resolved'); reload(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>Resolve dispute</Btn></section>}
        {d.resolution && <p className="alert ok">Resolved: {label(d.resolution)}. {d.resolution_note}</p>}
      </div>)}
    </Modal>
  );
}

function Inner() {
  const sp = useSearchParams(); const [tab, setTab] = useState('tickets'); const [status, setStatus] = useState('open,in_progress,waiting_customer,waiting_vendor'); const [assigned, setAssigned] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(sp.get('open')); const [dis, setDis] = useState<string | null>(null);
  const t = useApi<any>(`/tickets?scope=all&limit=50&status=${status}${assigned ? `&assigned=${assigned}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`); const d = useApi<any>('/disputes?status=');
  useStream(['admin'], (ty) => { if (ty === 'ticket.new' || ty === 'ticket.message') t.reload(); });
  return (
    <>
      <PageHead title="Support and disputes" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'tickets', label: 'Tickets', count: t.data?.tickets.length }, { key: 'disputes', label: 'Disputes', count: d.data?.disputes.filter((x: any) => ['open', 'waiting_vendor', 'under_review'].includes(x.status)).length }]} />
      {tab === 'tickets' ? (<>
        <div className="row wrap-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}><div style={{ minWidth: 220 }}><Input label="Search" value={q} onChange={setQ} /></div><div style={{ width: 200 }}><Select label="Show" value={status} onChange={setStatus} options={[{ value: 'open,in_progress,waiting_customer,waiting_vendor', label: 'Needs attention' }, { value: 'resolved,closed', label: 'Resolved and closed' }, { value: 'open,in_progress,waiting_customer,waiting_vendor,resolved,closed', label: 'Everything' }]} /></div><div style={{ width: 180 }}><Select label="Assignment" value={assigned} onChange={setAssigned} options={[{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }]} placeholder="Anyone" /></div></div>
        <ErrorNote error={t.error} retry={t.reload} />
        <Table caption="Tickets" rows={t.data?.tickets ?? []} onRow={(r: any) => setOpen(r.id)} cols={[{ key: 'number', header: 'Ticket', render: (r: any) => <b>{r.number}</b> }, { key: 'subject', header: 'Subject', render: (r: any) => <span>{r.subject}<div className="tiny muted">{r.requester}{r.order_number && ` · ${r.order_number}`}</div></span> }, { key: 'category', header: 'Topic', render: (r: any) => label(r.category) }, { key: 'priority', header: 'Priority', render: (r: any) => <Badge tone={['high', 'urgent'].includes(r.priority) ? 'bad' : ''}>{r.priority}</Badge> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'assignee', header: 'Assigned', render: (r: any) => r.assignee ?? <span className="muted">Unassigned</span> }, { key: 'updated_at', header: 'Updated', render: (r: any) => relative(r.updated_at) }]} /></>
      ) : (<Table caption="Disputes" rows={d.data?.disputes ?? []} onRow={(r: any) => setDis(r.id)} cols={[{ key: 'suborder_number', header: 'Order', render: (r: any) => <b>{r.suborder_number}</b> }, { key: 'customer', header: 'Customer' }, { key: 'vendor', header: 'Seller' }, { key: 'category', header: 'Issue', render: (r: any) => label(r.category ?? 'other') }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'customer_total', header: 'Order value', align: 'right', render: (r: any) => money(r.customer_total) }, { key: 'created_at', header: 'Opened', render: (r: any) => relative(r.created_at) }]} />)}
      {open && <Ticket id={open} onClose={() => setOpen(null)} onChanged={t.reload} />}
      {dis && <Dispute id={dis} onClose={() => setDis(null)} onChanged={d.reload} />}
    </>
  );
}
export function AdminSupport() { return <Suspense><Inner /></Suspense>; }

export function AdminRisk() {
  const { can } = useAuth(); const toast = useToast(); const [status, setStatus] = useState('open'); const { data, error, reload } = useApi<any>(`/admin/risk?status=${status}`, [status]); const [r, setR] = useState<any>(null); const [note, setNote] = useState('');
  return (
    <>
      <PageHead title="Risk signals" sub="Signals are for human review. Nothing here blocks a customer automatically." />
      <Tabs value={status} onChange={setStatus} tabs={[{ key: 'open', label: 'Open' }, { key: 'reviewed,dismissed,actioned', label: 'Closed' }]} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Risk signals" rows={data?.signals ?? []} empty="No signals." onRow={(x: any) => { setR(x); setNote(''); }} cols={[{ key: 'severity', header: 'Severity', render: (x: any) => <Badge status={x.severity} /> }, { key: 'kind', header: 'Signal', render: (x: any) => label(x.signal_type ?? x.kind ?? '') }, { key: 'subject_name', header: 'Subject', render: (x: any) => <span>{x.subject_name}<div className="tiny muted">{label(x.subject_type)}</div></span> }, { key: 'detail', header: 'Detail', render: (x: any) => <span className="small">{x.detail ?? x.reason ?? JSON.stringify(x.evidence ?? {}).slice(0, 80)}</span> }, { key: 'status', header: 'Status', render: (x: any) => <Badge status={x.status} /> }, { key: 'created_at', header: 'Raised', render: (x: any) => dateTime(x.created_at) }]} />
      {r && <Modal title="Review risk signal" onClose={() => setR(null)} footer={can('fraud.manage') ? <><Btn variant="secondary" onClick={async () => { await post(`/admin/risk/${r.id}/review`, { status: 'dismissed', note }); toast('Dismissed'); setR(null); reload(); }}>Dismiss (false alarm)</Btn><Btn variant="secondary" onClick={async () => { await post(`/admin/risk/${r.id}/review`, { status: 'reviewed', note }); toast('Marked reviewed'); setR(null); reload(); }}>Reviewed, no action</Btn><Btn variant="danger" onClick={async () => { await post(`/admin/risk/${r.id}/review`, { status: 'actioned', note }); toast('Actioned'); setR(null); reload(); }}>Action taken</Btn></> : undefined}>
        <div className="stack"><KV items={[['Severity', label(r.severity)], ['Subject', `${r.subject_name ?? ''} (${r.subject_type})`], ['Raised', dateTime(r.created_at)]]} /><pre className="json">{JSON.stringify(r.evidence ?? r.details ?? r, null, 2)}</pre><Textarea label="Review note" value={note} onChange={setNote} optional /></div></Modal>}
    </>
  );
}
