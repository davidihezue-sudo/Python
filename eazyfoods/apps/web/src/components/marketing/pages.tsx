'use client';
import { useState } from 'react';
import { PageHead } from '../portal';
import { useAuth } from '../providers';
import { Badge, Btn, Check, Confirm, ErrorNote, HBars, Input, KV, Modal, Select, Spinner, Stat, Table, Tabs, Textarea, useToast } from '../ui';
import { Fields } from '../admin/platform';
import { PromotionForm } from '../vendor/promotions';
import { del, get, post, put, upload } from '@/lib/api';
import { useApi, useDebounced } from '@/hooks/useApi';
import { dateTime, label, money } from '@/lib/format';

const M = '/marketing';

export function MarketingOverview() {
  const { data, error } = useApi<any>(`${M}/overview`);
  if (!data) return error ? <ErrorNote error={error} /> : <Spinner />;
  return (
    <>
      <PageHead title="Marketing overview" sub="Live counts from the promotions engine, campaigns and ad server." />
      <div className="grid cols-4"><Stat label="Active promotions" value={data.promotions.active} hint={`${data.promotions.drafts} drafts, ${data.promotions.expired} expired`} /><Stat label="Active campaigns" value={data.campaigns.active} hint={`${data.campaigns.scheduled} scheduled`} /><Stat label="Active ads" value={data.ads.active} hint={`${data.ads.impressions} impressions, ${data.ads.clicks} clicks`} /><Stat label="Homepage sections live" value={data.homepage_sections} /></div>
      <section className="card pad" style={{ marginTop: 20 }}><h2 style={{ fontSize: '1.15rem' }}>Most used promotions</h2><HBars data={data.top_promotions.map((p: any) => ({ label: `${p.name}${p.code ? ` (${p.code})` : ''}`, value: p.redemptions }))} /></section>
    </>
  );
}

/* ---------- homepage CMS ---------- */
const KINDS = ['hero', 'search', 'shop_modes', 'category_rail', 'product_rail', 'chef_rail', 'vendor_rail', 'collection', 'cuisine_grid', 'country_grid', 'banner', 'editorial'];
const DEFAULT_CONFIG: Record<string, any> = { product_rail: { source: 'trending', limit: 8 }, category_rail: { limit: 10 }, chef_rail: { limit: 6 }, vendor_rail: { limit: 6 }, collection: { slug: '', limit: 8 }, cuisine_grid: { limit: 8 }, country_grid: { limit: 8 }, editorial: { limit: 4 }, banner: { placement: 'home_banner' }, hero: { placement: 'home_hero' } };
export function MarketingHomepage() {
  const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/homepage`); const segs = useApi<any>(`${M}/segments`); const [e, setE] = useState<any>(null); const [prev, setPrev] = useState(false); const [err, setErr] = useState<any>(null);
  const sections: any[] = data?.sections ?? [];
  const move = async (i: number, d: number) => { const a = [...sections]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; await post(`${M}/homepage/reorder`, { order: a.map((s) => s.id) }); reload(); };
  return (
    <>
      <PageHead title="Homepage" sub="Arrange the sections customers see. Changes go live as soon as you save." actions={<><Btn variant="secondary" onClick={() => setPrev(true)}>Preview data</Btn><Btn variant="primary" onClick={() => { setErr(null); setE({ kind: 'product_rail', title: '', subtitle: '', cfg: JSON.stringify(DEFAULT_CONFIG.product_rail), is_active: true, segment_id: '', position: (sections.length + 1) * 10 }); }}>Add section</Btn></>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Homepage sections" rows={sections} cols={[{ key: 'pos', header: 'Order', render: (r: any) => { const i = sections.findIndex((s) => s.id === r.id); return <span className="row" style={{ '--gap': '2px' } as any}><Btn size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</Btn><Btn size="sm" variant="ghost" aria-label="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>↓</Btn></span>; } }, { key: 'kind', header: 'Section', render: (r: any) => <span><b>{label(r.kind)}</b><div className="tiny muted">{r.title}</div></span> }, { key: 'config', header: 'Settings', render: (r: any) => <span className="small mono">{JSON.stringify(r.config)}</span> }, { key: 'segment_name', header: 'Audience', render: (r: any) => r.segment_name ?? 'Everyone' }, { key: 'is_active', header: 'Live', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Live' : 'Hidden'}</Badge> }, { key: 'x', header: '', render: (r: any) => <span className="row"><Btn size="sm" variant="secondary" onClick={() => { setErr(null); setE({ ...r, cfg: JSON.stringify(r.config), title: r.title ?? '', subtitle: r.subtitle ?? '', segment_id: r.segment_id ?? '' }); }}>Edit</Btn><Btn size="sm" variant="ghost" onClick={async () => { await del(`${M}/homepage/${r.id}`); toast('Removed'); reload(); }}>Remove</Btn></span> }]} />
      {e && <Modal title={e.id ? 'Edit section' : 'New section'} onClose={() => setE(null)} footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { let config = {}; try { config = JSON.parse(e.cfg || '{}'); } catch { throw new Error('Settings must be valid JSON.'); } const b = { kind: e.kind, title: e.title || null, subtitle: e.subtitle || null, config, position: Number(e.position) || 0, is_active: !!e.is_active, segment_id: e.segment_id || null }; if (e.id) await put(`${M}/homepage/${e.id}`, b); else await post(`${M}/homepage`, b); toast('Saved'); setE(null); reload(); } catch (x) { setErr(x); } }}>Save</Btn></>}>
        <ErrorNote error={err} />
        <div className="form-grid"><Select label="Type" value={e.kind} onChange={(v) => setE({ ...e, kind: v, cfg: JSON.stringify(DEFAULT_CONFIG[v] ?? {}) })} options={KINDS} /><Input label="Title" value={e.title} onChange={(v) => setE({ ...e, title: v })} optional /><Input label="Subtitle" value={e.subtitle} onChange={(v) => setE({ ...e, subtitle: v })} optional full />
          <Textarea label="Settings (JSON)" value={e.cfg} onChange={(v) => setE({ ...e, cfg: v })} rows={3} full hint={e.kind === 'product_rail' ? 'source: trending, deals, prepared, recommended, new_arrivals. limit: number of items.' : e.kind === 'collection' ? 'slug: the collection slug. limit: number of items.' : e.kind === 'banner' || e.kind === 'hero' ? 'placement: the ad placement key.' : 'limit: number of items.'} />
          <Select label="Audience" value={e.segment_id} onChange={(v) => setE({ ...e, segment_id: v })} options={(segs.data?.segments ?? []).map((s: any) => ({ value: s.id, label: `${s.name} (${s.size})` }))} placeholder="Everyone" /><Check label="Show on the homepage" checked={!!e.is_active} onChange={(v) => setE({ ...e, is_active: v })} /></div></Modal>}
      {prev && <PreviewModal onClose={() => setPrev(false)} />}
    </>
  );
}
function PreviewModal({ onClose }: { onClose: () => void }) {
  const { data } = useApi<any>(`${M}/homepage/preview`);
  return <Modal title="What an anonymous visitor gets" onClose={onClose} wide>{!data ? <Spinner /> : <Table caption="Preview" rows={data.sections.map((s: any) => ({ ...s, id: s.id }))} cols={[{ key: 'kind', header: 'Section', render: (s: any) => label(s.kind) }, { key: 'title', header: 'Title' }, { key: 'data', header: 'Content', render: (s: any) => <span className="small">{Object.entries(s.data ?? {}).map(([k, v]: any) => `${k}: ${Array.isArray(v) ? v.length : typeof v === 'object' ? 'object' : v}`).join(', ')}</span> }]} />}</Modal>;
}

/* ---------- promotions ---------- */
export function MarketingPromotions() {
  const { can } = useAuth(); const { data, error, reload } = useApi<any>(`${M}/promotions`); const segs = useApi<any>(`${M}/segments`); const [edit, setEdit] = useState<any>(undefined); const [stats, setStats] = useState<any>(null);
  return (
    <>
      <PageHead title="Promotions and coupons" sub="Platform funded and seller funded offers. The pricing engine applies stacking rules and the global discount cap." actions={can('promotions.manage') && <Btn variant="primary" onClick={() => setEdit({})}>New promotion</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Promotions" rows={data?.promotions ?? []} onRow={(r: any) => can('promotions.manage') && setEdit(r)} cols={[{ key: 'name', header: 'Promotion', render: (r: any) => <span><b>{r.name}</b><div className="tiny muted">{label(r.type)}{r.type === 'percent' ? ` ${r.value}%` : r.value ? ` ${money(r.value)}` : ''}{r.code ? ` · code ${r.code}` : ' · automatic'}{r.vendor_name ? ` · ${r.vendor_name}` : ''}</div></span> }, { key: 'funded_by', header: 'Funded by', render: (r: any) => label(r.funded_by) }, { key: 'state', header: 'State', render: (r: any) => <Badge status={r.state} /> }, { key: 'dates', header: 'Runs', render: (r: any) => <span className="small">{r.starts_at ? dateTime(r.starts_at) : 'Now'}{r.ends_at ? ` to ${dateTime(r.ends_at)}` : ''}</span> }, { key: 'redemptions', header: 'Used', align: 'right' }, { key: 's', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); setStats({ p: r, ...(await get(`${M}/promotions/${r.id}/stats`)) }); }}>Results</Btn> }]} />
      {edit !== undefined && <PromotionForm initial={edit.id ? edit : undefined} onClose={() => setEdit(undefined)} onSaved={reload} save={(b, id) => (id ? put(`${M}/promotions/${id}`, b) : post(`${M}/promotions`, b))} extra={(p, s) => <><Select label="Funded by" value={p.funded_by} onChange={s('funded_by')} options={['platform', 'vendor']} /><Select label="Audience" value={p.segment_id ?? ''} onChange={s('segment_id')} options={(segs.data?.segments ?? []).map((x: any) => ({ value: x.id, label: `${x.name} (${x.size})` }))} placeholder="Everyone" /></>} />}
      {stats && <Modal title={`Results: ${stats.p.name}`} onClose={() => setStats(null)}><KV items={[['Times used', stats.stats.redemptions], ['Discount given', money(stats.stats.discount_cost)], ['Order value with this offer', money(stats.stats.revenue)]]} /></Modal>}
    </>
  );
}

/* ---------- segments ---------- */
const RULE_FIELDS: Record<string, [string, string][]> = { returning: [['min_orders', 'Minimum orders']], high_frequency: [['days', 'Within days'], ['min_orders', 'Minimum orders']], high_value: [['days', 'Within days'], ['min_spend', 'Minimum spend (CAD)']], lapsed: [['days', 'No order for days']], interest_groceries: [['min_orders', 'Minimum grocery orders']], interest_prepared: [['min_orders', 'Minimum meal orders']], vendor_loyal: [['min_orders', 'Minimum orders with seller']] };
export function MarketingSegments() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/segments`); const [n, setN] = useState<any>(null); const [rm, setRm] = useState<any>(null); const [size, setSize] = useState<number | null>(null); const [err, setErr] = useState<any>(null);
  const rule = n && { type: n.type, ...Object.fromEntries((RULE_FIELDS[n.type] ?? []).map(([k]) => [k, Number(n[k])]).filter(([, v]) => !Number.isNaN(v) && v !== 0)), ...(n.type === 'vendor_loyal' && n.vendor_id ? { vendor_id: n.vendor_id } : {}) };
  return (
    <>
      <PageHead title="Customer segments" sub="Rule based audiences computed from real order history. Used for promotions, ads, campaigns and homepage sections." actions={can('segments.manage') && <Btn variant="primary" onClick={() => { setErr(null); setSize(null); setN({ name: '', type: 'high_value', days: 90, min_spend: 200, min_orders: 3 }); }}>New segment</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Segments" rows={data?.segments ?? []} cols={[{ key: 'name', header: 'Segment', render: (r: any) => <b>{r.name}</b> }, { key: 'rule', header: 'Rule', render: (r: any) => <span className="small mono">{JSON.stringify(r.rule)}</span> }, { key: 'size', header: 'Customers', align: 'right' }, { key: 'x', header: '', render: (r: any) => can('segments.manage') ? <Btn size="sm" variant="ghost" onClick={() => setRm(r)}>Delete</Btn> : null }]} />
      {n && <Modal title="New segment" onClose={() => setN(null)} footer={<><Btn variant="secondary" onClick={async () => { try { setSize((await post(`${M}/segments/preview`, { rule })).size); } catch (x) { setErr(x); } }}>Count customers</Btn><Btn variant="primary" onClick={async () => { try { await post(`${M}/segments`, { name: n.name, rule }); toast('Segment created'); setN(null); reload(); } catch (x) { setErr(x); } }}>Save segment</Btn></>}>
        <ErrorNote error={err} />{size != null && <p className="alert ok">{size} customers match today.</p>}
        <div className="form-grid"><Input label="Name" value={n.name} onChange={(v) => setN({ ...n, name: v })} full /><Select label="Who is included" value={n.type} onChange={(v) => setN({ ...n, type: v })} options={[{ value: 'all', label: 'All customers' }, { value: 'new_customers', label: 'New customers (no orders)' }, { value: 'returning', label: 'Returning customers' }, { value: 'high_frequency', label: 'Frequent buyers' }, { value: 'high_value', label: 'High spenders' }, { value: 'lapsed', label: 'Lapsed customers' }, { value: 'interest_groceries', label: 'Grocery shoppers' }, { value: 'interest_prepared', label: 'Meal orderers' }, { value: 'vendor_loyal', label: 'Loyal to one seller' }]} />
          {(RULE_FIELDS[n.type] ?? []).map(([k, l]) => <Input key={k} label={l} type="number" min={1} value={n[k] ?? ''} onChange={(v) => setN({ ...n, [k]: v })} />)}{n.type === 'vendor_loyal' && <Input label="Seller id" value={n.vendor_id ?? ''} onChange={(v) => setN({ ...n, vendor_id: v })} />}</div></Modal>}
      {rm && <Confirm title={`Delete ${rm.name}?`} danger confirmLabel="Delete" onClose={() => setRm(null)} onConfirm={async () => { await del(`${M}/segments/${rm.id}`); reload(); }}><p>Segments in use by a promotion, campaign or homepage section cannot be deleted.</p></Confirm>}
    </>
  );
}

/* ---------- campaigns ---------- */
const toLocal = (d?: string | null) => (d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
export function MarketingCampaigns() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/campaigns`); const segs = useApi<any>(`${M}/segments`); const promos = useApi<any>(`${M}/promotions`); const [e, setE] = useState<any>(null); const [m, setM] = useState<any>(null); const [err, setErr] = useState<any>(null);
  return (
    <>
      <PageHead title="Campaigns" sub="Group a promotion, an audience, ads and a landing page, then measure what happened." actions={can('marketing.manage') && <Btn variant="primary" onClick={() => { setErr(null); setE({ name: '', description: '', starts_at: '', ends_at: '', segment_id: '', promotion_id: '', landing_slug: '', budget: '', status: 'draft' }); }}>New campaign</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Campaigns" rows={data?.campaigns ?? []} onRow={async (r: any) => setM({ c: r, ...(await get(`${M}/campaigns/${r.id}/metrics`)) })} cols={[{ key: 'name', header: 'Campaign', render: (r: any) => <span><b>{r.name}</b><div className="tiny muted">{r.promotion_name ?? 'No promotion'} · {r.segment_name ?? 'Everyone'}</div></span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'dates', header: 'Runs', render: (r: any) => <span className="small">{r.starts_at ? dateTime(r.starts_at) : ''}{r.ends_at ? ` to ${dateTime(r.ends_at)}` : ''}</span> }, { key: 'x', header: '', render: (r: any) => can('marketing.manage') ? <Btn size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); setErr(null); setE({ ...r, description: r.description ?? '', segment_id: r.segment_id ?? '', promotion_id: r.promotion_id ?? '', landing_slug: r.landing_slug ?? '', budget: r.budget ?? '', starts_at: toLocal(r.starts_at), ends_at: toLocal(r.ends_at) }); }}>Edit</Btn> : null }]} />
      {e && <Modal title={e.id ? 'Edit campaign' : 'New campaign'} onClose={() => setE(null)} footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { const b = { name: e.name, description: e.description || null, starts_at: e.starts_at ? new Date(e.starts_at).toISOString() : null, ends_at: e.ends_at ? new Date(e.ends_at).toISOString() : null, segment_id: e.segment_id || null, promotion_id: e.promotion_id || null, landing_slug: e.landing_slug || null, budget: e.budget === '' ? null : Number(e.budget), status: e.status }; if (e.id) await put(`${M}/campaigns/${e.id}`, b); else await post(`${M}/campaigns`, b); toast('Campaign saved'); setE(null); reload(); } catch (x) { setErr(x); } }}>Save</Btn></>}>
        <ErrorNote error={err} /><div className="form-grid"><Input label="Name" value={e.name} onChange={(v) => setE({ ...e, name: v })} full /><Textarea label="Description" value={e.description} onChange={(v) => setE({ ...e, description: v })} full optional rows={2} /><Select label="Promotion" value={e.promotion_id} onChange={(v) => setE({ ...e, promotion_id: v })} options={(promos.data?.promotions ?? []).map((p: any) => ({ value: p.id, label: p.name }))} placeholder="None" /><Select label="Audience" value={e.segment_id} onChange={(v) => setE({ ...e, segment_id: v })} options={(segs.data?.segments ?? []).map((s: any) => ({ value: s.id, label: `${s.name} (${s.size})` }))} placeholder="Everyone" /><Input label="Starts" type="datetime-local" value={e.starts_at} onChange={(v) => setE({ ...e, starts_at: v })} optional /><Input label="Ends" type="datetime-local" value={e.ends_at} onChange={(v) => setE({ ...e, ends_at: v })} optional /><Input label="Landing page slug" value={e.landing_slug} onChange={(v) => setE({ ...e, landing_slug: v })} optional hint="Shows the collection or article with this slug." /><Input label="Budget (CAD)" type="number" value={e.budget} onChange={(v) => setE({ ...e, budget: v })} optional /><Select label="Status" value={e.status} onChange={(v) => setE({ ...e, status: v })} options={['draft', 'scheduled', 'active', 'paused', 'ended']} /></div></Modal>}
      {m && <Modal title={`Results: ${m.c.name}`} onClose={() => setM(null)}><KV items={Object.entries(m).filter(([k, v]) => k !== 'c' && typeof v !== 'object').map(([k, v]) => [label(k), typeof v === 'number' && /revenue|spend|cost|discount/.test(k) ? money(v) : String(v)] as [string, string])} /><p className="hint">Attribution uses landing visits, ad clicks and promotion redemptions recorded for this campaign.</p></Modal>}
    </>
  );
}

/* ---------- ads ---------- */
export function MarketingAds() {
  const { can } = useAuth(); const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/ads`); const camps = useApi<any>(`${M}/campaigns`); const [e, setE] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const blank = { placement_key: 'home_banner', title: '', subtitle: '', image_url: '', cta_label: 'Shop now', click_url: '/', advertiser_type: 'platform', advertiser_name: '', cost_model: 'flat', rate: '0', budget: '', status: 'draft', campaign_id: '', position: 0 };
  return (
    <>
      <PageHead title="Ads and banners" sub="Sponsored placements are always labelled as sponsored to customers. Impressions and clicks are real counts." actions={can('ads.manage') && <Btn variant="primary" onClick={() => { setErr(null); setE(blank); }}>New ad</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Ads" rows={data?.ads ?? []} onRow={(r: any) => can('ads.manage') && (setErr(null), setE({ ...r, subtitle: r.subtitle ?? '', image_url: r.image_url ?? '', cta_label: r.cta_label ?? '', advertiser_name: r.advertiser_name ?? '', budget: r.budget ?? '', campaign_id: r.campaign_id ?? '' }))} cols={[{ key: 'title', header: 'Ad', render: (r: any) => <span className="row"><img src={r.image_url ?? '/img/food/hero-spice.svg'} alt="" width={56} height={40} style={{ objectFit: 'cover', borderRadius: 6 }} /><span><b>{r.title}</b><div className="tiny muted">{r.placement_key} · {label(r.advertiser_type)}{r.advertiser_name ? `: ${r.advertiser_name}` : ''}</div></span></span> }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'impressions', header: 'Impressions', align: 'right' }, { key: 'clicks', header: 'Clicks', align: 'right' }, { key: 'ctr', header: 'CTR', align: 'right', render: (r: any) => (r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(1)}%` : '') }, { key: 'spent', header: 'Spent', align: 'right', render: (r: any) => money(r.spent) }]} />
      {e && <Modal title={e.id ? 'Edit ad' : 'New ad'} onClose={() => setE(null)} wide footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { const b = { placement_key: e.placement_key, title: e.title, subtitle: e.subtitle || null, image_url: e.image_url || null, cta_label: e.cta_label || null, click_url: e.click_url, advertiser_type: e.advertiser_type, advertiser_name: e.advertiser_name || null, cost_model: e.cost_model, rate: Number(e.rate) || 0, budget: e.budget === '' ? null : Number(e.budget), status: e.status, campaign_id: e.campaign_id || null, position: Number(e.position) || 0 }; if (e.id) await put(`${M}/ads/${e.id}`, b); else await post(`${M}/ads`, b); toast('Ad saved'); setE(null); reload(); } catch (x) { setErr(x); } }}>Save</Btn></>}>
        <ErrorNote error={err} /><div className="form-grid"><Select label="Placement" value={e.placement_key} onChange={(v) => setE({ ...e, placement_key: v })} options={(data?.placements ?? []).map((p: any) => ({ value: p.key, label: `${p.key} ${p.description ? `(${p.description})` : ''}` }))} /><Select label="Status" value={e.status} onChange={(v) => setE({ ...e, status: v })} options={['draft', 'active', 'paused', 'ended']} />
          <Input label="Title" value={e.title} onChange={(v) => setE({ ...e, title: v })} /><Input label="Subtitle" value={e.subtitle} onChange={(v) => setE({ ...e, subtitle: v })} optional /><Input label="Button label" value={e.cta_label} onChange={(v) => setE({ ...e, cta_label: v })} optional /><Input label="Link" value={e.click_url} onChange={(v) => setE({ ...e, click_url: v })} hint="A path on this site, or a full URL." />
          <div className="full"><Input label="Image URL" value={e.image_url} onChange={(v) => setE({ ...e, image_url: v })} optional /><label className="btn sm secondary" htmlFor="adimg" style={{ marginTop: 6 }}>Upload image</label><input id="adimg" className="sr-only" type="file" accept="image/*" onChange={async (ev) => { const f = ev.target.files?.[0]; if (f) { try { setE({ ...e, image_url: (await upload(f, 'image')).url }); } catch (x: any) { toast(x.message, 'bad'); } } }} /></div>
          <Select label="Advertiser" value={e.advertiser_type} onChange={(v) => setE({ ...e, advertiser_type: v })} options={['platform', 'vendor', 'external']} /><Input label="Advertiser name" value={e.advertiser_name} onChange={(v) => setE({ ...e, advertiser_name: v })} optional hint="Shown as “Sponsored by”." />
          <Select label="Pricing" value={e.cost_model} onChange={(v) => setE({ ...e, cost_model: v })} options={[{ value: 'flat', label: 'Flat fee' }, { value: 'cpc', label: 'Cost per click' }, { value: 'cpm', label: 'Cost per 1000 views' }]} /><Input label="Rate (CAD)" type="number" step="0.01" value={e.rate} onChange={(v) => setE({ ...e, rate: v })} /><Input label="Budget cap (CAD)" type="number" value={e.budget} onChange={(v) => setE({ ...e, budget: v })} optional /><Select label="Campaign" value={e.campaign_id} onChange={(v) => setE({ ...e, campaign_id: v })} options={(camps.data?.campaigns ?? []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="None" /></div></Modal>}
    </>
  );
}

/* ---------- collections ---------- */
export function MarketingCollections() {
  const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/collections`); const [e, setE] = useState<any>(null); const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const found = useApi<any>(dq.length >= 2 ? `${M}/products/lookup?q=${encodeURIComponent(dq)}` : null, [dq]);
  const open = async (c?: any) => { if (!c) return setE({ title: '', description: '', products: [], is_active: true }); const d = await get(`/collections/${c.slug}`).catch(() => ({ items: [] })); setE({ ...c, description: c.description ?? '', products: (d.items ?? []).map((p: any) => ({ id: p.id, name: p.name })) }); };
  return (
    <>
      <PageHead title="Collections" sub="Hand picked product groups that can be placed on the homepage or used as campaign landing pages." actions={<Btn variant="primary" onClick={() => open()}>New collection</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Collections" rows={data?.collections ?? []} onRow={open} cols={[{ key: 'title', header: 'Collection', render: (r: any) => <span><b>{r.title}</b><div className="tiny muted">/collections/{r.slug}</div></span> }, { key: 'items', header: 'Products', align: 'right' }, { key: 'is_active', header: 'Status', render: (r: any) => <Badge tone={r.is_active ? 'ok' : ''}>{r.is_active ? 'Live' : 'Hidden'}</Badge> }]} />
      {e && <Modal title={e.id ? e.title : 'New collection'} onClose={() => setE(null)} wide footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { const ids = e.products.map((p: any) => p.id); if (e.id) await put(`${M}/collections/${e.id}/items`, { product_ids: ids }); else await post(`${M}/collections`, { title: e.title, description: e.description || undefined, product_ids: ids, is_active: !!e.is_active }); toast('Collection saved'); setE(null); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>Save</Btn></>}>
        <div className="stack">{!e.id && <><Input label="Title" value={e.title} onChange={(v) => setE({ ...e, title: v })} /><Textarea label="Description" value={e.description} onChange={(v) => setE({ ...e, description: v })} optional rows={2} /></>}
          <h3>Products ({e.products.length})</h3><div className="row wrap-row">{e.products.map((p: any) => <Badge key={p.id}>{p.name} <button aria-label={`Remove ${p.name}`} style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setE({ ...e, products: e.products.filter((x: any) => x.id !== p.id) })}>×</button></Badge>)}</div>
          <Input label="Find a product to add" value={q} onChange={setQ} />{found.data?.products.map((p: any) => <div key={p.id} className="row spread small"><span>{p.name} <span className="muted">{p.vendor}</span></span><Btn size="sm" variant="secondary" disabled={e.products.some((x: any) => x.id === p.id)} onClick={() => setE({ ...e, products: [...e.products, { id: p.id, name: p.name }] })}>Add</Btn></div>)}</div></Modal>}
    </>
  );
}

/* ---------- content ---------- */
export function MarketingContent() {
  const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/articles`); const [e, setE] = useState<any>(null); const [err, setErr] = useState<any>(null);
  const open = async (a?: any) => { setErr(null); if (!a) return setE({ kind: 'blog', title: '', excerpt: '', body: '', hero_image: '', status: 'draft', steps: '', servings: 4, prep: 15, cook: 30, cuisine: '' }); const d = (await get(`${M}/articles/${a.slug}`)).article; setE({ ...d, excerpt: d.excerpt ?? '', hero_image: d.hero_image ?? '', steps: (d.recipe?.steps ?? []).join('\n'), servings: d.recipe?.servings ?? 4, prep: d.recipe?.prep_minutes ?? 15, cook: d.recipe?.cook_minutes ?? 30, cuisine: d.recipe?.cuisine ?? '' }); };
  return (
    <>
      <PageHead title="Blog, recipes and FAQ" sub="Published content appears on the site with structured data for search engines." actions={<Btn variant="primary" onClick={() => open()}>New article</Btn>} />
      <ErrorNote error={error} retry={reload} />
      <Table caption="Articles" rows={data?.articles ?? []} onRow={open} cols={[{ key: 'title', header: 'Title', render: (r: any) => <b>{r.title}</b> }, { key: 'kind', header: 'Type', render: (r: any) => label(r.kind) }, { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'updated_at', header: 'Updated', render: (r: any) => dateTime(r.updated_at) }]} />
      {e && <Modal title={e.id ? 'Edit article' : 'New article'} onClose={() => setE(null)} wide footer={<><Btn variant="secondary" onClick={() => setE(null)}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { const b: any = { kind: e.kind, title: e.title, excerpt: e.excerpt || null, body: e.body, hero_image: e.hero_image || null, status: e.status, seo_title: e.seo_title || null, seo_description: e.seo_description || null }; if (e.kind === 'recipe') b.recipe = { servings: Number(e.servings), prep_minutes: Number(e.prep), cook_minutes: Number(e.cook), cuisine: e.cuisine || undefined, steps: String(e.steps).split('\n').map((x) => x.trim()).filter(Boolean) }; if (e.id) await put(`${M}/articles/${e.id}`, b); else await post(`${M}/articles`, b); toast('Article saved'); setE(null); reload(); } catch (x) { setErr(x); } }}>Save</Btn></>}>
        <ErrorNote error={err} /><div className="form-grid"><Select label="Type" value={e.kind} onChange={(v) => setE({ ...e, kind: v })} options={['blog', 'recipe', 'guide', 'faq', 'landing']} /><Select label="Status" value={e.status} onChange={(v) => setE({ ...e, status: v })} options={['draft', 'published', 'archived']} /><Input label="Title" value={e.title} onChange={(v) => setE({ ...e, title: v })} full /><Input label="Summary" value={e.excerpt} onChange={(v) => setE({ ...e, excerpt: v })} full optional /><Textarea label="Body" value={e.body} onChange={(v) => setE({ ...e, body: v })} rows={8} full hint="Blank lines separate paragraphs." /><Input label="Hero image URL" value={e.hero_image} onChange={(v) => setE({ ...e, hero_image: v })} optional full />
          {e.kind === 'recipe' && <><Input label="Servings" type="number" value={e.servings} onChange={(v) => setE({ ...e, servings: v })} /><Input label="Cuisine" value={e.cuisine} onChange={(v) => setE({ ...e, cuisine: v })} optional /><Input label="Prep minutes" type="number" value={e.prep} onChange={(v) => setE({ ...e, prep: v })} /><Input label="Cook minutes" type="number" value={e.cook} onChange={(v) => setE({ ...e, cook: v })} /><Textarea label="Method (one step per line)" value={e.steps} onChange={(v) => setE({ ...e, steps: v })} rows={5} full /></>}
          <Input label="SEO title" value={e.seo_title ?? ''} onChange={(v) => setE({ ...e, seo_title: v })} optional /><Input label="SEO description" value={e.seo_description ?? ''} onChange={(v) => setE({ ...e, seo_description: v })} optional /></div></Modal>}
    </>
  );
}

/* ---------- search synonyms and settings ---------- */
export function MarketingSearch() {
  const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/synonyms`); const [t, setT] = useState(''); const [s, setS] = useState('');
  return (
    <>
      <PageHead title="Search synonyms" sub="Teach search that “jollof”, “jolof” and “jollof rice” mean the same thing. Check what shoppers search for first." />
      <ErrorNote error={error} />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="card pad stack"><h2 style={{ fontSize: '1.1rem' }}>Synonyms</h2><Table caption="Synonyms" rows={(data?.synonyms ?? []).map((x: any) => ({ ...x, id: x.term }))} cols={[{ key: 'term', header: 'Term', render: (r: any) => <b>{r.term}</b> }, { key: 'synonyms', header: 'Also matches', render: (r: any) => r.synonyms.join(', ') }]} />
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await put(`${M}/synonyms`, { term: t, synonyms: s.split(',').map((x) => x.trim()).filter(Boolean) }); toast('Saved'); setT(''); setS(''); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}><Input label="Term" value={t} onChange={setT} /><Input label="Also matches (comma separated)" value={s} onChange={setS} /><Btn type="submit" variant="primary">Save synonym</Btn></form></section>
        <section className="card pad"><h2 style={{ fontSize: '1.1rem' }}>Top searches, last 30 days</h2><Table caption="Top searches" rows={(data?.top_queries ?? []).map((x: any) => ({ ...x, id: x.query }))} cols={[{ key: 'query', header: 'Search' }, { key: 'n', header: 'Times', align: 'right' }, { key: 'avg_results', header: 'Avg results', align: 'right', render: (r: any) => (r.avg_results === 0 ? <Badge tone="bad">0</Badge> : r.avg_results) }]} /></section>
      </div>
    </>
  );
}

export function MarketingSettings() {
  const toast = useToast(); const { data, error, reload } = useApi<any>(`${M}/settings`); const [e, setE] = useState<any>(null); const [val, setVal] = useState<any>(null);
  return (
    <>
      <PageHead title="Loyalty and guard rails" sub="Abandoned cart reminders, the loyalty programme and limits on stacking promotions." />
      <ErrorNote error={error} />
      <div className="stack">{data?.settings.map((s: any) => <div key={s.key} className="card pad row spread wrap-row"><div style={{ maxWidth: 640 }}><b>{s.label}</b><div className="small muted">{s.description}</div><div className="tiny mono" style={{ marginTop: 4 }}>{JSON.stringify(s.value).slice(0, 160)}</div></div><Btn size="sm" variant="secondary" onClick={() => { setE(s); setVal(JSON.parse(JSON.stringify(s.value))); }}>Edit</Btn></div>)}</div>
      {e && <Modal title={e.label} onClose={() => setE(null)} wide footer={<Btn variant="primary" onClick={async () => { try { await put(`${M}/settings/${e.key}`, { value: val }); toast('Saved'); setE(null); reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>Save</Btn>}><Fields value={val} onChange={setVal} /></Modal>}
    </>
  );
}
void post;
