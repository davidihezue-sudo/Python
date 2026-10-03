'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { PageHead, useVendor } from '../portal';
import { Badge, Btn, ErrorNote, Icon, Input, Modal, Select, Spinner, Table, useToast } from '../ui';
import { get, patch, post } from '@/lib/api';
import { useApi, useStream } from '@/hooks/useApi';
import { dateTime, label, money } from '@/lib/format';

function Barcode({ value, height = 40 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => { if (ref.current && value) { try { JsBarcode(ref.current, value, { format: 'CODE128', displayValue: true, height, fontSize: 12, margin: 2 }); } catch { /* invalid value */ } } }, [value, height]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />;
}

function Adjust({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const { vendorId } = useVendor(); const toast = useToast();
  const [kind, setKind] = useState('receive'); const [qty, setQty] = useState('1'); const [reason, setReason] = useState(''); const [batch, setBatch] = useState(''); const [expiry, setExpiry] = useState(''); const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<any>(null);
  const mv = useApi<any>(`/vendors/${vendorId}/inventory/${item.variant_id}/movements`);
  const count = kind === 'correction';
  return (
    <Modal title={`${item.product_name} (${item.variant_name})`} onClose={onClose} wide footer={<><Btn variant="secondary" onClick={onClose}>Close</Btn><Btn variant="primary" busy={busy} onClick={async () => {
      setBusy(true); setErr(null);
      try { await post(`/vendors/${vendorId}/inventory/adjust`, { variantId: item.variant_id, kind, ...(count ? { newOnHand: Number(qty) } : { qty: Number(qty) }), reason: reason || undefined, batchCode: batch || undefined, expiryDate: expiry || undefined, supplier: supplier || undefined }); toast('Stock updated'); onDone(); mv.reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
    }}>Apply</Btn></>}>
      <div className="stack"><ErrorNote error={err} />
        <p><b>{item.on_hand}</b> on hand · <b>{item.reserved}</b> reserved for open orders · <b>{item.available}</b> available</p>
        <div className="form-grid">
          <Select label="What happened?" value={kind} onChange={setKind} options={[{ value: 'receive', label: 'Received new stock' }, { value: 'adjust_add', label: 'Add (found)' }, { value: 'adjust_remove', label: 'Remove (lost or used)' }, { value: 'damaged', label: 'Damaged' }, { value: 'expired', label: 'Expired' }, { value: 'correction', label: 'Stock count: set exact number' }]} />
          <Input label={count ? 'Counted quantity' : 'Quantity'} type="number" min={0} value={qty} onChange={setQty} />
          {kind === 'receive' && <><Input label="Batch or lot code" value={batch} onChange={setBatch} optional /><Input label="Best before" type="date" value={expiry} onChange={setExpiry} optional /><Input label="Supplier" value={supplier} onChange={setSupplier} optional /></>}
          <Input label="Note" value={reason} onChange={setReason} optional full />
        </div>
        <h3>Recent movements</h3>
        <Table caption="Stock movements" rows={mv.data?.movements ?? []} empty="No movements recorded." cols={[{ key: 'created_at', header: 'When', render: (r: any) => dateTime(r.created_at) }, { key: 'kind', header: 'Type', render: (r: any) => label(r.kind) }, { key: 'delta_on_hand', header: 'Change', align: 'right', render: (r: any) => (r.delta_on_hand > 0 ? `+${r.delta_on_hand}` : r.delta_on_hand) }, { key: 'on_hand_after', header: 'On hand after', align: 'right' }, { key: 'reason', header: 'Note' }]} />
      </div>
    </Modal>
  );
}

// Scan with a USB or Bluetooth scanner (they type the code and press Enter), the camera where the browser supports it, or type a code.
function Scanner({ onFound, onClose }: { onFound: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState(''); const video = useRef<HTMLVideoElement>(null); const [cam, setCam] = useState<'off' | 'on' | 'unsupported'>('off'); const [msg, setMsg] = useState('');
  useEffect(() => {
    if (cam !== 'on') return;
    const Det = (window as any).BarcodeDetector;
    if (!Det) { setCam('unsupported'); return; }
    let stop = false; let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const det = new Det({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        const tick = async () => { if (stop || !video.current) return; try { const r = await det.detect(video.current); if (r[0]?.rawValue) { onFound(r[0].rawValue); return; } } catch { /* keep trying */ } setTimeout(tick, 300); };
        tick();
      } catch { setMsg('Camera access was blocked. Use a scanner or type the code.'); setCam('off'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam, onFound]);
  return (
    <Modal title="Scan a barcode" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onFound(code.trim()); }}>
        <Input label="Barcode or SKU" value={code} onChange={setCode} hint="Click here and scan with a USB or Bluetooth scanner. It types the code and presses Enter." />
        <Btn type="submit" variant="primary">Look up</Btn>
        {cam === 'on' && <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} aria-label="Camera preview" />}
        {cam !== 'on' && <Btn variant="secondary" onClick={() => setCam('on')}><Icon name="scan" size={16} /> Use the camera</Btn>}
        {cam === 'unsupported' && <p className="alert">This browser cannot scan with the camera. Use a barcode scanner, or type the code.</p>}
        {msg && <p className="alert bad">{msg}</p>}
      </form>
    </Modal>
  );
}

export function VendorInventory() {
  const { vendorId, chef, base } = useVendor(); const toast = useToast();
  const { data, error, loading, reload } = useApi<any>(`/vendors/${vendorId}/inventory`);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState(''); const [adj, setAdj] = useState<any>(null); const [scan, setScan] = useState(false); const [sel, setSel] = useState<Set<string>>(new Set());
  useStream([`vendor:${vendorId}`], (t) => { if (t === 'low_inventory' || t === 'order.new') reload(); });
  const items = (data?.items ?? []).filter((i: any) => (!q || `${i.product_name} ${i.variant_name} ${i.sku} ${i.barcode ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!filter || (filter === 'low' ? i.tracks_inventory && i.available <= i.reorder_threshold : filter === 'out' ? i.tracks_inventory && i.available <= 0 : filter === 'expiring' ? i.next_expiry && new Date(i.next_expiry).getTime() < Date.now() + 14 * 864e5 : true)));
  const found = async (code: string) => {
    setScan(false);
    try { const r = await get(`/vendors/${vendorId}/inventory/lookup?code=${encodeURIComponent(code)}`); const it = data?.items.find((i: any) => i.variant_id === r.items[0].variant_id || i.variant_id === r.items[0].id); if (it) setAdj(it); else toast(`Found ${r.items[0].product_name ?? 'item'}`); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <>
      <PageHead title="Inventory" sub={chef ? 'Track packaged and pantry items. Made to order dishes use daily capacity instead.' : 'On hand, reserved for open orders, and available to sell.'} actions={<><Btn variant="secondary" onClick={() => setScan(true)}><Icon name="scan" size={16} /> Scan</Btn><Link className="btn secondary" href={`${base}/labels${sel.size ? `?ids=${[...sel].join(',')}` : ''}`}>Print labels{sel.size ? ` (${sel.size})` : ''}</Link></>} />
      <div className="row wrap-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}><div style={{ minWidth: 260 }}><Input label="Search name, SKU or barcode" value={q} onChange={setQ} /></div><div style={{ width: 200 }}><Select label="Show" value={filter} onChange={setFilter} options={[{ value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }, { value: 'expiring', label: 'Expiring in 14 days' }]} placeholder="Everything" /></div></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Spinner /> : <Table caption="Inventory" rows={items.map((i: any) => ({ ...i, id: i.variant_id }))} empty="Nothing matches." onRow={(r: any) => setAdj(r)} cols={[
        { key: 'sel', header: '', render: (r: any) => <input type="checkbox" aria-label={`Select ${r.product_name} for labels`} checked={sel.has(r.variant_id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.variant_id) : n.delete(r.variant_id); return n; })} /> },
        { key: 'product_name', header: 'Product', render: (r: any) => <span><b>{r.product_name}</b><div className="tiny muted">{r.variant_name} · {r.sku}</div></span> },
        { key: 'barcode', header: 'Barcode', render: (r: any) => <span className="mono small">{r.barcode ?? ''}</span> },
        { key: 'on_hand', header: 'On hand', align: 'right' }, { key: 'reserved', header: 'Reserved', align: 'right' }, { key: 'available', header: 'Available', align: 'right', render: (r: any) => !r.tracks_inventory ? <Badge>Made to order</Badge> : r.available <= 0 ? <Badge tone="bad">0</Badge> : r.available <= r.reorder_threshold ? <Badge tone="warn">{r.available}</Badge> : r.available },
        { key: 'next_expiry', header: 'Next expiry', render: (r: any) => r.next_expiry ? r.next_expiry.slice(0, 10) : '' }]} />}
      {adj && <Adjust item={adj} onClose={() => setAdj(null)} onDone={reload} />}
      {scan && <Scanner onFound={found} onClose={() => setScan(false)} />}
    </>
  );
}

export function VendorLabels() {
  const { vendorId } = useVendor();
  const ids = useSearchParams().get('ids');
  const { data, error } = useApi<any>(`/vendors/${vendorId}/labels${ids ? `?variantIds=${ids}` : ''}`);
  return (
    <>
      <PageHead title="Barcode labels" sub="Print shelf labels. Items without a barcode use their SKU." actions={<Btn variant="primary" onClick={() => window.print()}><Icon name="print" size={16} /> Print</Btn>} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : <div className="print-area"><div className="label-sheet">{data.labels.map((l: any) => <div key={l.id} className="lbl"><b>{l.product}</b><div>{l.variant} · {money(l.price)}</div><Barcode value={l.barcode || l.sku} /></div>)}</div></div>}
    </>
  );
}
void patch;
