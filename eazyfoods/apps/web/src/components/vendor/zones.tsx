'use client';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Check, Confirm, ErrorNote, Input, Modal, Select, Spinner, Table, Textarea, useToast } from '../ui';
import { del, post, put } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';

export function ZoneForm({ initial, onClose, onSaved, save }: { initial?: any; onClose: () => void; onSaved: () => void; save: (b: any, id?: string) => Promise<any> }) {
  const toast = useToast();
  const [z, setZ] = useState<any>({ name: '', zone_type: 'radius', radius_km: '10', center_lat: '', center_lng: '', postal_prefixes: '', polygon: '', fee_model: 'distance', base_fee: '3.99', per_km_fee: '0.60', free_over: '', min_order: '0', max_distance_km: '', priority: '0', is_active: true, ...(initial ? { ...initial, postal_prefixes: (initial.postal_prefixes ?? []).join(', '), polygon: initial.polygon ? JSON.stringify(initial.polygon) : '', free_over: initial.free_over ?? '', max_distance_km: initial.max_distance_km ?? '', center_lat: initial.center_lat ?? '', center_lng: initial.center_lng ?? '', radius_km: initial.radius_km ?? '' } : {}) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null); const s = (k: string) => (v: any) => setZ((o: any) => ({ ...o, [k]: v })); const n = (v: any) => (v === '' || v == null ? null : Number(v));
  return (
    <Modal title={initial?.id ? 'Edit delivery zone' : 'New delivery zone'} onClose={onClose} wide footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async () => {
      setBusy(true); setErr(null);
      try { let polygon = null; if (z.zone_type === 'polygon') { try { polygon = JSON.parse(z.polygon); } catch { throw Object.assign(new Error('The boundary must be a JSON list of [lat, lng] pairs.'), {}); } }
        await save({ name: z.name, zone_type: z.zone_type, center_lat: n(z.center_lat), center_lng: n(z.center_lng), radius_km: z.zone_type === 'radius' ? n(z.radius_km) : null, postal_prefixes: String(z.postal_prefixes).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), polygon, fee_model: z.fee_model, base_fee: Number(z.base_fee) || 0, per_km_fee: Number(z.per_km_fee) || 0, free_over: n(z.free_over), min_order: Number(z.min_order) || 0, max_distance_km: n(z.max_distance_km), priority: Number(z.priority) || 0, is_active: !!z.is_active }, initial?.id); toast('Zone saved'); onSaved(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
    }}>Save zone</Btn></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Input label="Zone name" value={z.name} onChange={s('name')} required /><Select label="Zone type" value={z.zone_type} onChange={s('zone_type')} options={[{ value: 'radius', label: 'Radius around a point' }, { value: 'postal', label: 'Postal code prefixes' }, { value: 'polygon', label: 'Custom boundary' }]} />
        {z.zone_type === 'radius' && <><Input label="Radius (km)" type="number" step="0.5" min={0.5} value={z.radius_km} onChange={s('radius_km')} /><div className="hint" style={{ alignSelf: 'center' }}>Centred on your store address unless you set a centre below.</div><Input label="Centre latitude" value={z.center_lat} onChange={s('center_lat')} optional /><Input label="Centre longitude" value={z.center_lng} onChange={s('center_lng')} optional /></>}
        {z.zone_type === 'postal' && <Input label="Postal code prefixes" value={z.postal_prefixes} onChange={s('postal_prefixes')} hint="First 3 characters, comma separated. For example M5R, M6H, M4W" full />}
        {z.zone_type === 'polygon' && <Textarea label="Boundary as [lat, lng] pairs" value={z.polygon} onChange={s('polygon')} hint="Example: [[43.6,-79.5],[43.7,-79.5],[43.7,-79.3]]" full />}
        <Select label="Fee model" value={z.fee_model} onChange={s('fee_model')} options={[{ value: 'flat', label: 'Flat fee' }, { value: 'distance', label: 'Base fee plus per km' }]} /><Input label="Base fee (CAD)" type="number" step="0.01" min={0} value={z.base_fee} onChange={s('base_fee')} />
        {z.fee_model === 'distance' && <Input label="Per km fee (CAD)" type="number" step="0.01" min={0} value={z.per_km_fee} onChange={s('per_km_fee')} />}<Input label="Free delivery over (CAD)" type="number" min={0} value={z.free_over} onChange={s('free_over')} optional />
        <Input label="Minimum order in this zone (CAD)" type="number" min={0} value={z.min_order} onChange={s('min_order')} /><Input label="Maximum distance (km)" type="number" min={0.5} value={z.max_distance_km} onChange={s('max_distance_km')} optional />
        <Check label="Zone is active" checked={!!z.is_active} onChange={s('is_active')} />
      </div>
    </Modal>
  );
}

export function VendorZones() {
  const { vendorId } = useVendor(); const { data, error, loading, reload } = useApi<any>(`/vendors/${vendorId}/zones`); const [edit, setEdit] = useState<any>(undefined); const [rm, setRm] = useState<any>(null);
  return (
    <>
      <PageHead title="Delivery zones" sub="Where you deliver with your own drivers, and what you charge. Platform driver delivery fees are set by EAZyfoods and shown at checkout." actions={<Btn variant="primary" onClick={() => setEdit({})}>Add zone</Btn>} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Delivery zones" rows={data?.zones ?? []} empty="No custom zones. Add one if you deliver with your own drivers." onRow={(r: any) => setEdit(r)} cols={[{ key: 'name', header: 'Zone', render: (r: any) => <b>{r.name}</b> }, { key: 'zone_type', header: 'Type', render: (r: any) => r.zone_type === 'radius' ? `${r.radius_km} km radius` : r.zone_type === 'postal' ? `${(r.postal_prefixes ?? []).length} postal prefixes` : 'Custom boundary' }, { key: 'fee', header: 'Fee', render: (r: any) => r.fee_model === 'flat' ? `${money(r.base_fee)} flat` : `${money(r.base_fee)} + ${money(r.per_km_fee)}/km` }, { key: 'free_over', header: 'Free over', render: (r: any) => (r.free_over ? money(r.free_over) : '') }, { key: 'is_active', header: 'Status', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Active' : 'Off'}</Badge> }, { key: 'x', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRm(r); }}>Delete</Btn> }]} />}
      {edit !== undefined && <ZoneForm initial={edit.id ? edit : undefined} onClose={() => setEdit(undefined)} onSaved={reload} save={(b, id) => (id ? put(`/vendors/${vendorId}/zones/${id}`, b) : post(`/vendors/${vendorId}/zones`, b))} />}
      {rm && <Confirm title={`Delete ${rm.name}?`} danger confirmLabel="Delete" onClose={() => setRm(null)} onConfirm={async () => { await del(`/vendors/${vendorId}/zones/${rm.id}`); reload(); }}><p>Customers in this area may no longer be able to order delivery from you.</p></Confirm>}
    </>
  );
}
