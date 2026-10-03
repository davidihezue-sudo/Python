'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProductCard } from './cards';
import { Btn, Empty, ErrorNote, Pager, Select } from './ui';
import { get, qs } from '@/lib/api';
import { money } from '@/lib/format';
import { useLoc } from './providers';

const SORTS = [{ value: 'relevance', label: 'Best match' }, { value: 'popular', label: 'Most popular' }, { value: 'rating', label: 'Top rated' }, { value: 'price_asc', label: 'Price: low to high' }, { value: 'price_desc', label: 'Price: high to low' }, { value: 'newest', label: 'Newest' }, { value: 'distance', label: 'Nearest' }];
const DIETARY = ['Halal', 'Vegan', 'Vegetarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];
const TYPE_LABEL: Record<string, string> = { dry: 'Pantry and dry goods', fresh: 'Fresh', frozen: 'Frozen', prepared: 'Prepared food', chef_meal: 'Home chef meals' };

// URL driven listing: every filter lives in the query string, so results are shareable and the back button works.
export function SearchListing({ fixed = {}, title, intro }: { fixed?: Record<string, string>; title?: string; intro?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { loc } = useLoc();
  const [res, setRes] = useState<any>(null);
  const [facets, setFacets] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params: Record<string, string> = { ...Object.fromEntries(sp.entries()), ...fixed };
  if (loc) { params.lat = String(loc.lat); params.lng = String(loc.lng); }
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([get(`/products${qs({ ...params, limit: 24 })}`), get(`/products/facets${qs(params)}`)])
      .then(([r, f]) => { if (live) { setRes(r); setFacets(f); setErr(null); } })
      .catch((e) => live && setErr(e)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (v == null || v === '') n.delete(k); else n.set(k, v);
    n.delete('page');
    router.push(`${pathname}${n.toString() ? `?${n}` : ''}`, { scroll: false });
  };
  const toggleList = (k: string, v: string) => { const cur = (sp.get(k) ?? '').split(',').filter(Boolean); set(k, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(',')); };
  const activeCount = ['category', 'vendor', 'cuisine', 'country', 'type', 'dietary', 'min_price', 'max_price', 'in_stock', 'rating', 'on_sale', 'deliverable'].filter((k) => sp.get(k) && !(k in fixed)).length;
  const list = (k: string) => (sp.get(k) ?? '').split(',').filter(Boolean);
  const Opt = ({ k, v, label, n, multi }: { k: string; v: string; label: string; n?: number; multi?: boolean }) => (
    <label className="opt check" style={{ justifyContent: 'space-between' }}>
      <span className="row" style={{ '--gap': '8px' } as any}><input type="checkbox" checked={list(k).includes(v)} onChange={() => (multi ? toggleList(k, v) : set(k, sp.get(k) === v ? null : v))} /><span>{label}</span></span>{n != null && <span className="muted small">{n}</span>}
    </label>
  );
  const q = sp.get('q');
  return (
    <div className="wrap">
      <div style={{ margin: '22px 0 8px' }}>
        <h1 style={{ marginBottom: 4 }}>{title ?? (q ? `Results for “${q}”` : 'Shop everything')}</h1>
        {intro && <p className="muted">{intro}</p>}
        {res && <p className="muted small" aria-live="polite">{res.total} {res.total === 1 ? 'product' : 'products'}{loc ? ` near ${loc.label}` : ''}</p>}
      </div>
      <div className="row spread wrap-row" style={{ marginBottom: 14 }}>
        <Btn variant="secondary" className="filters-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>Filters{activeCount ? ` (${activeCount})` : ''}</Btn>
        <div style={{ minWidth: 200 }}><Select label="Sort by" value={sp.get('sort') ?? 'relevance'} onChange={(v) => set('sort', v)} options={SORTS} /></div>
      </div>
      <div className="layout-sidebar">
        <aside aria-label="Filters" className={filtersOpen ? '' : 'filters-collapsible'}>
          <div className="filters">
            {facets && (<>
              {!fixed.category && facets.categories?.length > 0 && <details open><summary>Category</summary>{facets.categories.map((c: any) => <Opt key={c.value} k="category" v={c.value} label={c.label} n={c.n} />)}</details>}
              {!fixed.cuisine && facets.cuisines?.length > 0 && <details open><summary>Cuisine</summary>{facets.cuisines.map((c: any) => <Opt key={c.value} k="cuisine" v={c.value} label={c.value} n={c.n} />)}</details>}
              {facets.types?.length > 0 && <details open><summary>Type</summary>{facets.types.map((c: any) => <Opt key={c.value} k="type" v={c.value} label={TYPE_LABEL[c.value] ?? c.value} n={c.n} multi />)}</details>}
              <details open><summary>Dietary</summary>{DIETARY.map((d) => <Opt key={d} k="dietary" v={d} label={d} multi />)}<p className="hint">Dietary labels are declared by sellers unless marked verified.</p></details>
              {facets.vendors?.length > 0 && !fixed.vendor && <details><summary>Seller</summary>{facets.vendors.map((c: any) => <Opt key={c.value} k="vendor" v={c.value} label={c.label} n={c.n} />)}</details>}
              {facets.countries?.length > 0 && <details><summary>Country of origin</summary>{facets.countries.map((c: any) => <Opt key={c.value} k="country" v={c.value} label={c.value} n={c.n} />)}</details>}
              <details><summary>Price</summary>
                <div className="row"><input className="input" aria-label="Minimum price" inputMode="decimal" placeholder="Min" defaultValue={sp.get('min_price') ?? ''} onBlur={(e) => set('min_price', e.target.value)} /><input className="input" aria-label="Maximum price" inputMode="decimal" placeholder="Max" defaultValue={sp.get('max_price') ?? ''} onBlur={(e) => set('max_price', e.target.value)} /></div>
                {facets.price && <p className="hint">Range {money(facets.price.min)} to {money(facets.price.max)}</p>}
              </details>
              <details open><summary>More</summary>
                <label className="check"><input type="checkbox" checked={sp.get('in_stock') === 'true'} onChange={(e) => set('in_stock', e.target.checked ? 'true' : null)} /><span>In stock only</span></label>
                <label className="check"><input type="checkbox" checked={sp.get('on_sale') === 'true'} onChange={(e) => set('on_sale', e.target.checked ? 'true' : null)} /><span>On sale</span></label>
                <label className="check"><input type="checkbox" checked={sp.get('rating') === '4'} onChange={(e) => set('rating', e.target.checked ? '4' : null)} /><span>4 stars and up</span></label>
                {loc && <label className="check"><input type="checkbox" checked={sp.get('deliverable') === 'true'} onChange={(e) => set('deliverable', e.target.checked ? 'true' : null)} /><span>Delivers to {loc.label}</span></label>}
              </details>
              {activeCount > 0 && <Btn variant="ghost" onClick={() => router.push(pathname + (q ? `?q=${encodeURIComponent(q)}` : ''))}>Clear all filters</Btn>}
            </>)}
          </div>
        </aside>
        <div>
          <ErrorNote error={err} />
          {loading && !res ? <div className="grid cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 280 }} />)}</div>
            : res && !res.items.length ? <Empty title="Nothing matched that search" action={activeCount ? <Btn onClick={() => router.push(pathname)}>Clear filters</Btn> : undefined}>Try a different spelling, a broader word like “rice”, or browse by category.{res.didYouMean && <> Did you mean <button className="btn sm ghost" onClick={() => set('q', res.didYouMean)}>{res.didYouMean}</button>?</>}</Empty>
              : res && (<>
                <div className="grid cols-3" style={{ opacity: loading ? 0.6 : 1 }}>{res.items.map((p: any) => <ProductCard key={p.id} p={p} />)}</div>
                <Pager page={res.page} pages={res.pages} onPage={(p) => { const n = new URLSearchParams(sp.toString()); n.set('page', String(p)); router.push(`${pathname}?${n}`); window.scrollTo({ top: 0 }); }} />
              </>)}
        </div>
      </div>
    </div>
  );
}
