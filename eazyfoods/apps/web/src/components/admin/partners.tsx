'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHead } from '../portal';
import { useAuth } from '../providers';
import { Badge, Btn, Check, ErrorNote, Input, KV, Modal, Pager, Select, Spinner, Stars, Table, Tabs, Textarea, useToast } from '../ui';
import { get, patch, post } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { date, dateTime, label, money } from '@/lib/format';

export function DocTable({ docs, onReview, canReview }: { docs: any[]; onReview?: (d: any, status: 'verified' | 'rejected') => void; canReview?: boolean }) {
  return <Table caption="Documents" rows={docs} empty="No documents." cols={[{ key: 'doc_type', header: 'Document', render: (d: any) => <span>{label(d.doc_type)}{d.owner_name && <div className="tiny muted">{label(d.owner_type)}: {d.owner_name}</div>}</span> }, { key: 'reference_number', header: 'Reference' }, { key: 'expiry_date', header: 'Expires', render: (d: any) => (d.expiry_date ? date(d.expiry_date) : '') }, { key: 'status', header: 'Status', render: (d: any) => <Badge status={d.status} /> },
    { key: 'file', header: 'File', render: (d: any) => (d.file_id ? <a href={`/api/files/${d.file_id}`} target="_blank" rel="noopener noreferrer">View {d.original_name ?? 'file'}</a> : <span className="muted small">No file</span>) },
    { key: 'a', header: '', render: (d: any) => (canReview && d.status === 'pending' ? <span className="row"><Btn size="sm" variant="leaf" onClick={() => onReview?.(d, 'verified')}>Verify</Btn><Btn size="sm" variant="danger-outline" onClick={() => onReview?.(d, 'rejected')}>Reject</Btn></span> : null) }]} />;
}

function useDocReview(reload: () => void) {
  const toast = useToast(); const [r, setR] = useState<any>(null); const [note, setNote] = useState('');
  const modal = r && (
    <Modal title={`${r.status === 'verified' ? 'Verify' : 'Reject'} ${label(r.d.doc_type)}`} onClose={() => setR(null)} footer={<><Btn variant="secondary" onClick={() => setR(null)}>Cancel</Btn><Btn variant={r.status === 'verified' ? 'leaf' : 'danger'} disabled={r.status === 'rejected' && note.length < 3} onClick={async () => { try { await post(`/admin/documents/${r.d.id}/review`, { status: r.status, note: note || undefined }); toast('Document updated'); setR(null); setNote(''); reload(); } catch (e: any) { toast(e.message, 'bad'); } }}>Confirm</Btn></>}>
      <Textarea label={r.status === 'rejected' ? 'Reason shown to the applicant' : 'Note (optional)'} value={note} onChange={setNote} /></Modal>);
  return { start: (d: any, status: 'verified' | 'rejected') => { setNote(''); setR({ d, status }); }, modal };
}

function VendorDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const { data, error, reload } = useApi<any>(`/admin/vendors/${id}`); const plans = useApi<any>('/admin/plans');
  const [note, setNote] = useState(''); const [comm, setComm] = useState<string | null>(null); const [plan, setPlan] = useState('');
  const dr = useDocReview(() => { reload(); onChanged(); });
  const v = data?.vendor;
  const act = async (action: string) => { try { await post(`/admin/vendors/${id}/review`, { action, note: note || undefined }); toast('Updated'); setNote(''); reload(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <Modal title={v?.trading_name ?? 'Vendor'} onClose={onClose} wide>
      <ErrorNote error={error} />
      {!v ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={v.verification_status} /><Badge>{label(v.seller_type)}</Badge>{v.is_featured && <Badge tone="ok">Featured</Badge>}<span className="small muted">{v.line1}, {v.city} {v.postal_code} · {v.email} · {v.phone}</span></div>
        <KV items={[['Legal name', v.legal_name], ['Tax number', v.tax_number], ['Orders', data.stats.orders], ['GMV', money(data.stats.gmv)], ['Rating', v.rating_avg], ['Commission override', v.commission_override_pct != null ? `${v.commission_override_pct}%` : 'Default rules'], ['Owner', data.team.find((t: any) => t.member_role === 'owner')?.email]]} />
        {v.verification_note && <p className="alert">Last note: {v.verification_note}</p>}
        <h3>Documents</h3>
        <DocTable docs={data.documents} canReview={can('compliance.manage')} onReview={dr.start} />
        <p className="small muted">Required: {data.requirements.filter((r: any) => r.required).map((r: any) => r.label).join(', ')}</p>
        {can('vendors.approve') && <section className="card pad stack"><h3>Review decision</h3><Textarea label="Note to the vendor" value={note} onChange={setNote} optional rows={2} />
          <div className="row wrap-row">{[['start_review', 'Start review'], ['request_info', 'Request changes'], ['approve', 'Approve'], ['reject', 'Reject'], ['suspend', 'Suspend'], ['reinstate', 'Reinstate']].map(([a, l]) => <Btn key={a} variant={a === 'approve' || a === 'reinstate' ? 'leaf' : a === 'reject' || a === 'suspend' ? 'danger-outline' : 'secondary'} size="sm" onClick={() => act(a)}>{l}</Btn>)}</div></section>}
        {can('vendors.manage') && <section className="card pad stack"><h3>Commercial settings</h3><div className="form-grid">
          <Input label="Commission override (%)" type="number" min={0} max={100} step="0.1" value={comm ?? v.commission_override_pct ?? ''} onChange={setComm} hint="Empty uses category and global rules." />
          <Select label="Plan" value={plan} onChange={setPlan} options={(plans.data?.plans ?? []).map((p: any) => ({ value: p.key, label: `${p.name} (${money(p.monthly_price)}/mo)` }))} placeholder="Keep current" /></div>
          <div className="row wrap-row"><Btn variant="secondary" onClick={async () => { try { await patch(`/admin/vendors/${id}`, { commission_override_pct: comm === '' ? null : comm != null ? Number(comm) : undefined }); toast('Saved'); reload(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } }}>Save commission</Btn>
            <Btn variant="secondary" disabled={!plan} onClick={async () => { await post('/admin/plans/assign', { vendor_id: id, plan_key: plan }); toast('Plan assigned'); }}>Assign plan</Btn>
            <Btn variant="secondary" onClick={async () => { await patch(`/admin/vendors/${id}`, { is_featured: !v.is_featured }); reload(); onChanged(); }}>{v.is_featured ? 'Remove featured' : 'Feature this seller'}</Btn></div></section>}
        <h3>History</h3><ul className="small">{data.history.map((h: any, i: number) => <li key={i}>{dateTime(h.created_at)}: {h.action} by {h.actor ?? 'system'}</li>)}</ul>
      </div>)}
      {dr.modal}
    </Modal>
  );
}

function VendorsInner() {
  const sp = useSearchParams(); const [status, setStatus] = useState(''); const [type, setType] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(sp.get('open')); const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/admin/vendors?page=${page}&limit=30${status ? `&status=${status}` : ''}${type ? `&type=${type}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHead title="Vendors and chefs" sub="Applications waiting for review appear first." />
      <div className="row wrap-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}><div style={{ minWidth: 220 }}><Input label="Search" value={q} onChange={(v) => { setQ(v); setPage(1); }} /></div><div style={{ width: 190 }}><Select label="Status" value={status} onChange={setStatus} options={['draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'suspended']} placeholder="All" /></div><div style={{ width: 170 }}><Select label="Type" value={type} onChange={setType} options={['grocery', 'specialty', 'prepared', 'chef']} placeholder="All" /></div></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Vendors" rows={data?.vendors ?? []} onRow={(r: any) => setOpen(r.id)} cols={[{ key: 'trading_name', header: 'Seller', render: (r: any) => <span><b>{r.trading_name}</b><div className="tiny muted">{r.legal_name}</div></span> }, { key: 'seller_type', header: 'Type', render: (r: any) => label(r.seller_type) }, { key: 'verification_status', header: 'Status', render: (r: any) => <Badge status={r.verification_status} /> }, { key: 'city', header: 'City' }, { key: 'products', header: 'Products', align: 'right' }, { key: 'pending_docs', header: 'Docs to review', align: 'right', render: (r: any) => (r.pending_docs ? <Badge tone="warn">{r.pending_docs}</Badge> : 0) }, { key: 'rating_avg', header: 'Rating', render: (r: any) => (r.rating_avg ? <Stars value={r.rating_avg} /> : '') }]} />}
      <Pager page={page} pages={data?.vendors?.length === 30 ? page + 1 : page} onPage={setPage} />
      {open && <VendorDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
export function AdminVendors() { return <Suspense><VendorsInner /></Suspense>; }

function DriverDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>(`/admin/drivers/${id}`); const [note, setNote] = useState('');
  const dr = useDocReview(() => { reload(); onChanged(); });
  const d = data?.driver;
  const act = async (action: string) => { try { await post(`/admin/drivers/${id}/review`, { action, note: note || undefined }); toast('Updated'); setNote(''); reload(); onChanged(); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <Modal title={d?.legal_name ?? 'Driver'} onClose={onClose} wide>
      <ErrorNote error={error} />
      {!d ? <Spinner /> : (<div className="stack">
        <div className="row wrap-row"><Badge status={d.verification_status} /><Badge>{label(d.availability)}</Badge></div>
        <KV items={[['Email', d.email], ['Phone', d.phone], ['Licence', d.licence_number], ['Licence expiry', d.licence_expiry ? date(d.licence_expiry) : ''], ['Rating', d.rating_avg], ['Deliveries', d.jobs_completed], ['Offers accepted', `${d.offers_accepted} of ${d.offers_received}`], ['Vehicles', data.vehicles.map((v: any) => `${label(v.vehicle_type)} ${v.make ?? ''} ${v.plate ?? ''}`).join(', ')]]} />
        <h3>Documents</h3><DocTable docs={data.documents} canReview={can('compliance.manage')} onReview={dr.start} />
        {can('drivers.approve') && <section className="card pad stack"><h3>Review decision</h3><Textarea label="Note to the driver" value={note} onChange={setNote} optional rows={2} /><div className="row wrap-row">{[['start_review', 'Start review'], ['request_documents', 'Request documents'], ['approve', 'Approve'], ['reject', 'Reject'], ['suspend', 'Suspend'], ['reactivate', 'Reactivate']].map(([a, l]) => <Btn key={a} size="sm" variant={a === 'approve' || a === 'reactivate' ? 'leaf' : a === 'reject' || a === 'suspend' ? 'danger-outline' : 'secondary'} onClick={() => act(a)}>{l}</Btn>)}</div></section>}
        <h3>Recent deliveries</h3><Table caption="Deliveries" rows={data.jobs} empty="None yet." cols={[{ key: 'number', header: 'Order' }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'distance_km', header: 'km', align: 'right' }, { key: 'driver_pay', header: 'Pay', align: 'right', render: (r: any) => money(r.driver_pay) }]} />
      </div>)}
      {dr.modal}
    </Modal>
  );
}
function DriversInner() {
  const sp = useSearchParams(); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(sp.get('open'));
  const { data, error, loading, reload } = useApi<any>(`/admin/drivers?limit=50${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHead title="Drivers" />
      <div className="row wrap-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}><div style={{ minWidth: 220 }}><Input label="Search" value={q} onChange={setQ} /></div><div style={{ width: 190 }}><Select label="Status" value={status} onChange={setStatus} options={['draft', 'submitted', 'under_review', 'needs_documents', 'approved', 'rejected', 'suspended']} placeholder="All" /></div></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Drivers" rows={data?.drivers ?? []} onRow={(r: any) => setOpen(r.id)} cols={[{ key: 'legal_name', header: 'Driver', render: (r: any) => <span><b>{r.legal_name}</b><div className="tiny muted">{r.email}</div></span> }, { key: 'verification_status', header: 'Status', render: (r: any) => <Badge status={r.verification_status} /> }, { key: 'availability', header: 'Now', render: (r: any) => label(r.availability) }, { key: 'vehicle', header: 'Vehicle', render: (r: any) => label(r.vehicle ?? '') }, { key: 'jobs_completed', header: 'Deliveries', align: 'right' }, { key: 'rating_avg', header: 'Rating', render: (r: any) => (r.rating_avg ? <Stars value={r.rating_avg} /> : '') }, { key: 'pending_docs', header: 'Docs to review', align: 'right', render: (r: any) => (r.pending_docs ? <Badge tone="warn">{r.pending_docs}</Badge> : 0) }]} />}
      {open && <DriverDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}
export function AdminDrivers() { return <Suspense><DriversInner /></Suspense>; }

export function AdminDocuments() {
  const { can } = useAuth(); const [status, setStatus] = useState('pending'); const { data, error, reload } = useApi<any>(`/admin/documents?status=${status}`, [status]); const dr = useDocReview(reload);
  return (
    <>
      <PageHead title="Document review" sub="Licences, certificates and insurance waiting for verification." />
      <Tabs value={status} onChange={setStatus} tabs={[{ key: 'pending', label: 'Waiting' }, { key: 'verified', label: 'Verified' }, { key: 'rejected', label: 'Rejected' }, { key: 'expired', label: 'Expired' }]} />
      <ErrorNote error={error} retry={reload} />
      <DocTable docs={data?.documents ?? []} canReview={can('compliance.manage')} onReview={dr.start} />{dr.modal}
    </>
  );
}

function CustomersInner() {
  const sp = useSearchParams(); const { can } = useAuth(); const toast = useToast(); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(sp.get('open')); const [reason, setReason] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/admin/customers?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`); const d = useApi<any>(open ? `/admin/customers/${open}` : null, [open]);
  return (
    <>
      <PageHead title="Customers" />
      <div style={{ maxWidth: 360, marginBottom: 12 }}><Input label="Search name, email or phone" value={q} onChange={setQ} /></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Customers" rows={data?.customers ?? []} onRow={(r: any) => setOpen(r.id)} cols={[{ key: 'full_name', header: 'Customer', render: (r: any) => <span><b>{r.full_name}</b><div className="tiny muted">{r.email}</div></span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'orders', header: 'Orders', align: 'right' }, { key: 'spend', header: 'Spend', align: 'right', render: (r: any) => money(r.spend) }, { key: 'open_risk', header: 'Risk', align: 'right', render: (r: any) => (r.open_risk ? <Badge tone="bad">{r.open_risk}</Badge> : 0) }, { key: 'last_login_at', header: 'Last login', render: (r: any) => (r.last_login_at ? dateTime(r.last_login_at) : 'Never') }]} />}
      {open && <Modal title={d.data?.customer.full_name ?? 'Customer'} onClose={() => setOpen(null)} wide>
        {!d.data ? <Spinner /> : <div className="stack">
          <KV items={[['Email', d.data.customer.email], ['Phone', d.data.customer.phone], ['Status', label(d.data.customer.status)], ['Joined', date(d.data.customer.created_at)], ['Orders', d.data.insights.orders], ['Lifetime spend', money(d.data.insights.spend)], ['Average order', money(d.data.insights.average_order_value)], ['Marketing opt-in', d.data.customer.marketing_opt_in ? 'Yes' : 'No']]} />
          {can('customers.suspend') && <div className="card pad stack">{d.data.customer.status === 'suspended' ? <Btn variant="leaf" onClick={async () => { await post(`/admin/users/${open}/reactivate`, {}); toast('Reactivated'); d.reload(); reload(); }}>Reactivate account</Btn> : <><Input label="Reason for suspension" value={reason} onChange={setReason} /><Btn variant="danger" disabled={reason.length < 3} onClick={async () => { try { await post(`/admin/users/${open}/suspend`, { reason }); toast('Suspended and signed out'); d.reload(); reload(); } catch (e: any) { toast(e.message, 'bad'); } }}>Suspend account</Btn></>}</div>}
          <h3>Orders</h3><Table caption="Orders" rows={d.data.orders} cols={[{ key: 'number', header: 'Order', render: (r: any) => <a href={`/admin/orders?open=${r.id}`}>{r.number}</a> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'total', header: 'Total', align: 'right', render: (r: any) => money(r.total) }]} />
          {d.data.risk.length > 0 && <><h3>Risk signals</h3>{d.data.risk.map((r: any) => <p key={r.id} className="alert">{label(r.signal_type ?? r.kind)}: {r.detail ?? r.reason} <Badge status={r.status} /></p>)}</>}
        </div>}</Modal>}
    </>
  );
}
export function AdminCustomers() { return <Suspense><CustomersInner /></Suspense>; }
void get; void Check;
