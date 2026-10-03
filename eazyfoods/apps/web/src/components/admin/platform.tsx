'use client';
import { useState } from 'react';
import { PageHead } from '../portal';
import { useAuth } from '../providers';
import { Badge, Bars, Btn, Check, Confirm, ErrorNote, HBars, Input, KV, Modal, Pager, Select, Spinner, Stat, Table, Tabs, Textarea, useToast } from '../ui';
import { del, get, patch, post, put } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { ZoneForm } from '../vendor/zones';
import { dateTime, label, money, date } from '@/lib/format';

/* ---------- generic editor for a JSON settings object ---------- */
function Fields({ value, onChange, path = '' }: { value: any; onChange: (v: any) => void; path?: string }) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return (
    <div className="form-grid">
      {Object.entries(value).map(([k, v]) => {
        const set = (nv: any) => onChange({ ...value, [k]: nv });
        const name = label(k);
        if (typeof v === 'boolean') return <Check key={k} label={name} checked={v} onChange={set} />;
        if (typeof v === 'number') return <Input key={k} label={name} type="number" step="any" value={v} onChange={(x) => set(x === '' ? 0 : Number(x))} />;
        if (typeof v === 'string') return <Input key={k} label={name} value={v} onChange={set} />;
        if (Array.isArray(v)) return <Textarea key={k} label={`${name} (JSON list)`} value={JSON.stringify(v)} onChange={(x) => { try { set(JSON.parse(x)); } catch { /* wait for valid JSON */ } }} rows={2} full />;
        if (v && typeof v === 'object') return <fieldset key={k} className="full"><legend>{name}</legend><Fields value={v} onChange={set} path={`${path}.${k}`} /></fieldset>;
        return null;
      })}
    </div>
  );
}

function SettingsTab() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>('/admin/settings'); const [edit, setEdit] = useState<any>(null); const [val, setVal] = useState<any>(null);
  const groups = [...new Set((data?.settings ?? []).map((s: any) => s.group))] as string[];
  return (
    <div className="stack">
      <ErrorNote error={error} retry={reload} />
      {groups.map((g) => (<section key={g}><h2 style={{ fontSize: '1.15rem' }}>{g}</h2><div className="stack" style={{ '--gap': '10px' } as any}>{data.settings.filter((s: any) => s.group === g).map((s: any) => (
        <div key={s.key} className="card pad row spread wrap-row"><div style={{ maxWidth: 640 }}><b>{s.label}</b><div className="small muted">{s.description}</div><div className="tiny mono" style={{ marginTop: 4 }}>{JSON.stringify(s.value).slice(0, 140)}</div></div>{can('settings.manage') && <Btn size="sm" variant="secondary" onClick={() => { setEdit(s); setVal(JSON.parse(JSON.stringify(s.value))); }}>Edit</Btn>}</div>))}</div></section>))}
      {edit && <Modal title={edit.label} onClose={() => setEdit(null)} wide footer={<><Btn variant="secondary" onClick={() => { setVal(JSON.parse(JSON.stringify(edit.default))); }}>Reset to default</Btn><Btn variant="primary" onClick={async () => { try { await put(`/admin/settings/${edit.key}`, { value: val }); toast('Setting saved. It applies to new orders straight away.'); setEdit(null); reload(); } catch (e: any) { toast(e.message, 'bad'); } }}>Save</Btn></>}><p className="muted">{edit.description}</p><Fields value={val} onChange={setVal} /></Modal>}
    </div>
  );
}

function ZonesTab() {
  const { can } = useAuth(); const { data, error, reload } = useApi<any>('/admin/zones'); const [edit, setEdit] = useState<any>(undefined);
  return (
    <div className="stack"><div className="row spread"><p className="muted">Platform delivery zones apply to orders delivered by EAZyfoods drivers. The first matching zone by priority sets the fee.</p>{can('settings.manage') && <Btn variant="primary" onClick={() => setEdit({})}>Add zone</Btn>}</div>
      <ErrorNote error={error} retry={reload} />
      <Table caption="Zones" rows={data?.zones ?? []} onRow={(r: any) => can('settings.manage') && setEdit(r)} cols={[{ key: 'name', header: 'Zone', render: (r: any) => <b>{r.name}</b> }, { key: 'zone_type', header: 'Area', render: (r: any) => r.zone_type === 'radius' ? `${r.radius_km} km radius` : r.zone_type === 'postal' ? `${(r.postal_prefixes ?? []).join(', ')}` : 'Custom boundary' }, { key: 'fee', header: 'Fee', render: (r: any) => r.fee_model === 'flat' ? `${money(r.base_fee)} flat` : `${money(r.base_fee)} + ${money(r.per_km_fee)}/km` }, { key: 'free_over', header: 'Free over', render: (r: any) => (r.free_over ? money(r.free_over) : '') }, { key: 'priority', header: 'Priority', align: 'right' }, { key: 'is_active', header: 'Status', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Active' : 'Off'}</Badge> }]} />
      {edit !== undefined && <ZoneForm initial={edit.id ? edit : undefined} onClose={() => setEdit(undefined)} onSaved={reload} save={(b, id) => (id ? put(`/admin/zones/${id}`, b) : post('/admin/zones', b))} />}
    </div>
  );
}

const FEE_COND = ['distance_km_gte', 'distance_km_lt', 'subtotal_gte', 'subtotal_lt', 'weight_kg_gte', 'demand_ratio_gte'];
function FeeRulesTab() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>('/admin/fee-rules'); const [e, setE] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const open = (r?: any) => { setErr(null); setE(r ? { ...r, amount: r.amount ?? '', multiplier: r.multiplier ?? '', cond: { ...r.conditions, hours: r.conditions?.hours ? r.conditions.hours.join('-') : '' } } : { name: '', kind: 'surcharge', amount: '', multiplier: '', priority: 10, is_active: true, cond: {} }); };
  const c = (k: string) => (v: any) => setE((o: any) => ({ ...o, cond: { ...o.cond, [k]: v } }));
  return (
    <div className="stack"><div className="row spread"><p className="muted">Surcharges, multipliers and discounts applied on top of the zone fee when their conditions match.</p>{can('settings.manage') && <Btn variant="primary" onClick={() => open()}>Add rule</Btn>}</div>
      <ErrorNote error={error} retry={reload} />
      <Table caption="Fee rules" rows={data?.rules ?? []} onRow={(r: any) => can('settings.manage') && open(r)} cols={[{ key: 'name', header: 'Rule', render: (r: any) => <b>{r.name}</b> }, { key: 'kind', header: 'Kind', render: (r: any) => label(r.kind) }, { key: 'v', header: 'Effect', render: (r: any) => (r.kind === 'multiplier' ? `× ${r.multiplier}` : `${r.kind === 'discount' ? '−' : '+'}${money(r.amount)}`) }, { key: 'conditions', header: 'When', render: (r: any) => <span className="small mono">{JSON.stringify(r.conditions)}</span> }, { key: 'priority', header: 'Order', align: 'right' }, { key: 'is_active', header: 'Status', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Active' : 'Off'}</Badge> }]} />
      {e && <Modal title={e.id ? 'Edit fee rule' : 'New fee rule'} onClose={() => setE(null)} wide footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => {
        try { const cond: any = {}; for (const k of FEE_COND) if (e.cond[k] !== '' && e.cond[k] != null) cond[k] = Number(e.cond[k]); if (e.cond.has_product_type) cond.has_product_type = e.cond.has_product_type; if (e.cond.multi_vendor) cond.multi_vendor = true; if (e.cond.weather_severe) cond.weather_severe = true; if (e.cond.hours) cond.hours = String(e.cond.hours).split('-').map((x: string) => x.trim());
          await put('/admin/fee-rules', { id: e.id, name: e.name, kind: e.kind, amount: e.kind === 'multiplier' ? null : Number(e.amount), multiplier: e.kind === 'multiplier' ? Number(e.multiplier) : null, priority: Number(e.priority), is_active: !!e.is_active, conditions: cond }); toast('Rule saved'); setE(null); reload(); } catch (x) { setErr(x); }
      }}>Save rule</Btn></>}>
        <ErrorNote error={err} />
        <div className="form-grid"><Input label="Name" value={e.name} onChange={(v) => setE({ ...e, name: v })} full /><Select label="Kind" value={e.kind} onChange={(v) => setE({ ...e, kind: v })} options={['surcharge', 'multiplier', 'discount']} />
          {e.kind === 'multiplier' ? <Input label="Multiplier" type="number" step="0.05" value={e.multiplier} onChange={(v) => setE({ ...e, multiplier: v })} /> : <Input label="Amount (CAD)" type="number" step="0.25" value={e.amount} onChange={(v) => setE({ ...e, amount: v })} />}
          <Input label="Order of application" type="number" value={e.priority} onChange={(v) => setE({ ...e, priority: v })} /><Check label="Active" checked={!!e.is_active} onChange={(v) => setE({ ...e, is_active: v })} />
          <fieldset className="full"><legend>Apply when all of these are true (leave blank to ignore)</legend><div className="form-grid">
            <Input label="Distance at least (km)" type="number" value={e.cond.distance_km_gte ?? ''} onChange={c('distance_km_gte')} optional /><Input label="Distance under (km)" type="number" value={e.cond.distance_km_lt ?? ''} onChange={c('distance_km_lt')} optional />
            <Input label="Subtotal at least (CAD)" type="number" value={e.cond.subtotal_gte ?? ''} onChange={c('subtotal_gte')} optional /><Input label="Subtotal under (CAD)" type="number" value={e.cond.subtotal_lt ?? ''} onChange={c('subtotal_lt')} optional />
            <Input label="Weight at least (kg)" type="number" value={e.cond.weight_kg_gte ?? ''} onChange={c('weight_kg_gte')} optional /><Input label="Demand ratio at least" type="number" step="0.1" value={e.cond.demand_ratio_gte ?? ''} onChange={c('demand_ratio_gte')} optional />
            <Input label="Hours of day (HH:MM-HH:MM)" value={e.cond.hours ?? ''} onChange={c('hours')} optional placeholder="17:00-20:00" /><Select label="Order contains product type" value={e.cond.has_product_type ?? ''} onChange={c('has_product_type')} options={['dry', 'fresh', 'frozen', 'prepared', 'chef_meal']} placeholder="Any" />
            <Check label="Order has more than one seller" checked={!!e.cond.multi_vendor} onChange={c('multi_vendor')} /><Check label="Severe weather flag is on" checked={!!e.cond.weather_severe} onChange={c('weather_severe')} /></div></fieldset></div></Modal>}
    </div>
  );
}

function CommissionTab() {
  const { can } = useAuth(); const toast = useToast(); const { data, reload } = useApi<any>('/admin/commission-rules'); const cats = useApi<any>('/admin/categories'); const vendors = useApi<any>('/admin/vendors?limit=100'); const [e, setE] = useState<any>(null); const [err, setErr] = useState<any>(null);
  return (
    <div className="stack"><div className="row spread"><p className="muted">Resolution order: vendor override, vendor rule, category rule, global rule, then the default commission setting.</p>{can('settings.manage') && <Btn variant="primary" onClick={() => { setErr(null); setE({ name: '', scope: 'category', percent: '12', fixed_fee: '0', is_active: true, vendor_id: '', category_id: '' }); }}>Add rule</Btn>}</div>
      <Table caption="Commission rules" rows={data?.rules ?? []} onRow={(r: any) => can('settings.manage') && setE({ ...r, vendor_id: r.vendor_id ?? '', category_id: r.category_id ?? '' })} cols={[{ key: 'name', header: 'Rule', render: (r: any) => <b>{r.name}</b> }, { key: 'scope', header: 'Scope', render: (r: any) => label(r.scope) }, { key: 'target', header: 'Applies to', render: (r: any) => r.vendor_name ?? r.category_name ?? 'Everything' }, { key: 'percent', header: 'Percent', align: 'right', render: (r: any) => `${r.percent}%` }, { key: 'fixed_fee', header: 'Fixed fee', align: 'right', render: (r: any) => money(r.fixed_fee) }, { key: 'is_active', header: 'Status', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Active' : 'Off'}</Badge> }]} />
      {e && <Modal title={e.id ? 'Edit commission rule' : 'New commission rule'} onClose={() => setE(null)} footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await put('/admin/commission-rules', { id: e.id, name: e.name, scope: e.scope, vendor_id: e.scope === 'vendor' ? e.vendor_id : null, category_id: e.scope === 'category' ? e.category_id : null, percent: Number(e.percent), fixed_fee: Number(e.fixed_fee) || 0, is_active: !!e.is_active }); toast('Rule saved'); setE(null); reload(); } catch (x) { setErr(x); } }}>Save</Btn></>}>
        <ErrorNote error={err} /><div className="form-grid"><Input label="Name" value={e.name} onChange={(v) => setE({ ...e, name: v })} full /><Select label="Scope" value={e.scope} onChange={(v) => setE({ ...e, scope: v })} options={['global', 'category', 'vendor']} />
          {e.scope === 'category' && <Select label="Category" value={e.category_id} onChange={(v) => setE({ ...e, category_id: v })} options={(cats.data?.categories ?? []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="Choose" />}
          {e.scope === 'vendor' && <Select label="Vendor" value={e.vendor_id} onChange={(v) => setE({ ...e, vendor_id: v })} options={(vendors.data?.vendors ?? []).map((c: any) => ({ value: c.id, label: c.trading_name }))} placeholder="Choose" />}
          <Input label="Percent of item sales" type="number" step="0.1" min={0} max={100} value={e.percent} onChange={(v) => setE({ ...e, percent: v })} /><Input label="Fixed fee per order (CAD)" type="number" step="0.01" min={0} value={e.fixed_fee} onChange={(v) => setE({ ...e, fixed_fee: v })} /><Check label="Active" checked={!!e.is_active} onChange={(v) => setE({ ...e, is_active: v })} /></div></Modal>}
    </div>
  );
}

function TaxTab() {
  const { can } = useAuth(); const toast = useToast(); const { data, reload } = useApi<any>('/admin/tax-rules'); const [e, setE] = useState<any>(null);
  return (
    <div className="stack"><p className="alert warn">Tax rates here are configurable starting values for demonstration. Confirm rates, product classes and registration rules with an accountant before charging real customers.</p>
      {can('settings.manage') && <Btn variant="primary" onClick={() => setE({ country: 'CA', region: 'ON', tax_class: 'standard', name: 'HST', rate: '13', active: true })}>Add or update a rate</Btn>}
      <Table caption="Tax rules" rows={data?.rules ?? []} onRow={(r: any) => can('settings.manage') && setE({ ...r })} cols={[{ key: 'region', header: 'Region', render: (r: any) => `${r.country}-${r.region}` }, { key: 'tax_class', header: 'Class', render: (r: any) => label(r.tax_class) }, { key: 'name', header: 'Tax' }, { key: 'rate', header: 'Rate', align: 'right', render: (r: any) => `${r.rate}%` }, { key: 'active', header: 'Status', render: (r: any) => <Badge tone={r.active ? 'ok' : ''}>{r.active ? 'Active' : 'Off'}</Badge> }]} />
      {e && <Modal title="Tax rate" onClose={() => setE(null)} footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await put('/admin/tax-rules', { country: e.country, region: e.region, tax_class: e.tax_class, name: e.name, rate: Number(e.rate), active: !!e.active }); toast('Saved'); setE(null); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>Save</Btn></>}>
        <div className="form-grid"><Input label="Country" value={e.country} onChange={(v) => setE({ ...e, country: v })} maxLength={2} /><Input label="Province or state" value={e.region} onChange={(v) => setE({ ...e, region: v })} maxLength={3} /><Select label="Tax class" value={e.tax_class} onChange={(v) => setE({ ...e, tax_class: v })} options={['standard', 'prepared', 'zero_rated', 'exempt']} /><Input label="Tax name" value={e.name} onChange={(v) => setE({ ...e, name: v })} /><Input label="Rate (%)" type="number" step="0.001" value={e.rate} onChange={(v) => setE({ ...e, rate: v })} /><Check label="Active" checked={!!e.active} onChange={(v) => setE({ ...e, active: v })} /></div></Modal>}
    </div>
  );
}

function PlansTab() { const { data } = useApi<any>('/admin/plans'); return <Table caption="Plans" rows={data?.plans ?? []} cols={[{ key: 'name', header: 'Plan', render: (r: any) => <b>{r.name}</b> }, { key: 'monthly_price', header: 'Monthly price', align: 'right', render: (r: any) => money(r.monthly_price) }, { key: 'commission_discount_pct', header: 'Commission discount', align: 'right', render: (r: any) => `${r.commission_discount_pct} pts` }, { key: 'features', header: 'Features', render: (r: any) => <span className="small mono">{JSON.stringify(r.features)}</span> }]} />; }

export function AdminSettings() {
  const [tab, setTab] = useState('settings');
  return (
    <>
      <PageHead title="Settings, fees and zones" sub="Every fee, rate and rule is data. Changes are audited and apply to new orders immediately." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'settings', label: 'Platform settings' }, { key: 'zones', label: 'Delivery zones' }, { key: 'fees', label: 'Delivery fee rules' }, { key: 'commission', label: 'Commission' }, { key: 'tax', label: 'Taxes' }, { key: 'plans', label: 'Vendor plans' }]} />
      {tab === 'settings' && <SettingsTab />}{tab === 'zones' && <ZonesTab />}{tab === 'fees' && <FeeRulesTab />}{tab === 'commission' && <CommissionTab />}{tab === 'tax' && <TaxTab />}{tab === 'plans' && <PlansTab />}
    </>
  );
}

/* ---------- compliance rules ---------- */
export function AdminCompliance() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>('/admin/compliance/rules'); const [e, setE] = useState<any>(null);
  return (
    <>
      <PageHead title="Compliance rules" sub="Which documents each type of partner must provide, per jurisdiction. Use * for rules that apply everywhere." actions={can('compliance.manage') && <Btn variant="primary" onClick={() => setE({ jurisdiction: 'CA-ON', applies_to: 'vendor', doc_type: '', label: '', required: true, warn_days: 30, active: true })}>Add rule</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Rules" rows={data?.rules ?? []} onRow={(r: any) => can('compliance.manage') && setE(r)} cols={[{ key: 'jurisdiction', header: 'Jurisdiction' }, { key: 'applies_to', header: 'Applies to', render: (r: any) => label(r.applies_to) }, { key: 'label', header: 'Document', render: (r: any) => <span>{r.label}<div className="tiny muted mono">{r.doc_type}</div></span> }, { key: 'required', header: 'Required', render: (r: any) => (r.required ? <Badge tone="warn">Required</Badge> : 'Optional') }, { key: 'warn_days', header: 'Warn before expiry', align: 'right', render: (r: any) => `${r.warn_days} days` }, { key: 'active', header: 'Status', render: (r: any) => <Badge tone={r.active ? 'ok' : ''}>{r.active ? 'Active' : 'Off'}</Badge> }]} />
      {e && <Modal title="Compliance rule" onClose={() => setE(null)} footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await put('/admin/compliance/rules', { jurisdiction: e.jurisdiction, applies_to: e.applies_to, doc_type: e.doc_type, label: e.label, required: !!e.required, warn_days: Number(e.warn_days), active: !!e.active }); toast('Rule saved'); setE(null); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>Save</Btn></>}>
        <div className="form-grid"><Input label="Jurisdiction" value={e.jurisdiction} onChange={(v) => setE({ ...e, jurisdiction: v })} hint="For example CA-ON, CA-BC or *" /><Select label="Applies to" value={e.applies_to} onChange={(v) => setE({ ...e, applies_to: v })} options={['vendor', 'chef', 'driver']} /><Input label="Document key" value={e.doc_type} onChange={(v) => setE({ ...e, doc_type: v })} hint="Lowercase with underscores" /><Input label="Label shown to partners" value={e.label} onChange={(v) => setE({ ...e, label: v })} /><Input label="Warn before expiry (days)" type="number" value={e.warn_days} onChange={(v) => setE({ ...e, warn_days: v })} /><Check label="Required" checked={!!e.required} onChange={(v) => setE({ ...e, required: v })} /><Check label="Active" checked={!!e.active} onChange={(v) => setE({ ...e, active: v })} /></div></Modal>}
    </>
  );
}

/* ---------- staff and roles ---------- */
export function AdminStaff() {
  const { can } = useAuth(); const toast = useToast(); const [tab, setTab] = useState('staff');
  const staff = useApi<any>('/admin/staff'); const roles = useApi<any>('/admin/roles'); const [nw, setNw] = useState<any>(null); const [role, setRole] = useState<any>(null); const [perms, setPerms] = useState<Set<string>>(new Set()); const [err, setErr] = useState<any>(null);
  const allPerms = [...new Set((roles.data?.roles ?? []).flatMap((r: any) => r.permissions))].sort() as string[];
  const staffRoles = (roles.data?.roles ?? []).filter((r: any) => r.kind === 'staff');
  return (
    <>
      <PageHead title="Staff and roles" sub="Access is granted by permission, never by role name. Changes take effect on the next request." actions={can('users.manage') && <Btn variant="primary" onClick={() => { setErr(null); setNw({ full_name: '', email: '', password: '', role: staffRoles[0]?.key ?? '' }); }}>Add staff member</Btn>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'staff', label: 'Staff' }, { key: 'roles', label: 'Roles and permissions' }]} />
      {tab === 'staff' && <Table caption="Staff" rows={staff.data?.staff ?? []} cols={[{ key: 'full_name', header: 'Name', render: (r: any) => <span><b>{r.full_name}</b><div className="tiny muted">{r.email}</div></span> }, { key: 'roles', header: 'Roles', render: (r: any) => <span className="row wrap-row" style={{ '--gap': '4px' } as any}>{r.roles.map((x: string) => <Badge key={x}>{label(x)}{can('roles.manage') && <button aria-label={`Remove ${x}`} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={async () => { try { await del(`/admin/users/${r.id}/roles/${x}`); toast('Role removed'); staff.reload(); } catch (e: any) { toast(e.message, 'bad'); } }}> ×</button>}</Badge>)}</span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'last_login_at', header: 'Last login', render: (r: any) => (r.last_login_at ? dateTime(r.last_login_at) : 'Never') }, { key: 'x', header: '', render: (r: any) => can('roles.manage') ? <Select label="" value="" onChange={async (v) => { if (!v) return; try { await post(`/admin/users/${r.id}/roles`, { role: v }); toast('Role added'); staff.reload(); } catch (e: any) { toast(e.message, 'bad'); } }} options={staffRoles.filter((x: any) => !r.roles.includes(x.key)).map((x: any) => ({ value: x.key, label: x.name }))} placeholder="Add role" /> : null }]} />}
      {tab === 'roles' && <Table caption="Roles" rows={roles.data?.roles ?? []} onRow={(r: any) => { if (r.kind === 'staff' && can('roles.manage')) { setRole(r); setPerms(new Set(r.permissions)); } }} cols={[{ key: 'name', header: 'Role', render: (r: any) => <span><b>{r.name}</b><div className="tiny muted">{r.description}</div></span> }, { key: 'kind', header: 'Kind', render: (r: any) => label(r.kind) }, { key: 'members', header: 'Members', align: 'right' }, { key: 'permissions', header: 'Permissions', render: (r: any) => <span className="small">{r.kind === 'staff' ? `${r.permissions.length} permissions` : 'Built in behaviour'}</span> }]} />}
      {nw && <Modal title="Add staff member" onClose={() => setNw(null)} footer={<><Btn variant="secondary" onClick={() => setNw(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await post('/admin/staff', nw); toast('Staff member created'); setNw(null); staff.reload(); } catch (e) { setErr(e); } }}>Create</Btn></>}>
        <ErrorNote error={err} /><div className="form-grid"><Input label="Full name" value={nw.full_name} onChange={(v) => setNw({ ...nw, full_name: v })} /><Input label="Email" type="email" value={nw.email} onChange={(v) => setNw({ ...nw, email: v })} /><Input label="Temporary password" type="password" value={nw.password} onChange={(v) => setNw({ ...nw, password: v })} hint="At least 10 characters. Ask them to change it." /><Select label="Role" value={nw.role} onChange={(v) => setNw({ ...nw, role: v })} options={staffRoles.map((x: any) => ({ value: x.key, label: x.name }))} /></div></Modal>}
      {role && <Modal title={`Permissions: ${role.name}`} onClose={() => setRole(null)} wide footer={<><Btn variant="secondary" onClick={() => setRole(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { await put(`/admin/roles/${role.key}/permissions`, { permissions: [...perms] }); toast('Permissions saved'); setRole(null); roles.reload(); } catch (e: any) { toast(e.message, 'bad'); } }}>Save</Btn></>}>
        <div className="grid cols-3" style={{ '--gap': '6px' } as any}>{allPerms.map((p) => <Check key={p} label={p} checked={perms.has(p)} onChange={(v) => setPerms((s) => { const n = new Set(s); v ? n.add(p) : n.delete(p); return n; })} />)}</div></Modal>}
    </>
  );
}

/* ---------- audit, outbox, analytics ---------- */
export function AdminAudit() {
  const [action, setAction] = useState(''); const [entity, setEntity] = useState(''); const [page, setPage] = useState(1); const [open, setOpen] = useState<any>(null);
  const { data, error } = useApi<any>(`/admin/audit?page=${page}&limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}${entity ? `&entityType=${encodeURIComponent(entity)}` : ''}`);
  return (
    <>
      <PageHead title="Audit log" sub="Who did what, and when. Entries cannot be edited." />
      <div className="row wrap-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}><div style={{ width: 240 }}><Input label="Action starts with" value={action} onChange={(v) => { setAction(v); setPage(1); }} placeholder="vendor." /></div><div style={{ width: 200 }}><Select label="Entity" value={entity} onChange={(v) => { setEntity(v); setPage(1); }} options={['user', 'vendor', 'order', 'suborder', 'product', 'payout', 'driver', 'setting', 'promotion']} placeholder="Any" /></div></div>
      <ErrorNote error={error} />
      <Table caption="Audit log" rows={data?.entries ?? []} onRow={setOpen} cols={[{ key: 'created_at', header: 'When', render: (r: any) => dateTime(r.created_at) }, { key: 'actor_name', header: 'Who', render: (r: any) => <span>{r.actor_name ?? 'System'}<div className="tiny muted">{r.actor_email}</div></span> }, { key: 'action', header: 'Action', render: (r: any) => <code>{r.action}</code> }, { key: 'entity', header: 'Entity', render: (r: any) => <span className="small">{r.entity_type} {String(r.entity_id ?? '').slice(0, 8)}</span> }, { key: 'ip', header: 'IP' }]} />
      <Pager page={page} pages={data?.entries?.length === 50 ? page + 1 : page} onPage={setPage} />
      {open && <Modal title={open.action} onClose={() => setOpen(null)}><KV items={[['When', dateTime(open.created_at)], ['Who', open.actor_name ?? 'System'], ['Entity', `${open.entity_type} ${open.entity_id}`], ['IP', open.ip], ['Device', open.user_agent]]} /><pre className="json">{JSON.stringify(open.changes, null, 2)}</pre></Modal>}
    </>
  );
}

export function AdminOutbox() {
  const { data, error } = useApi<any>('/admin/outbox'); const [open, setOpen] = useState<any>(null);
  return (
    <>
      <PageHead title="Message outbox" sub="Every email, SMS and push the platform sends. In development they are recorded here instead of being delivered." />
      <ErrorNote error={error} />
      <Table caption="Outbox" rows={data?.messages ?? []} onRow={setOpen} cols={[{ key: 'created_at', header: 'When', render: (r: any) => dateTime(r.created_at) }, { key: 'channel', header: 'Channel', render: (r: any) => label(r.channel) }, { key: 'recipient', header: 'To' }, { key: 'subject', header: 'Subject' }, { key: 'provider', header: 'Provider' }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }]} />
      {open && <Modal title={open.subject ?? 'Message'} onClose={() => setOpen(null)}><p className="small muted">To {open.recipient} via {open.channel}</p><p style={{ whiteSpace: 'pre-wrap' }}>{open.body}</p></Modal>}
    </>
  );
}

export function AdminAnalytics() {
  const [days, setDays] = useState('30'); const { data: d, error } = useApi<any>(`/admin/analytics?days=${days}`, [days]);
  return (
    <>
      <PageHead title="Analytics" sub="Calculated from real orders, ledger entries and storefront events." actions={<div style={{ width: 160 }}><Select label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></div>} />
      <ErrorNote error={error} />
      {!d ? <Spinner /> : (<div className="stack" style={{ '--gap': '20px' } as any}>
        <div className="grid cols-4"><Stat label="Orders" value={d.orders} /><Stat label="GMV" value={money(d.gmv)} /><Stat label="Average order" value={money(d.average_order_value)} /><Stat label="Cancellation rate" value={`${d.cancellation_rate}%`} /></div>
        <div className="grid cols-4"><Stat label="Platform revenue" value={money(d.revenue.platform_revenue)} hint={`Commission ${money(d.revenue.commission)}, delivery ${money(d.revenue.delivery)}, service ${money(d.revenue.service_fees)}`} /><Stat label="Contribution" value={money(d.revenue.contribution)} hint={`After driver pay ${money(d.revenue.costs.driver_pay)}, promotions ${money(d.revenue.costs.promotions)}, refunds ${money(d.revenue.costs.refunds_absorbed)}`} /><Stat label="Delivery margin" value={money(d.delivery.margin)} hint={`${money(d.delivery.customer_fees)} fees vs ${money(d.delivery.driver_pay)} driver pay`} /><Stat label="Refund rate" value={`${d.refunds.rate}%`} hint={`${d.refunds.count} refunds, ${money(d.refunds.amount)}`} /></div>
        <div className="grid cols-4"><Stat label="New customers" value={d.customers.new} /><Stat label="Active customers" value={d.customers.active} /><Stat label="Repeat customers" value={d.customers.repeat} hint={`${d.customers.retention_rate}% retention`} /><Stat label="Checkout conversion" value={`${d.funnel.conversion_rate}%`} hint={`${d.funnel.product_views} views, ${d.funnel.add_to_cart} carts, ${d.funnel.checkouts} checkouts`} /></div>
        <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>GMV per day</h2><Bars data={d.series.map((s: any) => ({ label: s.day, value: s.gmv }))} format={money} /></section>
        <p className="hint">Historical demo data in this environment is seeded, so trends are illustrative. Figures for new activity are computed live.</p>
      </div>)}
    </>
  );
}
void get; void patch; void Confirm; void HBars; void date;
