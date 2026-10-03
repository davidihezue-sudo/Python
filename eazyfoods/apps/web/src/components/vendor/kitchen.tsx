'use client';
import { useState } from 'react';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, Confirm, ErrorNote, Input, Modal, Select, Spinner, Stat, Table, Tabs, Textarea, useToast } from '../ui';
import { del, get, post, put } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { dateTime, money } from '@/lib/format';

function IngredientModal({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const { vendorId } = useVendor(); const toast = useToast();
  const [i, setI] = useState<any>({ name: '', unit: 'kg', cost_per_unit: '', stock_qty: '0', reorder_threshold: '0', ...(initial ?? {}) }); const [err, setErr] = useState<any>(null);
  const s = (k: string) => (v: any) => setI((o: any) => ({ ...o, [k]: v }));
  return (
    <Modal title={initial ? 'Edit ingredient' : 'New ingredient'} onClose={onClose} footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={async () => { try { const b = { name: i.name, unit: i.unit, cost_per_unit: Number(i.cost_per_unit), stock_qty: Number(i.stock_qty), reorder_threshold: Number(i.reorder_threshold) }; if (initial?.id) await put(`/vendors/${vendorId}/ingredients/${initial.id}`, b); else await post(`/vendors/${vendorId}/ingredients`, b); toast('Saved'); onSaved(); onClose(); } catch (e) { setErr(e); } }}>Save</Btn></>}>
      <ErrorNote error={err} /><div className="form-grid"><Input label="Name" value={i.name} onChange={s('name')} full /><Select label="Unit" value={i.unit} onChange={s('unit')} options={['g', 'kg', 'ml', 'l', 'each']} /><Input label="Cost per unit (CAD)" type="number" step="0.01" min={0} value={i.cost_per_unit} onChange={s('cost_per_unit')} /><Input label="In stock" type="number" min={0} step="0.01" value={i.stock_qty} onChange={s('stock_qty')} /><Input label="Reorder at" type="number" min={0} step="0.01" value={i.reorder_threshold} onChange={s('reorder_threshold')} /></div>
    </Modal>
  );
}

function RecipeModal({ id, ingredients, products, onClose, onSaved }: { id: string | null; ingredients: any[]; products: any[]; onClose: () => void; onSaved: () => void }) {
  const { vendorId } = useVendor(); const toast = useToast();
  const costing = useApi<any>(id ? `/vendors/${vendorId}/recipes/${id}` : null);
  const [r, setR] = useState<any>(null); const [err, setErr] = useState<any>(null); const [batches, setBatches] = useState('2'); const [plan, setPlan] = useState<any>(null);
  const base = r ?? (costing.data ? { name: costing.data.recipe.name, product_id: costing.data.recipe.product_id ?? '', yield_servings: costing.data.recipe.yield_servings, prep_minutes: costing.data.recipe.prep_minutes, cook_minutes: costing.data.recipe.cook_minutes, steps: (costing.data.recipe.steps ?? []).join('\n'), selling_price: costing.data.recipe.selling_price ?? '', deduct_ingredients: costing.data.recipe.deduct_ingredients, lines: costing.data.lines.map((l: any) => ({ ingredient_id: l.id, quantity: l.quantity })) } : id ? null : { name: '', product_id: '', yield_servings: 10, prep_minutes: 0, cook_minutes: 0, steps: '', selling_price: '', deduct_ingredients: false, lines: [{ ingredient_id: ingredients[0]?.id ?? '', quantity: 1 }] });
  if (!base) return <Modal title="Recipe" onClose={onClose}><Spinner /></Modal>;
  const set = (k: string) => (v: any) => setR({ ...base, [k]: v });
  const setLine = (i: number, k: string, v: any) => setR({ ...base, lines: base.lines.map((l: any, j: number) => (j === i ? { ...l, [k]: v } : l)) });
  return (
    <Modal title={id ? 'Recipe and costing' : 'New recipe'} onClose={onClose} wide footer={<><Btn variant="secondary" onClick={onClose}>Close</Btn><Btn variant="primary" onClick={async () => {
      try { const b = { name: base.name, product_id: base.product_id || null, yield_servings: Number(base.yield_servings), prep_minutes: Number(base.prep_minutes) || 0, cook_minutes: Number(base.cook_minutes) || 0, steps: String(base.steps).split('\n').map((x) => x.trim()).filter(Boolean), selling_price: base.selling_price === '' ? null : Number(base.selling_price), deduct_ingredients: !!base.deduct_ingredients, ingredients: base.lines.map((l: any) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity) })) };
        if (id) await put(`/vendors/${vendorId}/recipes/${id}`, b); else await post(`/vendors/${vendorId}/recipes`, b); toast('Recipe saved'); onSaved(); onClose(); } catch (e) { setErr(e); }
    }}>Save recipe</Btn></>}>
      <ErrorNote error={err} />
      <div className="form-grid">
        <Input label="Recipe name" value={base.name} onChange={set('name')} full /><Select label="Linked menu item" value={base.product_id} onChange={set('product_id')} options={products.map((p) => ({ value: p.id, label: p.name }))} placeholder="None" />
        <Input label="Servings per batch" type="number" min={1} value={base.yield_servings} onChange={set('yield_servings')} /><Input label="Prep minutes" type="number" min={0} value={base.prep_minutes} onChange={set('prep_minutes')} /><Input label="Cook minutes" type="number" min={0} value={base.cook_minutes} onChange={set('cook_minutes')} />
        <Input label="Selling price per serving (CAD)" type="number" step="0.01" min={0} value={base.selling_price} onChange={set('selling_price')} optional />
        <Textarea label="Method (one step per line)" value={base.steps} onChange={set('steps')} full rows={4} />
        <fieldset className="full"><legend>Ingredients per batch</legend><div className="stack" style={{ '--gap': '8px' } as any}>{base.lines.map((l: any, i: number) => <div key={i} className="row wrap-row" style={{ alignItems: 'flex-end' }}><div style={{ minWidth: 220, flex: 1 }}><Select label="Ingredient" value={l.ingredient_id} onChange={(v) => setLine(i, 'ingredient_id', v)} options={ingredients.map((x) => ({ value: x.id, label: `${x.name} (${x.unit})` }))} /></div><div style={{ width: 130 }}><Input label="Quantity" type="number" step="0.01" min={0} value={l.quantity} onChange={(v) => setLine(i, 'quantity', v)} /></div><Btn variant="ghost" onClick={() => setR({ ...base, lines: base.lines.filter((_: any, j: number) => j !== i) })}>Remove</Btn></div>)}<Btn variant="secondary" onClick={() => setR({ ...base, lines: [...base.lines, { ingredient_id: ingredients[0]?.id ?? '', quantity: 1 }] })}>Add ingredient</Btn></div></fieldset>
      </div>
      {id && costing.data && (<div className="stack" style={{ marginTop: 16 }}>
        <div className="grid cols-4"><Stat label="Cost per serving" value={money(costing.data.cost_per_serving)} /><Stat label="Food cost" value={`${costing.data.food_cost_pct}%`} /><Stat label="Margin per serving" value={money(costing.data.gross_margin)} hint={`${costing.data.gross_margin_pct}% margin`} /><Stat label="Servings you can make now" value={costing.data.servings_possible} hint={`${costing.data.total_minutes} minutes per batch`} /></div>
        <form className="row wrap-row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); setPlan(await post(`/vendors/${vendorId}/recipes/${id}/plan`, { batches: Number(batches) })); }}><div style={{ width: 160 }}><Input label="Plan batches" type="number" min={1} value={batches} onChange={setBatches} /></div><Btn type="submit" variant="secondary">What do I need?</Btn></form>
        {plan && <><p>{plan.servings} servings, ingredient cost {money(plan.cost)}</p><Table caption="Shopping list" rows={plan.needs.map((n: any) => ({ ...n, id: n.ingredient }))} cols={[{ key: 'ingredient', header: 'Ingredient' }, { key: 'needed', header: 'Needed', align: 'right', render: (n: any) => `${n.needed} ${n.unit}` }, { key: 'in_stock', header: 'In stock', align: 'right' }, { key: 'short', header: 'Short by', align: 'right', render: (n: any) => (n.short > 0 ? <Badge tone="bad">{n.short}</Badge> : <Badge tone="ok">OK</Badge>) }]} /></>}
      </div>)}
    </Modal>
  );
}

export function ChefKitchen() {
  const { vendorId } = useVendor(); const toast = useToast();
  const [tab, setTab] = useState('capacity');
  const cap = useApi<any>(`/vendors/${vendorId}/chef/capacity`); const ing = useApi<any>(`/vendors/${vendorId}/ingredients`); const rec = useApi<any>(`/vendors/${vendorId}/recipes`); const prods = useApi<any>(`/vendors/${vendorId}/products?limit=100`);
  const [edIng, setEdIng] = useState<any>(undefined); const [edRec, setEdRec] = useState<string | null | undefined>(undefined); const [bo, setBo] = useState({ starts_at: '', ends_at: '', reason: '' }); const [rmBo, setRmBo] = useState<any>(null);
  return (
    <>
      <PageHead title="Kitchen" sub="Capacity limits stop you from taking more orders than you can cook." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'capacity', label: 'Capacity and time off' }, { key: 'recipes', label: 'Recipes and costing' }, { key: 'ingredients', label: 'Ingredients' }]} />
      {tab === 'capacity' && cap.data && (<div className="stack">
        <div className="grid cols-3"><Stat label="Portions today" value={cap.data.today.daily_capacity ?? 'No limit'} /><Stat label="Already ordered" value={cap.data.today.used} /><Stat label="Remaining" value={cap.data.today.remaining ?? 'No limit'} /></div>
        <p className="muted">Change your daily and hourly limits and cooking days under <a href="settings">Profile and hours</a>. Dish level limits are set on each menu item.</p>
        <section className="card pad"><h2 style={{ fontSize: '1.15rem' }}>Time off</h2>
          <Table caption="Time off" rows={cap.data.blackouts} empty="No time off scheduled." cols={[{ key: 'starts_at', header: 'From', render: (r: any) => dateTime(r.starts_at) }, { key: 'ends_at', header: 'To', render: (r: any) => dateTime(r.ends_at) }, { key: 'reason', header: 'Reason' }, { key: 'x', header: '', render: (r: any) => <Btn size="sm" variant="ghost" onClick={() => setRmBo(r)}>Remove</Btn> }]} />
          <form className="row wrap-row" style={{ alignItems: 'flex-end', marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); try { await post(`/vendors/${vendorId}/chef/blackouts`, { starts_at: new Date(bo.starts_at).toISOString(), ends_at: new Date(bo.ends_at).toISOString(), reason: bo.reason || undefined }); toast('Time off added'); setBo({ starts_at: '', ends_at: '', reason: '' }); cap.reload(); } catch (x: any) { toast(x.message, 'bad'); } }}>
            <Input label="From" type="datetime-local" value={bo.starts_at} onChange={(v) => setBo({ ...bo, starts_at: v })} required /><Input label="To" type="datetime-local" value={bo.ends_at} onChange={(v) => setBo({ ...bo, ends_at: v })} required /><Input label="Reason" value={bo.reason} onChange={(v) => setBo({ ...bo, reason: v })} optional /><Btn type="submit">Add time off</Btn></form></section></div>)}
      {tab === 'recipes' && <><div style={{ marginBottom: 12 }}><Btn variant="primary" onClick={() => setEdRec(null)} disabled={!ing.data?.ingredients.length}>New recipe</Btn>{!ing.data?.ingredients.length && <span className="small muted"> Add ingredients first.</span>}</div>
        <Table caption="Recipes" rows={rec.data?.recipes ?? []} empty="No recipes yet." onRow={(r: any) => setEdRec(r.id)} cols={[{ key: 'name', header: 'Recipe', render: (r: any) => <b>{r.name}</b> }, { key: 'yield_servings', header: 'Servings', align: 'right' }, { key: 'cost_per_serving', header: 'Cost each', align: 'right', render: (r: any) => money(r.cost_per_serving) }, { key: 'food_cost_pct', header: 'Food cost', align: 'right', render: (r: any) => `${r.food_cost_pct}%` }, { key: 'gross_margin', header: 'Margin each', align: 'right', render: (r: any) => money(r.gross_margin) }]} /></>}
      {tab === 'ingredients' && <><div style={{ marginBottom: 12 }}><Btn variant="primary" onClick={() => setEdIng({})}>New ingredient</Btn></div>
        <Table caption="Ingredients" rows={ing.data?.ingredients ?? []} empty="No ingredients yet." onRow={(r: any) => setEdIng(r)} cols={[{ key: 'name', header: 'Ingredient', render: (r: any) => <b>{r.name}</b> }, { key: 'cost_per_unit', header: 'Cost per unit', align: 'right', render: (r: any) => `${money(r.cost_per_unit)} / ${r.unit}` }, { key: 'stock_qty', header: 'In stock', align: 'right', render: (r: any) => `${r.stock_qty} ${r.unit}` }, { key: 'low', header: '', render: (r: any) => (Number(r.stock_qty) <= Number(r.reorder_threshold) ? <Badge tone="warn">Reorder</Badge> : null) }]} /></>}
      {edIng !== undefined && <IngredientModal initial={edIng.id ? edIng : undefined} onClose={() => setEdIng(undefined)} onSaved={() => { ing.reload(); rec.reload(); }} />}
      {edRec !== undefined && <RecipeModal id={edRec} ingredients={ing.data?.ingredients ?? []} products={prods.data?.products ?? []} onClose={() => setEdRec(undefined)} onSaved={rec.reload} />}
      {rmBo && <Confirm title="Remove this time off?" confirmLabel="Remove" onClose={() => setRmBo(null)} onConfirm={async () => { await del(`/vendors/${vendorId}/chef/blackouts/${rmBo.id}`); cap.reload(); }}><p>Customers will be able to order for these times again.</p></Confirm>}
    </>
  );
}
void get;
