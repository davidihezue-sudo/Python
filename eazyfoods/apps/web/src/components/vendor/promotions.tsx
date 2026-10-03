'use client';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Check, ErrorNote, Input, KV, Modal, Select, Spinner, Table, Textarea, useToast } from '../ui';
import { post, put } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { dateTime, label, money } from '@/lib/format';

export const PROMO_TYPES = [{ value: 'percent', label: 'Percent off' }, { value: 'fixed', label: 'Amount off' }, { value: 'free_delivery', label: 'Free delivery' }, { value: 'bogo', label: 'Buy one get one' }, { value: 'spend_get', label: 'Spend X, get Y off' }, { value: 'first_order', label: 'First order only' }];
const toLocal = (d?: string | null) => (d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function PromotionForm({ initial, onClose, onSaved, save, extra }: { initial?: any; onClose: () => void; onSaved: () => void; save: (body: any, id?: string) => Promise<any>; extra?: (p: any, s: (k: string) => (v: any) => void) => React.ReactNode }) {
  const toast = useToast();
  const [p, setP] = useState<any>({ name: '', description: '', code: '', type: 'percent', value: '10', max_discount: '', min_order: '0', starts_at: '', ends_at: '', usage_limit: '', per_customer_limit: '', funded_by: 'vendor', stackable: false, auto_apply: false, status: 'draft', ...(initial ? { ...initial, code: initial.code ?? '', max_discount: initial.max_discount ?? '', usage_limit: initial.usage_limit ?? '', per_customer_limit: initial.per_customer_limit ?? '', starts_at: toLocal(initial.starts_at), ends_at: toLocal(initial.ends_at), description: initial.description ?? '' } : {}) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const s = (k: string) => (v: any) => setP((o: any) => ({ ...o, [k]: v }));
  const n = (v: any) => (v === '' || v == null ? null : Number(v)); const d = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <Modal title={initial?.id ? 'Edit promotion' : 'New promotion'} onClose={onClose} wide footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => {
      setBusy(true); setErr(null);
      try { await save({ name: p.name, description: p.description || null, code: p.code || null, type: p.type, value: Number(p.value) || 0, max_discount: n(p.max_discount), min_order: Number(p.min_order) || 0, starts_at: d(p.starts_at), ends_at: d(p.ends_at), usage_limit: n(p.usage_limit), per_customer_limit: n(p.per_customer_limit), funded_by: p.funded_by, stackable: !!p.stackable, auto_apply: !!p.auto_apply, status: p.status, scope: p.scope, segment_id: p.segment_id || null, priority: Number(p.priority) || 0, config: p.config ?? {} }, initial?.id); toast('Promotion saved'); onSaved(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
    }}>Save</Btn></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Input label="Name" value={p.name} onChange={s('name')} required full /><Textarea label="Description" value={p.description} onChange={s('description')} rows={2} full optional />
        <Select label="Type" value={p.type} onChange={s('type')} options={PROMO_TYPES} /><Input label={p.type === 'percent' || p.type === 'first_order' ? 'Percent off' : p.type === 'fixed' || p.type === 'spend_get' ? 'Amount off (CAD)' : 'Value'} type="number" min={0} step="0.01" value={p.value} onChange={s('value')} disabled={p.type === 'free_delivery' || p.type === 'bogo'} />
        <Input label="Code" value={p.code} onChange={s('code')} optional hint="Customers type this at checkout. Leave empty for an automatic offer." /><Input label="Minimum order (CAD)" type="number" min={0} value={p.min_order} onChange={s('min_order')} />
        <Input label="Maximum discount (CAD)" type="number" min={0} value={p.max_discount} onChange={s('max_discount')} optional /><Select label="Status" value={p.status} onChange={s('status')} options={['draft', 'active', 'paused', 'archived']} />
        <Input label="Starts" type="datetime-local" value={p.starts_at} onChange={s('starts_at')} optional /><Input label="Ends" type="datetime-local" value={p.ends_at} onChange={s('ends_at')} optional />
        <Input label="Total uses allowed" type="number" min={1} value={p.usage_limit} onChange={s('usage_limit')} optional /><Input label="Uses per customer" type="number" min={1} value={p.per_customer_limit} onChange={s('per_customer_limit')} optional />
        <Check label="Apply automatically when eligible" checked={!!p.auto_apply} onChange={s('auto_apply')} /><Check label="Can be combined with other offers" checked={!!p.stackable} onChange={s('stackable')} />
        {extra?.(p, s)}
      </div>
    </Modal>
  );
}

export function VendorPromotions() {
  const { vendorId } = useVendor(); const { data, error, loading, reload } = useApi<any>(`/vendors/${vendorId}/promotions`); const [edit, setEdit] = useState<any>(undefined); const [stats, setStats] = useState<any>(null);
  return (
    <>
      <PageHead title="Promotions" sub="Offers you fund yourself. They apply only to your products." actions={<Btn variant="primary" onClick={() => setEdit({})}>New promotion</Btn>} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Promotions" rows={data?.promotions ?? []} empty="No promotions yet." onRow={(r: any) => setEdit(r)} cols={[{ key: 'name', header: 'Promotion', render: (r: any) => <span><b>{r.name}</b><div className="tiny muted">{label(r.type)}{r.type === 'percent' ? ` ${r.value}%` : r.value ? ` ${money(r.value)}` : ''}{r.code ? ` · code ${r.code}` : ' · automatic'}</div></span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'dates', header: 'Runs', render: (r: any) => <span className="small">{r.starts_at ? dateTime(r.starts_at) : 'Now'}{r.ends_at ? ` to ${dateTime(r.ends_at)}` : ''}</span> }, { key: 'redemption_count', header: 'Used', align: 'right' }, { key: 's', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); setStats({ p: r, ...(await (await fetch(`/api/vendors/${vendorId}/promotions/${r.id}/stats`, { credentials: 'include' })).json()) }); }}>Results</Btn> }]} />}
      {edit !== undefined && <PromotionForm initial={edit.id ? edit : undefined} onClose={() => setEdit(undefined)} onSaved={reload} save={(body, id) => (id ? put(`/vendors/${vendorId}/promotions/${id}`, body) : post(`/vendors/${vendorId}/promotions`, body))} />}
      {stats && <Modal title={`Results: ${stats.p.name}`} onClose={() => setStats(null)}><KV items={[['Times used', stats.stats.redemptions], ['Discount given', money(stats.stats.discount_cost)], ['Order value with this offer', money(stats.stats.revenue)]]} /></Modal>}
    </>
  );
}
