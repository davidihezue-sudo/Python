'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Check, Confirm, ErrorNote, Input, Modal, Pager, Select, Spinner, Table, Tabs, Textarea, useToast } from '../ui';
import { api, del, get, post, put, upload } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';

const TYPES = [{ value: 'dry', label: 'Dry or pantry' }, { value: 'fresh', label: 'Fresh' }, { value: 'frozen', label: 'Frozen' }, { value: 'prepared', label: 'Prepared food' }, { value: 'chef_meal', label: 'Chef meal' }];
const ALLERGENS = ['peanuts', 'tree_nuts', 'milk', 'eggs', 'fish', 'shellfish', 'soy', 'wheat', 'sesame', 'mustard'];
const DIETARY = ['Halal', 'Vegan', 'Vegetarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];
const flatten = (cs: any[], p = ''): { value: string; label: string }[] => cs.flatMap((c) => [{ value: c.id, label: p + c.name }, ...flatten(c.children ?? [], `${p}${c.name} / `)]);
const blankVariant = () => ({ name: 'Regular', sku: '', barcode: '', price: '', sale_price: '', portions: 1, on_hand: '', is_default: true });

function ProductEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { vendorId, chef } = useVendor(); const toast = useToast();
  const cats = useApi<any>('/categories');
  const [p, setP] = useState<any>({ name: '', short_description: '', description: '', product_type: chef ? 'chef_meal' : 'dry', category_id: '', brand: '', country_of_origin: '', cuisine: '', unit: 'each', tracks_inventory: !chef, prep_time_minutes: '', shelf_life_days: '', storage_instructions: '', ingredients_text: '', allergens: [], dietary: [], tags: '', status: 'draft', daily_capacity: '' });
  const [vars, setVars] = useState<any[]>([blankVariant()]); const [images, setImages] = useState<{ url: string; alt?: string }[]>([]);
  const [loading, setLoading] = useState(!!id); const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null); const [tab, setTab] = useState('basics');
  useEffect(() => {
    if (!id) return;
    get(`/vendors/${vendorId}/products/${id}`).then((d) => {
      const x = d.product;
      setP({ ...x, brand: x.brand ?? '', category_id: x.category_id ?? '', tags: (x.tags ?? []).join(', '), prep_time_minutes: x.prep_time_minutes ?? '', shelf_life_days: x.shelf_life_days ?? '', daily_capacity: x.daily_capacity ?? '', short_description: x.short_description ?? '', description: x.description ?? '', country_of_origin: x.country_of_origin ?? '', cuisine: x.cuisine ?? '', storage_instructions: x.storage_instructions ?? '', ingredients_text: x.ingredients_text ?? '' });
      setVars(d.variants.map((v: any) => ({ id: v.id, name: v.name, sku: v.sku, barcode: v.barcode ?? '', price: v.price, sale_price: v.sale_price ?? '', portions: v.portions, on_hand: v.on_hand, is_default: v.is_default })));
      setImages(d.images ?? []);
    }).catch(setErr).finally(() => setLoading(false));
  }, [id, vendorId]);
  const s = (k: string) => (v: any) => setP((o: any) => ({ ...o, [k]: v }));
  const sv = (i: number, k: string, v: any) => setVars((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : k === 'is_default' && v ? { ...x, is_default: false } : x)));
  const toggle = (k: string, v: string) => setP((o: any) => ({ ...o, [k]: o[k].includes(v) ? o[k].filter((x: string) => x !== v) : [...o[k], v] }));
  const save = async (status?: string) => {
    setBusy(true); setErr(null);
    try {
      const num = (v: any) => (v === '' || v == null ? null : Number(v));
      const body: any = {
        name: p.name, short_description: p.short_description || null, description: p.description || null, product_type: p.product_type, category_id: p.category_id || null, brand: p.brand || null, country_of_origin: p.country_of_origin || null, cuisine: p.cuisine || null,
        tags: String(p.tags || '').split(',').map((x) => x.trim()).filter(Boolean), unit: p.unit || 'each', prep_time_minutes: num(p.prep_time_minutes), shelf_life_days: num(p.shelf_life_days), storage_instructions: p.storage_instructions || null, ingredients_text: p.ingredients_text || null,
        allergens: p.allergens, dietary: p.dietary, tracks_inventory: !!p.tracks_inventory, daily_capacity: num(p.daily_capacity), status: status ?? p.status, images,
        variants: vars.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name, sku: v.sku || undefined, barcode: v.barcode || null, price: Number(v.price), sale_price: num(v.sale_price), portions: Number(v.portions) || 1, is_default: !!v.is_default, ...(v.on_hand !== '' && v.on_hand != null && !id ? { stock: Number(v.on_hand) } : {}) })),
      };
      if (id) await put(`/vendors/${vendorId}/products/${id}`, body); else await post(`/vendors/${vendorId}/products`, body);
      toast(status === 'active' ? 'Product published' : 'Product saved'); onSaved(); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const addImage = async (f?: File | null) => { if (!f) return; try { const r = await upload(f, 'product'); setImages((a) => [...a, { url: r.url, alt: p.name }]); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <Modal title={id ? 'Edit product' : 'New product'} onClose={onClose} wide footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="secondary" busy={busy} onClick={() => save('draft')}>Save as draft</Btn><Btn variant="primary" busy={busy} onClick={() => save('active')}>Save and publish</Btn></>}>
      {loading ? <Spinner /> : (<>
        <ErrorNote error={err} />
        {err?.details?.fieldErrors && <ul className="error-text">{Object.entries(err.details.fieldErrors).map(([k, v]: any) => <li key={k}>{k}: {v[0]}</li>)}</ul>}
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'basics', label: 'Basics' }, { key: 'variants', label: `Sizes and prices (${vars.length})` }, { key: 'food', label: 'Food details' }, { key: 'images', label: `Photos (${images.length})` }]} />
        {tab === 'basics' && <div className="form-grid">
          <Input label="Name" value={p.name} onChange={s('name')} full required /><Input label="Short description" value={p.short_description} onChange={s('short_description')} full maxLength={300} />
          <Textarea label="Full description" value={p.description} onChange={s('description')} full optional />
          <Select label="Type" value={p.product_type} onChange={s('product_type')} options={TYPES} /><Select label="Category" value={p.category_id} onChange={s('category_id')} options={flatten(cats.data?.categories ?? [])} placeholder="Choose a category" />
          <Input label="Brand" value={p.brand} onChange={s('brand')} optional /><Input label="Cuisine" value={p.cuisine} onChange={s('cuisine')} optional placeholder="Nigerian" />
          <Input label="Country of origin" value={p.country_of_origin} onChange={s('country_of_origin')} optional /><Input label="Search tags" value={p.tags} onChange={s('tags')} hint="Comma separated" optional />
        </div>}
        {tab === 'variants' && <div className="stack">{vars.map((v, i) => (
          <fieldset key={i}><legend>{v.name || `Size ${i + 1}`}</legend><div className="form-grid">
            <Input label="Name" value={v.name} onChange={(x) => sv(i, 'name', x)} required /><Input label="Price (CAD)" type="number" step="0.01" min={0} value={v.price} onChange={(x) => sv(i, 'price', x)} required />
            <Input label="Sale price" type="number" step="0.01" min={0} value={v.sale_price} onChange={(x) => sv(i, 'sale_price', x)} optional hint="Must be lower than the price." /><Input label="Barcode (EAN, UPC or your own)" value={v.barcode} onChange={(x) => sv(i, 'barcode', x)} optional />
            <Input label="SKU" value={v.sku} onChange={(x) => sv(i, 'sku', x)} optional hint="Generated if left empty." />{!id && p.tracks_inventory && <Input label="Opening stock" type="number" min={0} value={v.on_hand} onChange={(x) => sv(i, 'on_hand', x)} />}
            <Check label="Default size" checked={!!v.is_default} onChange={(x) => sv(i, 'is_default', x)} />{vars.length > 1 && <Btn variant="ghost" onClick={() => setVars((a) => a.filter((_, j) => j !== i))}>Remove this size</Btn>}
          </div></fieldset>))}
          <Btn variant="secondary" onClick={() => setVars((a) => [...a, { ...blankVariant(), name: '', is_default: false }])}>Add another size</Btn></div>}
        {tab === 'food' && <div className="form-grid">
          <Check label="Track inventory for this product" checked={!!p.tracks_inventory} onChange={s('tracks_inventory')} hint="Turn off for made to order food. Use daily capacity instead." />
          <Input label="Daily capacity (portions)" type="number" min={1} value={p.daily_capacity} onChange={s('daily_capacity')} optional hint="Limits how many can be ordered per day." />
          <Input label="Preparation time (minutes)" type="number" min={0} value={p.prep_time_minutes} onChange={s('prep_time_minutes')} optional /><Input label="Shelf life (days)" type="number" min={0} value={p.shelf_life_days} onChange={s('shelf_life_days')} optional />
          <Input label="Ingredients" value={p.ingredients_text} onChange={s('ingredients_text')} full optional /><Input label="Storage instructions" value={p.storage_instructions} onChange={s('storage_instructions')} full optional />
          <fieldset className="full"><legend>Allergens this product contains</legend><div className="row wrap-row">{ALLERGENS.map((a) => <Check key={a} label={a.replace('_', ' ')} checked={p.allergens.includes(a)} onChange={() => toggle('allergens', a)} />)}</div></fieldset>
          <fieldset className="full"><legend>Dietary claims</legend><div className="row wrap-row">{DIETARY.map((a) => <Check key={a} label={a} checked={p.dietary.includes(a)} onChange={() => toggle('dietary', a)} />)}</div><p className="hint">Claims are shown as declared by you. Our team may verify them. Only claim what is true.</p></fieldset>
        </div>}
        {tab === 'images' && <div className="stack"><div className="grid cols-4">{images.map((im, i) => <div key={i} className="card pad" style={{ padding: 8 }}><img src={im.url} alt={im.alt ?? ''} style={{ aspectRatio: '4/3', objectFit: 'cover', width: '100%', borderRadius: 6 }} /><Btn size="sm" variant="ghost" onClick={() => setImages((a) => a.filter((_, j) => j !== i))}>Remove</Btn></div>)}</div>
          <div><label className="btn secondary" htmlFor="img-up">Upload a photo</label><input id="img-up" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => addImage(e.target.files?.[0])} /><p className="hint">JPG, PNG or WebP. Clear, well lit photos sell more.</p></div></div>}
      </>)}
    </Modal>
  );
}

export function VendorProducts() {
  const { vendorId, chef } = useVendor(); const toast = useToast();
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/vendors/${vendorId}/products?page=${page}&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`);
  const [edit, setEdit] = useState<string | null | undefined>(undefined); const [rm, setRm] = useState<any>(null);
  return (
    <>
      <PageHead title={chef ? 'Menu' : 'Products'} sub={`${data?.total ?? 0} items`} actions={<><Link className="btn secondary" href={`/${chef ? 'chef' : 'vendor'}/inventory`}>Inventory</Link><Btn variant="primary" onClick={() => setEdit(null)}>{chef ? 'Add a dish' : 'Add product'}</Btn></>} />
      <div className="row wrap-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}><div style={{ minWidth: 240 }}><Input label="Search" value={q} onChange={(v) => { setQ(v); setPage(1); }} /></div><div style={{ width: 170 }}><Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['draft', 'active', 'archived']} placeholder="All" /></div></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Products" rows={data?.products ?? []} empty="No products yet. Add your first one." onRow={(r: any) => setEdit(r.id)} cols={[
        { key: 'name', header: 'Product', render: (r: any) => <span className="row"><img src={r.image_url ?? '/img/food/meal.svg'} alt="" width={40} height={40} style={{ borderRadius: 6, width: 40, height: 40, objectFit: 'cover' }} /><span><b>{r.name}</b><div className="tiny muted">{r.category}</div></span></span> },
        { key: 'status', header: 'Status', render: (r: any) => <Badge status={r.status} /> }, { key: 'v', header: 'Sizes and prices', render: (r: any) => <span className="small">{(r.variants ?? []).map((v: any) => `${v.name} ${money(v.sale_price ?? v.price)}`).join(', ')}</span> },
        { key: 'stock', header: 'In stock', align: 'right', render: (r: any) => (r.variants ?? []).reduce((s: number, v: any) => s + (v.available ?? 0), 0) },
        { key: 'x', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRm(r); }}>Archive</Btn> }]} />}
      <Pager page={page} pages={Math.ceil((data?.total ?? 0) / 20)} onPage={setPage} />
      {edit !== undefined && <ProductEditor id={edit} onClose={() => setEdit(undefined)} onSaved={reload} />}
      {rm && <Confirm title={`Archive ${rm.name}?`} danger confirmLabel="Archive" onClose={() => setRm(null)} onConfirm={async () => { await del(`/vendors/${vendorId}/products/${rm.id}`); toast('Product archived'); reload(); }}><p>It disappears from the shop. Past orders keep their record. You can restore it by editing and publishing it again.</p></Confirm>}
    </>
  );
}
void api;
